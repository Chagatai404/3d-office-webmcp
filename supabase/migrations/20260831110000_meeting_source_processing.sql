-- Meeting source files, slice 2 completion:
--   * raw-file storage bucket + path convention (private),
--   * explicit processing-status transitions (processing -> ready / failed),
--   * a per-room total storage cap,
--   * source.processed / source.processing_failed audit events,
--   * errorMessage projected into the canonical source DTO.

alter table public.meeting_sources
  add column if not exists storage_bucket text,
  add column if not exists storage_path text;

-- ---------------------------------------------------------------------------
-- DTO now carries the failure reason (safe, server-generated, never raw text).
-- ---------------------------------------------------------------------------
create or replace function public.meeting_source_dto(source_row public.meeting_sources)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', source_row.id,
    'roomId', source_row.room_id,
    'uploadedByParticipantId', source_row.uploaded_by_participant_id,
    'visibility', source_row.visibility,
    'title', source_row.title,
    'filename', source_row.filename,
    'mimeType', source_row.mime_type,
    'byteSize', source_row.byte_size,
    'sha256', source_row.sha256,
    'status', source_row.status,
    'summary', source_row.summary,
    'errorMessage', source_row.error_message,
    'createdAt', source_row.created_at,
    'processedAt', source_row.processed_at,
    'removedAt', source_row.removed_at
  );
$$;

revoke all on function public.meeting_source_dto(public.meeting_sources) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- create_meeting_source: adds expects-extraction + storage pointers, a
-- 100 MB per-room cap, and a `processing` initial status for binary sources
-- whose text is extracted out of band.
-- ---------------------------------------------------------------------------
drop function if exists public.create_meeting_source(
  text, bigint, text, text, text, integer, text,
  public.meeting_source_visibility, text[], text, public.action_origin
);

