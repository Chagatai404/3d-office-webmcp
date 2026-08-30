-- Slice 2 / Gate 2: generic join capabilities and owner-controlled admission.

create type public.join_request_status as enum ('waiting', 'admitted', 'rejected', 'cancelled');

alter table public.rooms add column passcode_hash text;

create table public.room_invites (
  id text primary key default gen_random_uuid()::text,
  room_id text not null references public.rooms(id) on delete cascade,
  token_hash text not null unique,
  created_by_participant_id text not null references public.participants(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz
);

create table public.join_requests (
  id text primary key default gen_random_uuid()::text,
  room_id text not null references public.rooms(id) on delete cascade,
  requester_user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null check (length(trim(display_name)) between 1 and 120),
  role text not null check (length(trim(role)) between 1 and 120),
  status public.join_request_status not null default 'waiting',
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by_participant_id text references public.participants(id) on delete set null
);

create unique index join_requests_one_waiting_per_user_room
  on public.join_requests(room_id, requester_user_id) where status = 'waiting';
create index join_requests_room_status_created_idx
  on public.join_requests(room_id, status, created_at);

alter table public.room_invites enable row level security;
alter table public.join_requests enable row level security;
revoke all on table public.room_invites from anon, authenticated;
revoke all on table public.join_requests from anon, authenticated;

-- Waiting outsiders may inspect only their own request row. Secrets remain
-- RPC-only and the owner list is returned through a canonical DTO.
grant select (id, room_id, display_name, role, status, created_at, resolved_at)
  on public.join_requests to authenticated;
create policy join_requests_read_own
  on public.join_requests for select to authenticated
  using (requester_user_id = (select auth.uid()));

-- A table-level rooms SELECT grant would expose newly added secret columns.
revoke select on table public.rooms from authenticated;
grant select (
  id, title, brief, phase, version, active_proposal_id, created_at, finalized_at,
  demo_mode, owner_participant_id, decision_policy, decision_candidate,
  decision_hash, final_record
) on public.rooms to authenticated;

-- pgcrypto lives in the `extensions` schema in this project (installed by the
-- platform bootstrap, not by `create extension` in a migration), so every
-- pgcrypto call needs an explicit schema qualifier under `search_path = ''`.
create or replace function public.hash_room_passcode(p_passcode text)
returns text language sql volatile security definer set search_path = '' as $$
  select extensions.crypt(p_passcode, extensions.gen_salt('bf', 10));
$$;

create or replace function public.verify_room_passcode(p_passcode text, p_hash text)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_hash is not null and extensions.crypt(p_passcode, p_hash) = p_hash;
$$;

create or replace function public.generate_room_passcode()
returns text language sql volatile set search_path = '' as $$
  select upper(substring(translate(encode(extensions.gen_random_bytes(8), 'base64'), '/+=', 'XYZ') from 1 for 8));
$$;

revoke all on function public.hash_room_passcode(text) from public;
revoke all on function public.verify_room_passcode(text, text) from public;
revoke all on function public.generate_room_passcode() from public;

create or replace function public.create_room(
  p_title text,
  p_brief text,
  p_creator_name text,
  p_creator_role text,
  p_decision_policy public.decision_policy,
  p_origin public.action_origin
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  creator_user_id uuid := (select auth.uid());
  new_room_id text;
  owner_participant_id text := gen_random_uuid()::text;
  raw_passcode text := public.generate_room_passcode();
  raw_invite_token text := public.generate_invite_token();
  attempt int;
begin
  if creator_user_id is null then
    return public.action_failure('NOT_AUTHORIZED', 'An authenticated session is required.', 0);
  end if;
  if p_title is null or length(trim(p_title)) not between 1 and 160
    or p_brief is null or length(trim(p_brief)) not between 1 and 4000
    or p_creator_name is null or length(trim(p_creator_name)) not between 1 and 120
    or p_creator_role is null or length(trim(p_creator_role)) not between 1 and 120 then
    return public.action_failure('VALIDATION_ERROR', 'Room and creator details are invalid.', 0);
  end if;

  for attempt in 1..8 loop
    begin
      insert into public.rooms (
        id, title, brief, phase, version, organizer_user_id, owner_participant_id,
        decision_policy, passcode_hash
      ) values (
        public.generate_room_id(), trim(p_title), trim(p_brief), 'input', 0,
        creator_user_id, owner_participant_id, p_decision_policy,
        public.hash_room_passcode(raw_passcode)
      ) returning id into new_room_id;
      exit;
    exception when unique_violation then new_room_id := null;
    end;
  end loop;
  if new_room_id is null then
    return public.action_failure('VALIDATION_ERROR', 'Could not allocate a room id; retry.', 0);
  end if;

  insert into public.participants (
    id, room_id, user_id, name, role, kind, meeting_role, decision_role, required_for_approval
  ) values (
    owner_participant_id, new_room_id, creator_user_id, trim(p_creator_name),
    trim(p_creator_role), 'human', 'owner', 'decision_maker', true
  );
  insert into public.room_invites (room_id, token_hash, created_by_participant_id)
  values (new_room_id, public.hash_invite_token(raw_invite_token), owner_participant_id);
  insert into public.audit_events (
    room_id, actor_type, actor_id, origin, action, entity_type, entity_id,
    sanitized_input, result, previous_room_version, resulting_room_version, confirmation_required
  ) values (
    new_room_id, 'participant', owner_participant_id, p_origin, 'room.created', 'room', new_room_id,
    jsonb_build_object('title', trim(p_title), 'brief', trim(p_brief), 'creatorName', trim(p_creator_name), 'creatorRole', trim(p_creator_role), 'decisionPolicy', p_decision_policy),
    jsonb_build_object('ok', true, 'participantCount', 1, 'joinAccessCreated', true), 0, 0, false
  );
  return public.action_success_data('Room created.', 0, jsonb_build_object(
    'roomId', new_room_id, 'ownerParticipantId', owner_participant_id,
    'passcode', raw_passcode, 'inviteToken', raw_invite_token
  ));
end;
$$;

create or replace function public.join_request_dto(request_row public.join_requests)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', request_row.id, 'roomId', request_row.room_id,
    'displayName', request_row.display_name, 'role', request_row.role,
    'status', request_row.status, 'createdAt', request_row.created_at,
    'resolvedAt', request_row.resolved_at
  );
$$;
revoke all on function public.join_request_dto(public.join_requests) from public;

create or replace function public.preview_room_invite(p_raw_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare invite_row public.room_invites; room_row public.rooms; owner_name text;
begin
  if (select auth.uid()) is null then return public.action_failure('NOT_AUTHORIZED', 'An authenticated session is required.', 0); end if;
  select * into invite_row from public.room_invites
    where token_hash = public.hash_invite_token(p_raw_token)
      and revoked_at is null and (expires_at is null or expires_at > now());
  if not found then return public.action_success_data('Invite checked.', 0, jsonb_build_object('inviteValid', false)); end if;
  select * into room_row from public.rooms where id = invite_row.room_id;
  select name into owner_name from public.participants where id = room_row.owner_participant_id;
  return public.action_success_data('Invite checked.', room_row.version, jsonb_build_object(
    'inviteValid', true, 'roomId', room_row.id, 'title', room_row.title,
    'brief', room_row.brief, 'ownerDisplayName', owner_name
  ));
end;
$$;

create or replace function public.create_or_reuse_join_request(
  p_room_id text, p_display_name text, p_role text, p_origin public.action_origin
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare requester uuid := (select auth.uid()); room_version bigint; request_row public.join_requests;
begin
  if requester is null then return public.action_failure('NOT_AUTHORIZED', 'An authenticated session is required.', 0); end if;
  if length(trim(p_display_name)) not between 1 and 120 or length(trim(p_role)) not between 1 and 120 then
    return public.action_failure('VALIDATION_ERROR', 'Join request details are invalid.', 0);
  end if;
  select version into room_version from public.rooms where id = p_room_id;
  if not found then return public.action_failure('INVALID_JOIN_CREDENTIALS', 'Room access details are invalid.', 0); end if;
  if exists (select 1 from public.participants where room_id = p_room_id and user_id = requester) then
    return public.action_failure('ALREADY_PARTICIPANT', 'This session already belongs to the room.', room_version, 'Open the room directly.');
  end if;
  select * into request_row from public.join_requests
    where room_id = p_room_id and requester_user_id = requester and status = 'waiting';
  if not found then
    insert into public.join_requests(room_id, requester_user_id, display_name, role)
    values (p_room_id, requester, trim(p_display_name), trim(p_role)) returning * into request_row;
    insert into public.audit_events(room_id, actor_type, actor_id, origin, action, entity_type, entity_id, sanitized_input, result, previous_room_version, resulting_room_version, confirmation_required)
    values (p_room_id, 'system', null, p_origin, 'join.requested', 'join_request', request_row.id,
      jsonb_build_object('displayName', request_row.display_name, 'role', request_row.role), jsonb_build_object('status', 'waiting'), room_version, room_version, false);
  end if;
  return public.action_success_data('Waiting for the meeting owner.', room_version,
    jsonb_build_object('roomId', p_room_id, 'joinRequest', public.join_request_dto(request_row)));
end;
$$;
revoke all on function public.create_or_reuse_join_request(text, text, text, public.action_origin) from public;

create or replace function public.request_join_by_passcode(
  p_room_id text, p_passcode text, p_display_name text, p_role text, p_origin public.action_origin
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare stored_hash text;
begin
  select passcode_hash into stored_hash from public.rooms where id = p_room_id and phase <> 'finalized';
  if not found or not public.verify_room_passcode(p_passcode, stored_hash) then
    return public.action_failure('INVALID_JOIN_CREDENTIALS', 'Room access details are invalid.', 0);
  end if;
  return public.create_or_reuse_join_request(p_room_id, p_display_name, p_role, p_origin);
end;
$$;

create or replace function public.request_join_by_invite(
  p_raw_token text, p_display_name text, p_role text, p_origin public.action_origin
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare target_room_id text;
begin
  select room_id into target_room_id from public.room_invites
    where token_hash = public.hash_invite_token(p_raw_token) and revoked_at is null
      and (expires_at is null or expires_at > now());
  if not found then return public.action_failure('INVALID_JOIN_CREDENTIALS', 'Invitation is invalid or unavailable.', 0); end if;
  if exists (select 1 from public.rooms where id = target_room_id and phase = 'finalized') then
    return public.action_failure('ALREADY_FINALIZED', 'This room no longer accepts join requests.', 0);
  end if;
  return public.create_or_reuse_join_request(target_room_id, p_display_name, p_role, p_origin);
end;
$$;

create or replace function public.get_my_join_request(p_join_request_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare request_row public.join_requests; room_version bigint;
begin
  select * into request_row from public.join_requests
    where id = p_join_request_id and requester_user_id = (select auth.uid());
  if not found then return public.action_failure('NOT_AUTHORIZED', 'Join request unavailable.', 0); end if;
  select version into room_version from public.rooms where id = request_row.room_id;
  return public.action_success_data('Join request loaded.', room_version, public.join_request_dto(request_row));
end;
$$;

create or replace function public.list_join_requests(p_room_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare room_version bigint; requests jsonb;
begin
  select version into room_version from public.rooms where id = p_room_id;
  if not found or not public.is_room_organizer(p_room_id) then
    return public.action_failure('NOT_AUTHORIZED', 'Only the current room owner can view the waiting room.', coalesce(room_version, 0));
  end if;
  select coalesce(jsonb_agg(public.join_request_dto(request_row) order by request_row.created_at), '[]'::jsonb)
  into requests from public.join_requests request_row where room_id = p_room_id and status = 'waiting';
  return public.action_success_data('Waiting room loaded.', room_version, requests);
end;
$$;

create or replace function public.resolve_join_request(
  p_room_id text, p_join_request_id text, p_expected_version bigint,
  p_origin public.action_origin, p_resolution public.join_request_status
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare room_row public.rooms; request_row public.join_requests; owner_id text; next_version bigint; participant_id text;
begin
  if p_resolution not in ('admitted', 'rejected') then return public.action_failure('VALIDATION_ERROR', 'Invalid join resolution.', 0); end if;
  select * into room_row from public.rooms where id = p_room_id for update;
  if not found then return public.action_failure('VALIDATION_ERROR', 'Room not found.', 0); end if;
  if room_row.version <> p_expected_version then return public.action_failure('STALE_ROOM_STATE', 'The room changed before this action completed.', room_row.version); end if;
  if room_row.phase = 'finalized' then return public.action_failure('ALREADY_FINALIZED', 'The finalized room is immutable.', room_row.version); end if;
  select participant.id into owner_id from public.participants participant
    where participant.id = room_row.owner_participant_id and participant.room_id = p_room_id
      and participant.meeting_role = 'owner' and participant.user_id = (select auth.uid());
  if not found then return public.action_failure('NOT_AUTHORIZED', 'Only the current room owner can manage the waiting room.', room_row.version); end if;
  select * into request_row from public.join_requests where id = p_join_request_id and room_id = p_room_id for update;
  if not found then return public.action_failure('NOT_AUTHORIZED', 'Join request unavailable.', room_row.version); end if;
  if request_row.status <> 'waiting' then return public.action_failure('REQUEST_ALREADY_RESOLVED', 'This join request has already been resolved.', room_row.version); end if;
  if p_resolution = 'admitted' then
    if exists (select 1 from public.participants where room_id = p_room_id and user_id = request_row.requester_user_id) then
      return public.action_failure('ALREADY_PARTICIPANT', 'This session already belongs to the room.', room_row.version);
    end if;
    if exists (select 1 from public.participants where room_id = p_room_id and name = request_row.display_name) then
      return public.action_failure('VALIDATION_ERROR', 'That display name is already in use.', room_row.version, 'Ask the requester to use another display name.');
    end if;
    participant_id := gen_random_uuid()::text;
    insert into public.participants(id, room_id, user_id, name, role, kind, meeting_role, decision_role, required_for_approval)
    values (participant_id, p_room_id, request_row.requester_user_id, request_row.display_name, request_row.role, 'human', 'participant', 'contributor', false);
  end if;
  update public.join_requests set status = p_resolution, resolved_at = now(), resolved_by_participant_id = owner_id
    where id = request_row.id returning * into request_row;
  next_version := room_row.version + 1;
  update public.rooms set version = next_version where id = p_room_id;
  insert into public.audit_events(room_id, actor_type, actor_id, origin, action, entity_type, entity_id, sanitized_input, result, previous_room_version, resulting_room_version, confirmation_required)
  values (p_room_id, 'participant', owner_id, p_origin,
    case when p_resolution = 'admitted' then 'join.admitted' else 'join.rejected' end,
    'join_request', request_row.id, jsonb_build_object('joinRequestId', request_row.id),
    jsonb_strip_nulls(jsonb_build_object('status', p_resolution, 'participantId', participant_id)), room_row.version, next_version, false);
  return public.action_success_data(case when p_resolution = 'admitted' then 'Participant admitted.' else 'Join request rejected.' end,
    next_version, public.join_request_dto(request_row));
end;
$$;
revoke all on function public.resolve_join_request(text, text, bigint, public.action_origin, public.join_request_status) from public;

create or replace function public.admit_join_request(p_room_id text, p_join_request_id text, p_expected_version bigint, p_origin public.action_origin)
returns jsonb language sql security definer set search_path = '' as $$
  select public.resolve_join_request(p_room_id, p_join_request_id, p_expected_version, p_origin, 'admitted');
$$;
create or replace function public.reject_join_request(p_room_id text, p_join_request_id text, p_expected_version bigint, p_origin public.action_origin)
returns jsonb language sql security definer set search_path = '' as $$
  select public.resolve_join_request(p_room_id, p_join_request_id, p_expected_version, p_origin, 'rejected');
$$;

revoke all on function public.preview_room_invite(text) from public;
revoke all on function public.request_join_by_passcode(text, text, text, text, public.action_origin) from public;
revoke all on function public.request_join_by_invite(text, text, text, public.action_origin) from public;
revoke all on function public.get_my_join_request(text) from public;
revoke all on function public.list_join_requests(text) from public;
revoke all on function public.admit_join_request(text, text, bigint, public.action_origin) from public;
revoke all on function public.reject_join_request(text, text, bigint, public.action_origin) from public;
grant execute on function public.preview_room_invite(text) to authenticated;
grant execute on function public.request_join_by_passcode(text, text, text, text, public.action_origin) to authenticated;
grant execute on function public.request_join_by_invite(text, text, text, public.action_origin) to authenticated;
grant execute on function public.get_my_join_request(text) to authenticated;
grant execute on function public.list_join_requests(text) to authenticated;
grant execute on function public.admit_join_request(text, text, bigint, public.action_origin) to authenticated;
grant execute on function public.reject_join_request(text, text, bigint, public.action_origin) to authenticated;

-- Remove browser execution of the legacy predetermined-seat onboarding RPCs.
revoke execute on function public.preview_room_invitation(text) from authenticated;
revoke execute on function public.claim_room_invitation(text, public.action_origin) from authenticated;
revoke execute on function public.regenerate_room_invitation(text, bigint, text, public.action_origin) from authenticated;
revoke execute on function public.revoke_room_invitation(text, bigint, text, public.action_origin) from authenticated;
