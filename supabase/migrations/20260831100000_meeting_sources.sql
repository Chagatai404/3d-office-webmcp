create type public.meeting_source_visibility as enum (
  'shared_room',
  'private_to_participant'
);

create type public.meeting_source_status as enum (
  'uploading',
  'processing',
  'ready',
  'failed',
  'removed'
);

create table public.meeting_sources (
  id text primary key default gen_random_uuid()::text,
  room_id text not null references public.rooms(id) on delete cascade,
  uploaded_by_participant_id text not null references public.participants(id) on delete cascade,
  visibility public.meeting_source_visibility not null,
  title text not null check (length(trim(title)) > 0),
  filename text not null check (length(trim(filename)) > 0),
  mime_type text not null check (length(trim(mime_type)) > 0),
  byte_size integer not null check (byte_size >= 0),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  status public.meeting_source_status not null default 'ready',
  summary text,
  error_message text,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  removed_at timestamptz
);

create table public.meeting_source_chunks (
  id text primary key default gen_random_uuid()::text,
  source_id text not null references public.meeting_sources(id) on delete cascade,
  room_id text not null references public.rooms(id) on delete cascade,
  chunk_index integer not null check (chunk_index >= 0),
  text text not null check (length(trim(text)) > 0),
  token_estimate integer not null default 0 check (token_estimate >= 0),
  created_at timestamptz not null default now(),
  unique (source_id, chunk_index)
);

create index meeting_sources_room_id_created_at_idx
  on public.meeting_sources(room_id, created_at);
create index meeting_sources_uploader_idx
  on public.meeting_sources(uploaded_by_participant_id);
create index meeting_source_chunks_source_index_idx
  on public.meeting_source_chunks(source_id, chunk_index);

alter table public.meeting_sources enable row level security;
alter table public.meeting_source_chunks enable row level security;

revoke all on table public.meeting_sources from anon, authenticated;
revoke all on table public.meeting_source_chunks from anon, authenticated;
grant select on table public.meeting_sources to authenticated;
grant select on table public.meeting_source_chunks to authenticated;

create or replace function public.can_read_meeting_source(target_source_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.meeting_sources source
    where source.id = target_source_id
      and source.status <> 'removed'
      and (
        (
          source.visibility = 'shared_room'
          and public.can_read_room(source.room_id)
        )
        or exists (
          select 1
          from public.participants participant
          where participant.id = source.uploaded_by_participant_id
            and participant.room_id = source.room_id
            and participant.user_id = (select auth.uid())
            and participant.status = 'active'
        )
      )
  );
$$;

revoke all on function public.can_read_meeting_source(text) from public, anon, authenticated;
grant execute on function public.can_read_meeting_source(text) to authenticated;

create policy meeting_sources_readable_by_allowed_participants
  on public.meeting_sources for select to authenticated
  using (public.can_read_meeting_source(id));

create policy meeting_source_chunks_readable_by_allowed_participants
  on public.meeting_source_chunks for select to authenticated
  using (public.can_read_meeting_source(source_id));

create trigger meeting_sources_prevent_finalized_mutation
before insert or update or delete on public.meeting_sources
for each row execute function public.prevent_finalized_entity_mutation();

create trigger meeting_source_chunks_prevent_finalized_mutation
before insert or update or delete on public.meeting_source_chunks
for each row execute function public.prevent_finalized_entity_mutation();

comment on table public.meeting_sources is
  'Participant-attached meeting source metadata. Raw/extracted content is not projected into RoomState; agents read permitted chunks through source-specific tools.';
comment on table public.meeting_source_chunks is
  'Extracted source text chunks. Source text is participant-provided untrusted content and must not be treated as instructions.';

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
    'createdAt', source_row.created_at,
    'processedAt', source_row.processed_at,
    'removedAt', source_row.removed_at
  );
$$;

revoke all on function public.meeting_source_dto(public.meeting_sources) from public, anon, authenticated;