create or replace function public.create_meeting_source(
  p_room_id text,
  p_expected_version bigint,
  p_title text,
  p_filename text,
  p_mime_type text,
  p_byte_size integer,
  p_sha256 text,
  p_visibility public.meeting_source_visibility,
  p_chunks text[],
  p_summary text,
  p_expects_extraction boolean,
  p_storage_bucket text,
  p_storage_path text,
  p_origin public.action_origin
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  room_row public.rooms;
  actor_participant_id text;
  existing_source_count integer;
  room_byte_total bigint;
  new_source public.meeting_sources;
  chunk_text text;
  chunk_index integer := 0;
  chunk_count integer := coalesce(cardinality(p_chunks), 0);
  is_pending boolean := coalesce(p_expects_extraction, false) and chunk_count = 0;
  new_status public.meeting_source_status;
  next_version bigint;
begin
  select * into room_row from public.rooms where id = p_room_id for update;
  if not found then
    return public.action_failure('VALIDATION_ERROR', 'Room not found.', 0);
  end if;
  if room_row.version <> p_expected_version then
    return public.action_failure(
      'STALE_ROOM_STATE',
      'The room changed before this source was added.',
      room_row.version,
      'Review the latest room state and retry if the source is still appropriate.'
    );
  end if;
  if room_row.phase = 'finalized' then
    return public.action_failure('ALREADY_FINALIZED', 'The finalized decision is immutable.', room_row.version);
  end if;
  if room_row.phase <> 'input' then
    return public.action_failure(
      'WRONG_PHASE',
      'Meeting sources can only be added while the room is gathering input.',
      room_row.version
    );
  end if;

  select id into actor_participant_id
  from public.participants
  where room_id = p_room_id
    and user_id = (select auth.uid())
    and kind = 'human'
    and status = 'active';
  if actor_participant_id is null then
    return public.action_failure(
      'NOT_AUTHORIZED',
      'Only an active admitted participant can add meeting sources.',
      room_row.version
    );
  end if;

  if p_title is null or length(trim(p_title)) = 0 or length(trim(p_title)) > 160
    or p_filename is null or length(trim(p_filename)) = 0 or length(trim(p_filename)) > 255
    or p_mime_type is null or length(trim(p_mime_type)) = 0 or length(trim(p_mime_type)) > 160
    or p_byte_size is null or p_byte_size < 0 or p_byte_size > 26214400
    or p_sha256 is null or p_sha256 !~ '^[a-f0-9]{64}$'
    or (is_pending and chunk_count <> 0)
    or (not is_pending and (chunk_count < 1 or chunk_count > 200)) then
    return public.action_failure('VALIDATION_ERROR', 'Meeting source input is invalid.', room_row.version);
  end if;

  select count(*) into existing_source_count
  from public.meeting_sources
  where room_id = p_room_id
    and uploaded_by_participant_id = actor_participant_id
    and status <> 'removed';
  if existing_source_count >= 10 then
    return public.action_failure(
      'VALIDATION_ERROR',
      'A participant can attach at most 10 active meeting sources.',
      room_row.version
    );
  end if;

  select coalesce(sum(byte_size), 0) into room_byte_total
  from public.meeting_sources
  where room_id = p_room_id and status <> 'removed';
  if room_byte_total + p_byte_size > 104857600 then
    return public.action_failure(
      'VALIDATION_ERROR',
      'This room has reached its 100 MB meeting-source storage limit.',
      room_row.version
    );
  end if;

  new_status := case when is_pending then 'processing'::public.meeting_source_status
                     else 'ready'::public.meeting_source_status end;

  insert into public.meeting_sources (
    room_id, uploaded_by_participant_id, visibility, title, filename, mime_type,
    byte_size, sha256, status, summary, storage_bucket, storage_path, processed_at
  ) values (
    p_room_id, actor_participant_id, p_visibility, trim(p_title), trim(p_filename),
    trim(p_mime_type), p_byte_size, p_sha256, new_status,
    nullif(trim(coalesce(p_summary, '')), ''),
    nullif(trim(coalesce(p_storage_bucket, '')), ''),
    nullif(trim(coalesce(p_storage_path, '')), ''),
    case when new_status = 'ready' then now() else null end
  ) returning * into new_source;

  if not is_pending then
    foreach chunk_text in array p_chunks
    loop
      if chunk_text is null or length(trim(chunk_text)) = 0 or length(chunk_text) > 12000 then
        raise exception 'Invalid meeting source chunk';
      end if;
      insert into public.meeting_source_chunks (
        source_id, room_id, chunk_index, text, token_estimate
      ) values (
        new_source.id, p_room_id, chunk_index, chunk_text, ceil(length(chunk_text)::numeric / 4)::integer
      );
      chunk_index := chunk_index + 1;
    end loop;
  end if;

  next_version := room_row.version + 1;
  update public.rooms set version = next_version where id = p_room_id;
  insert into public.audit_events (
    room_id, actor_type, actor_id, origin, action, entity_type, entity_id,
    sanitized_input, result, previous_room_version, resulting_room_version,
    confirmation_required
  ) values (
    p_room_id, 'participant', actor_participant_id, p_origin, 'source.uploaded',
    'source', new_source.id,
    jsonb_build_object(
      'title', new_source.title,
      'filename', new_source.filename,
      'mimeType', new_source.mime_type,
      'byteSize', new_source.byte_size,
      'sha256', new_source.sha256,
      'visibility', new_source.visibility,
      'status', new_status,
      'chunkCount', chunk_count
    ),
    jsonb_build_object('ok', true), room_row.version, next_version, false
  );

  return public.action_success_data('Meeting source added.', next_version, public.meeting_source_dto(new_source));
exception when others then
  return public.action_failure('VALIDATION_ERROR', 'Meeting source input is invalid.', coalesce(room_row.version, 0));
end;
$$;

-- ---------------------------------------------------------------------------
-- processing -> ready
-- ---------------------------------------------------------------------------
create or replace function public.mark_meeting_source_processed(
  p_room_id text,
  p_source_id text,
  p_expected_version bigint,
  p_chunks text[],
  p_summary text,
  p_origin public.action_origin
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  room_row public.rooms;
  actor_participant_id text;
  source_row public.meeting_sources;
  chunk_text text;
  chunk_index integer := 0;
  next_version bigint;
begin
  select * into room_row from public.rooms where id = p_room_id for update;
  if not found then return public.action_failure('VALIDATION_ERROR', 'Room not found.', 0); end if;
  if room_row.version <> p_expected_version then
    return public.action_failure(
      'STALE_ROOM_STATE',
      'The room changed before this source action completed.',
      room_row.version,
      'Review the latest room state and retry if the source action is still appropriate.'
    );
  end if;
  if room_row.phase = 'finalized' then
    return public.action_failure('ALREADY_FINALIZED', 'The finalized decision is immutable.', room_row.version);
  end if;

  select id into actor_participant_id
  from public.participants
  where room_id = p_room_id and user_id = (select auth.uid()) and kind = 'human' and status = 'active';
  if actor_participant_id is null then
    return public.action_failure('NOT_AUTHORIZED', 'Only an active admitted participant can manage meeting sources.', room_row.version);
  end if;

  select * into source_row
  from public.meeting_sources
  where id = p_source_id and room_id = p_room_id and status <> 'removed'
  for update;
  if not found then
    return public.action_failure('VALIDATION_ERROR', 'Meeting source not found.', room_row.version);
  end if;
  if source_row.uploaded_by_participant_id <> actor_participant_id
    and room_row.owner_participant_id <> actor_participant_id then
    return public.action_failure('NOT_AUTHORIZED', 'Only the source uploader or room owner can manage this source.', room_row.version);
  end if;
  if source_row.status not in ('processing', 'failed') then
    return public.action_failure('VALIDATION_ERROR', 'Only a processing or failed source can be marked processed.', room_row.version);
  end if;
  if p_chunks is null or cardinality(p_chunks) < 1 or cardinality(p_chunks) > 200 then
    return public.action_failure('VALIDATION_ERROR', 'Meeting source processing input is invalid.', room_row.version);
  end if;

  delete from public.meeting_source_chunks where source_id = p_source_id;
  foreach chunk_text in array p_chunks
  loop
    if chunk_text is null or length(trim(chunk_text)) = 0 or length(chunk_text) > 12000 then
      raise exception 'Invalid meeting source chunk';
    end if;
    insert into public.meeting_source_chunks (
      source_id, room_id, chunk_index, text, token_estimate
    ) values (
      p_source_id, p_room_id, chunk_index, chunk_text, ceil(length(chunk_text)::numeric / 4)::integer
    );
    chunk_index := chunk_index + 1;
  end loop;

  update public.meeting_sources
  set status = 'ready',
      processed_at = now(),
      error_message = null,
      summary = coalesce(nullif(trim(coalesce(p_summary, '')), ''), summary)
  where id = p_source_id
  returning * into source_row;

  next_version := room_row.version + 1;
  update public.rooms set version = next_version where id = p_room_id;
  insert into public.audit_events (
    room_id, actor_type, actor_id, origin, action, entity_type, entity_id,
    sanitized_input, result, previous_room_version, resulting_room_version,
    confirmation_required
  ) values (
    p_room_id, 'participant', actor_participant_id, p_origin, 'source.processed',
    'source', source_row.id,
    jsonb_build_object('sourceId', source_row.id, 'chunkCount', cardinality(p_chunks)),
    jsonb_build_object('ok', true), room_row.version, next_version, false
  );

  return public.action_success_data('Meeting source processed.', next_version, public.meeting_source_dto(source_row));
exception when others then
  return public.action_failure('VALIDATION_ERROR', 'Meeting source processing input is invalid.', coalesce(room_row.version, 0));
end;
$$;

-- ---------------------------------------------------------------------------
-- processing / uploading / failed -> failed (retryable)
-- ---------------------------------------------------------------------------
create or replace function public.mark_meeting_source_failed(
  p_room_id text,
  p_source_id text,
  p_expected_version bigint,
  p_error_message text,
  p_origin public.action_origin
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  room_row public.rooms;
  actor_participant_id text;
  source_row public.meeting_sources;
  next_version bigint;
  trimmed_message text := left(trim(coalesce(p_error_message, '')), 500);
begin
  select * into room_row from public.rooms where id = p_room_id for update;
  if not found then return public.action_failure('VALIDATION_ERROR', 'Room not found.', 0); end if;
  if room_row.version <> p_expected_version then
    return public.action_failure(
      'STALE_ROOM_STATE',
      'The room changed before this source action completed.',
      room_row.version,
      'Review the latest room state and retry if the source action is still appropriate.'
    );
  end if;
  if room_row.phase = 'finalized' then
    return public.action_failure('ALREADY_FINALIZED', 'The finalized decision is immutable.', room_row.version);
  end if;
  if length(trimmed_message) = 0 then
    return public.action_failure('VALIDATION_ERROR', 'A failure reason is required.', room_row.version);
  end if;

  select id into actor_participant_id
  from public.participants
  where room_id = p_room_id and user_id = (select auth.uid()) and kind = 'human' and status = 'active';
  if actor_participant_id is null then
    return public.action_failure('NOT_AUTHORIZED', 'Only an active admitted participant can manage meeting sources.', room_row.version);
  end if;

  select * into source_row
  from public.meeting_sources
  where id = p_source_id and room_id = p_room_id and status <> 'removed'
  for update;
  if not found then
    return public.action_failure('VALIDATION_ERROR', 'Meeting source not found.', room_row.version);
  end if;
  if source_row.uploaded_by_participant_id <> actor_participant_id
    and room_row.owner_participant_id <> actor_participant_id then
    return public.action_failure('NOT_AUTHORIZED', 'Only the source uploader or room owner can manage this source.', room_row.version);
  end if;
  if source_row.status = 'ready' then
    return public.action_failure('VALIDATION_ERROR', 'A ready source cannot be marked failed.', room_row.version);
  end if;

  update public.meeting_sources
  set status = 'failed', error_message = trimmed_message, processed_at = now()
  where id = p_source_id
  returning * into source_row;

  next_version := room_row.version + 1;
  update public.rooms set version = next_version where id = p_room_id;
  insert into public.audit_events (
    room_id, actor_type, actor_id, origin, action, entity_type, entity_id,
    sanitized_input, result, previous_room_version, resulting_room_version,
    confirmation_required
  ) values (
    p_room_id, 'participant', actor_participant_id, p_origin, 'source.processing_failed',
    'source', source_row.id,
    jsonb_build_object('sourceId', source_row.id, 'errorMessage', trimmed_message),
    jsonb_build_object('ok', true), room_row.version, next_version, false
  );

  return public.action_success_data('Meeting source marked failed.', next_version, public.meeting_source_dto(source_row));
end;
$$;

revoke all on function public.create_meeting_source(
  text, bigint, text, text, text, integer, text,
  public.meeting_source_visibility, text[], text, boolean, text, text, public.action_origin
) from public, anon, authenticated;
revoke all on function public.mark_meeting_source_processed(text, text, bigint, text[], text, public.action_origin) from public, anon, authenticated;
revoke all on function public.mark_meeting_source_failed(text, text, bigint, text, public.action_origin) from public, anon, authenticated;

grant execute on function public.create_meeting_source(
  text, bigint, text, text, text, integer, text,
  public.meeting_source_visibility, text[], text, boolean, text, text, public.action_origin
) to authenticated;
grant execute on function public.mark_meeting_source_processed(text, text, bigint, text[], text, public.action_origin) to authenticated;
grant execute on function public.mark_meeting_source_failed(text, text, bigint, text, public.action_origin) to authenticated;

-- ---------------------------------------------------------------------------
-- Private raw-file bucket + path-scoped policies. Guarded so environments
-- whose local stack has not provisioned the storage schema still apply this
-- migration; hosted Supabase always has it.
--   path convention: rooms/<room_id>/sources/<sha256>/<filename>
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('storage.buckets') is null then
    return;
  end if;

  insert into storage.buckets (id, name, public)
  values ('meeting-sources', 'meeting-sources', false)
  on conflict (id) do nothing;

  execute $pol$
    drop policy if exists meeting_source_objects_read on storage.objects;
    create policy meeting_source_objects_read on storage.objects for select to authenticated
      using (
        bucket_id = 'meeting-sources'
        and public.can_read_room((storage.foldername(name))[2])
      );
  $pol$;

  execute $pol$
    drop policy if exists meeting_source_objects_write on storage.objects;
    create policy meeting_source_objects_write on storage.objects for insert to authenticated
      with check (
        bucket_id = 'meeting-sources'
        and exists (
          select 1 from public.participants participant
          where participant.room_id = (storage.foldername(name))[2]
            and participant.user_id = (select auth.uid())
            and participant.status = 'active'
        )
      );
  $pol$;

  execute $pol$
    drop policy if exists meeting_source_objects_delete on storage.objects;
    create policy meeting_source_objects_delete on storage.objects for delete to authenticated
      using (
        bucket_id = 'meeting-sources'
        and exists (
          select 1 from public.participants participant
          where participant.room_id = (storage.foldername(name))[2]
            and participant.user_id = (select auth.uid())
            and participant.status = 'active'
        )
      );
  $pol$;
end;
$$;

comment on column public.meeting_sources.storage_path is
  'Private-bucket key for the raw bytes: rooms/<room_id>/sources/<sha256>/<filename>. Never projected into RoomState.';
