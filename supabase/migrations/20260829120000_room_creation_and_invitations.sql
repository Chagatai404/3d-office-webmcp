-- Slice A1: runtime room creation with a server-derived organizer, plus the
-- invitation capability primitives room creation depends on (Slice A2 adds
-- preview/claim on top of the same table and hashing helper).
--
-- Nothing here changes the seeded `demo` room or any demo-only function.

alter table public.rooms
  add column organizer_user_id uuid references auth.users(id) on delete set null;

comment on column public.rooms.organizer_user_id is
  'Server-derived room owner. Set from auth.uid() at creation; never accepted from a request body. Null for the seeded demo room.';

-- Seats must render in the order they were listed. Rows inserted in one
-- transaction share `created_at`, and claiming a seat rewrites its row, so
-- neither timestamp nor physical order is a stable sort key. A monotonic
-- default keeps every insert path -- demo seed, demo reset and room creation --
-- ordered without rewriting an earlier migration. Values are only ever compared
-- within a room, so a single global sequence is enough.
create sequence public.participants_seat_order_seq;

alter table public.participants
  add column seat_order bigint not null default nextval('public.participants_seat_order_seq');

comment on column public.participants.seat_order is
  'Monotonic insertion order used to render seats. Compared only within a room.';

-- An invitation is a capability for one predetermined seat. Only the SHA-256
-- hash of the raw token is stored, so the database never holds an invite secret.
create table public.room_invitations (
  id text primary key default gen_random_uuid()::text,
  room_id text not null references public.rooms(id) on delete cascade,
  participant_id text not null references public.participants(id) on delete cascade,
  token_hash text not null,
  created_by_user_id uuid references auth.users(id) on delete set null,
  expires_at timestamptz not null default now() + interval '7 days',
  claimed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (room_id, participant_id),
  unique (token_hash)
);

create index room_invitations_room_id_idx on public.room_invitations(room_id);

-- No policy is defined: invitations are reachable only through SECURITY DEFINER
-- functions, never through the data API.
alter table public.room_invitations enable row level security;
revoke all on table public.room_invitations from anon, authenticated;

create or replace function public.is_room_organizer(target_room_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.rooms
    where id = target_room_id
      and organizer_user_id is not null
      and organizer_user_id = (select auth.uid())
  );
$$;

-- Canonical invite-token hashing. Creation, preview and claim must all use this
-- function so a raw token is comparable only through its hash.
create or replace function public.hash_invite_token(p_raw_token text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(p_raw_token, 'UTF8')), 'hex');
$$;

-- 244 bits from the server CSPRNG behind gen_random_uuid().
create or replace function public.generate_invite_token()
returns text
language sql
volatile
set search_path = ''
as $$
  select replace(gen_random_uuid()::text, '-', '')
      || replace(gen_random_uuid()::text, '-', '');
$$;

-- Opaque, human-transcribable room id such as `rm_7P3KQ8M2`. The id is not a
-- security boundary: the invitation token is the capability.
create or replace function public.generate_room_id()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  alphabet constant text := '23456789ABCDEFGHJKMNPQRSTVWXYZ';
  entropy bytea := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
  candidate text := 'rm_';
  byte_index int;
begin
  for byte_index in 0..7 loop
    candidate := candidate || substr(
      alphabet,
      (get_byte(entropy, byte_index) % length(alphabet)) + 1,
      1
    );
  end loop;
  return candidate;
end;
$$;