create or replace function public.list_meeting_sources(p_room_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  room_version bigint;
  sources jsonb;
begin
  select version into room_version from public.rooms where id = p_room_id;
  if not found or not public.can_read_room(p_room_id) then
    return public.action_failure('NOT_AUTHORIZED', 'This room is not available in the current session.', 0);
  end if;

  select coalesce(jsonb_agg(public.meeting_source_dto(source_row) order by source_row.created_at), '[]'::jsonb)
  into sources
  from public.meeting_sources source_row
  where source_row.room_id = p_room_id
    and public.can_read_meeting_source(source_row.id);

  return public.action_success_data('Meeting sources loaded.', room_version, sources);
end;
$$;

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
  new_source public.meeting_sources;
  chunk_text text;
  chunk_index integer := 0;
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
    or p_chunks is null or cardinality(p_chunks) < 1 or cardinality(p_chunks) > 200 then
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

  insert into public.meeting_sources (
    room_id, uploaded_by_participant_id, visibility, title, filename, mime_type,
    byte_size, sha256, status, summary, processed_at
  ) values (
    p_room_id, actor_participant_id, p_visibility, trim(p_title), trim(p_filename),
    trim(p_mime_type), p_byte_size, p_sha256, 'ready', nullif(trim(coalesce(p_summary, '')), ''),
    now()
  ) returning * into new_source;

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
      'chunkCount', cardinality(p_chunks)
    ),
    jsonb_build_object('ok', true), room_row.version, next_version, false
  );

  return public.action_success_data('Meeting source added.', next_version, public.meeting_source_dto(new_source));
exception when others then
  return public.action_failure('VALIDATION_ERROR', 'Meeting source input is invalid.', coalesce(room_row.version, 0));
end;
$$;

create or replace function public.read_meeting_source_content(
  p_room_id text,
  p_source_id text,
  p_cursor text,
  p_max_chunks integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  room_version bigint;
  start_index integer := 0;
  total_chunks integer;
  chunks jsonb;
  next_cursor text;
begin
  select version into room_version from public.rooms where id = p_room_id;
  if not found or not public.can_read_room(p_room_id) then
    return public.action_failure('NOT_AUTHORIZED', 'This room is not available in the current session.', 0);
  end if;
  if p_source_id is null or not exists (
    select 1
    from public.meeting_sources source
    where source.id = p_source_id
      and source.room_id = p_room_id
      and public.can_read_meeting_source(source.id)
  ) then
    return public.action_failure('NOT_AUTHORIZED', 'That meeting source is not available in this session.', room_version);
  end if;
  if p_max_chunks is null or p_max_chunks < 1 or p_max_chunks > 20 then
    return public.action_failure('VALIDATION_ERROR', 'Meeting source read input is invalid.', room_version);
  end if;
  if p_cursor is not null and p_cursor <> '' then
    if p_cursor !~ '^[0-9]+$' then
      return public.action_failure('VALIDATION_ERROR', 'Meeting source read cursor is invalid.', room_version);
    end if;
    start_index := p_cursor::integer;
  end if;

  select count(*) into total_chunks
  from public.meeting_source_chunks chunk
  where chunk.room_id = p_room_id and chunk.source_id = p_source_id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', chunk.id,
        'sourceId', chunk.source_id,
        'chunkIndex', chunk.chunk_index,
        'text', chunk.text,
        'tokenEstimate', chunk.token_estimate
      )
      order by chunk.chunk_index
    ),
    '[]'::jsonb
  )
  into chunks
  from public.meeting_source_chunks chunk
  where chunk.room_id = p_room_id
    and chunk.source_id = p_source_id
    and chunk.chunk_index >= start_index
    and chunk.chunk_index < start_index + p_max_chunks;

  next_cursor := case
    when start_index + jsonb_array_length(chunks) < total_chunks
      then (start_index + jsonb_array_length(chunks))::text
    else null
  end;

  return public.action_success_data(
    'Meeting source content loaded.',
    room_version,
    jsonb_build_object('sourceId', p_source_id, 'chunks', chunks, 'nextCursor', next_cursor)
  );
end;
$$;

create or replace function public.search_meeting_sources(
  p_room_id text,
  p_query text,
  p_source_ids text[],
  p_limit integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  room_version bigint;
  normalized_query text := lower(trim(coalesce(p_query, '')));
  results jsonb;
begin
  select version into room_version from public.rooms where id = p_room_id;
  if not found or not public.can_read_room(p_room_id) then
    return public.action_failure('NOT_AUTHORIZED', 'This room is not available in the current session.', 0);
  end if;
  if length(normalized_query) = 0 or length(normalized_query) > 240
    or p_limit is null or p_limit < 1 or p_limit > 20
    or p_source_ids is null or cardinality(p_source_ids) > 20 then
    return public.action_failure('VALIDATION_ERROR', 'Meeting source search input is invalid.', room_version);
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'sourceId', matched.source_id,
        'sourceTitle', matched.source_title,
        'chunkId', matched.chunk_id,
        'chunkIndex', matched.chunk_index,
        'excerpt', matched.excerpt
      )
      order by matched.chunk_index
    ),
    '[]'::jsonb
  )
  into results
  from (
    select
      source.id as source_id,
      source.title as source_title,
      chunk.id as chunk_id,
      chunk.chunk_index,
      substring(chunk.text from greatest(1, strpos(lower(chunk.text), normalized_query) - 120) for 320) as excerpt
    from public.meeting_source_chunks chunk
    join public.meeting_sources source on source.id = chunk.source_id
    where source.room_id = p_room_id
      and source.status = 'ready'
      and public.can_read_meeting_source(source.id)
      and (cardinality(p_source_ids) = 0 or source.id = any(p_source_ids))
      and lower(chunk.text) like '%' || normalized_query || '%'
    order by source.created_at, chunk.chunk_index
    limit p_limit
  ) matched;

  return public.action_success_data(
    'Meeting sources searched.',
    room_version,
    jsonb_build_object('query', p_query, 'results', results)
  );