-- Creates a private room owned by the calling session. The organizer takes the
-- first listed seat, so room membership (and therefore `can_read_room`) holds
-- without weakening any read policy; every other seat gets a single-use
-- invitation capability whose raw token is returned only here.
create or replace function public.create_room(
  p_title text,
  p_brief text,
  p_participants jsonb,
  p_origin public.action_origin
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  organizer_id uuid := (select auth.uid());
  participant_count int;
  participant_record record;
  participant_name text;
  participant_role text;
  required_flag jsonb;
  new_room_id text;
  new_participant_id text;
  organizer_participant_id text := null;
  raw_token text;
  invites jsonb := '[]'::jsonb;
  attempt int;
begin
  if organizer_id is null then
    return public.action_failure('NOT_AUTHORIZED', 'An authenticated session is required.', 0);
  end if;
  if p_title is null or length(trim(p_title)) = 0
    or p_brief is null or length(trim(p_brief)) = 0 then
    return public.action_failure('VALIDATION_ERROR', 'A room title and brief are required.', 0);
  end if;
  if p_participants is null or jsonb_typeof(p_participants) <> 'array' then
    return public.action_failure('VALIDATION_ERROR', 'Participants must be a list.', 0);
  end if;

  select count(*) into participant_count from jsonb_array_elements(p_participants);
  if participant_count < 2 then
    return public.action_failure('VALIDATION_ERROR', 'A room needs at least two participants.', 0);
  end if;

  for participant_record in
    select value from jsonb_array_elements(p_participants) as element(value)
  loop
    participant_name := trim(coalesce(participant_record.value->>'name', ''));
    participant_role := trim(coalesce(participant_record.value->>'role', ''));
    required_flag := participant_record.value->'requiredForApproval';
    if length(participant_name) = 0 or length(participant_role) = 0 then
      return public.action_failure('VALIDATION_ERROR', 'Every participant needs a name and a role.', 0);
    end if;
    if required_flag is null or jsonb_typeof(required_flag) <> 'boolean' then
      return public.action_failure(
        'VALIDATION_ERROR',
        'Every participant needs an explicit requiredForApproval flag.',
        0
      );
    end if;
  end loop;

  if (
    select count(distinct trim(value->>'name'))
    from jsonb_array_elements(p_participants) as element(value)
  ) <> participant_count then
    return public.action_failure('VALIDATION_ERROR', 'Participant names must be unique within a room.', 0);
  end if;

  new_room_id := null;
  for attempt in 1..8 loop
    begin
      insert into public.rooms (id, title, brief, phase, version, organizer_user_id)
      values (public.generate_room_id(), trim(p_title), trim(p_brief), 'input', 0, organizer_id)
      returning id into new_room_id;
      exit;
    exception when unique_violation then
      new_room_id := null;
    end;
  end loop;
  if new_room_id is null then
    return public.action_failure('VALIDATION_ERROR', 'Could not allocate a room id; retry.', 0);
  end if;

  for participant_record in
    select value, ordinality
    from jsonb_array_elements(p_participants) with ordinality as element(value, ordinality)
  loop
    new_participant_id := gen_random_uuid()::text;
    insert into public.participants (
      id, room_id, user_id, name, role, kind, required_for_approval
    ) values (
      new_participant_id,
      new_room_id,
      case when participant_record.ordinality = 1 then organizer_id else null end,
      trim(participant_record.value->>'name'),
      trim(participant_record.value->>'role'),
      'human',
      (participant_record.value->>'requiredForApproval')::boolean
    );

    if participant_record.ordinality = 1 then
      organizer_participant_id := new_participant_id;
    else
      raw_token := public.generate_invite_token();
      insert into public.room_invitations (
        room_id, participant_id, token_hash, created_by_user_id
      ) values (
        new_room_id, new_participant_id, public.hash_invite_token(raw_token), organizer_id
      );
      invites := invites || jsonb_build_object(
        'participantId', new_participant_id,
        'role', trim(participant_record.value->>'role'),
        'inviteToken', raw_token
      );
    end if;
  end loop;

  insert into public.audit_events (
    room_id, actor_type, actor_id, origin, action, entity_type, entity_id,
    sanitized_input, result, previous_room_version, resulting_room_version,
    confirmation_required
  ) values (
    new_room_id, 'participant', organizer_participant_id, p_origin, 'room.created',
    'room', new_room_id,
    jsonb_build_object(
      'title', trim(p_title),
      'brief', trim(p_brief),
      'participants', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'name', trim(value->>'name'),
          'role', trim(value->>'role'),
          'requiredForApproval', (value->>'requiredForApproval')::boolean
        )), '[]'::jsonb)
        from jsonb_array_elements(p_participants) as element(value)
      )
    ),
    jsonb_build_object('ok', true, 'invitationCount', jsonb_array_length(invites)),
    0, 0, false
  );

  return public.action_success_data(
    'Room created.',
    0,
    jsonb_build_object('roomId', new_room_id, 'participantInvites', invites)
  );
end;
$$;

revoke all on function public.is_room_organizer(text) from public;
revoke all on function public.hash_invite_token(text) from public;
revoke all on function public.generate_invite_token() from public;
revoke all on function public.generate_room_id() from public;
revoke all on function public.create_room(text, text, jsonb, public.action_origin) from public;

grant execute on function public.is_room_organizer(text) to authenticated;
grant execute on function public.create_room(text, text, jsonb, public.action_origin) to authenticated;