end;
$$;

create or replace function public.share_meeting_source(
  p_room_id text,
  p_source_id text,
  p_expected_version bigint,
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
  where room_id = p_room_id
    and user_id = (select auth.uid())
    and kind = 'human'
    and status = 'active';
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
    return public.action_failure('NOT_AUTHORIZED', 'Only the source uploader or room owner can share this source.', room_row.version);
  end if;
  if source_row.visibility = 'shared_room' then
    return public.action_success_data('Meeting source already shared.', room_row.version, public.meeting_source_dto(source_row));
  end if;

  next_version := room_row.version + 1;
  update public.meeting_sources
  set visibility = 'shared_room'
  where id = p_source_id
  returning * into source_row;
  update public.rooms set version = next_version where id = p_room_id;
  insert into public.audit_events (
    room_id, actor_type, actor_id, origin, action, entity_type, entity_id,
    sanitized_input, result, previous_room_version, resulting_room_version,
    confirmation_required
  ) values (
    p_room_id, 'participant', actor_participant_id, p_origin, 'source.shared',
    'source', source_row.id,
    jsonb_build_object('sourceId', source_row.id, 'visibility', source_row.visibility),
    jsonb_build_object('ok', true), room_row.version, next_version, false
  );

  return public.action_success_data('Meeting source shared.', next_version, public.meeting_source_dto(source_row));
end;
$$;

create or replace function public.remove_meeting_source(
  p_room_id text,
  p_source_id text,
  p_expected_version bigint,
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
  where room_id = p_room_id
    and user_id = (select auth.uid())
    and kind = 'human'
    and status = 'active';
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
    return public.action_failure('NOT_AUTHORIZED', 'Only the source uploader or room owner can remove this source.', room_row.version);
  end if;

  next_version := room_row.version + 1;
  update public.meeting_sources
  set status = 'removed', removed_at = now()
  where id = p_source_id;
  update public.rooms set version = next_version where id = p_room_id;
  insert into public.audit_events (
    room_id, actor_type, actor_id, origin, action, entity_type, entity_id,
    sanitized_input, result, previous_room_version, resulting_room_version,
    confirmation_required
  ) values (
    p_room_id, 'participant', actor_participant_id, p_origin, 'source.removed',
    'source', source_row.id,
    jsonb_build_object('sourceId', source_row.id),
    jsonb_build_object('ok', true), room_row.version, next_version, false
  );

  return public.action_success('Meeting source removed.', next_version);
end;
$$;

revoke all on function public.list_meeting_sources(text) from public, anon, authenticated;
revoke all on function public.create_meeting_source(
  text, bigint, text, text, text, integer, text, public.meeting_source_visibility,
  text[], text, public.action_origin
) from public, anon, authenticated;
revoke all on function public.read_meeting_source_content(text, text, text, integer) from public, anon, authenticated;
revoke all on function public.search_meeting_sources(text, text, text[], integer) from public, anon, authenticated;
revoke all on function public.share_meeting_source(text, text, bigint, public.action_origin) from public, anon, authenticated;
revoke all on function public.remove_meeting_source(text, text, bigint, public.action_origin) from public, anon, authenticated;

grant execute on function public.list_meeting_sources(text) to authenticated;
grant execute on function public.create_meeting_source(
  text, bigint, text, text, text, integer, text, public.meeting_source_visibility,
  text[], text, public.action_origin
) to authenticated;
grant execute on function public.read_meeting_source_content(text, text, text, integer) to authenticated;
grant execute on function public.search_meeting_sources(text, text, text[], integer) to authenticated;
grant execute on function public.share_meeting_source(text, text, bigint, public.action_origin) to authenticated;
grant execute on function public.remove_meeting_source(text, text, bigint, public.action_origin) to authenticated;
