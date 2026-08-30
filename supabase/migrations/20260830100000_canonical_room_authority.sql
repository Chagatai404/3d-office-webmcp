-- Slice 1 / Gate 1: canonical meeting authority and creator-only room creation.
-- Legacy seat invitations and required_for_approval remain private compatibility
-- details until the admission and alignment slices replace them.

create type public.meeting_role as enum ('owner', 'cohost', 'participant');
create type public.decision_role as enum ('decision_maker', 'contributor', 'advisor');
create type public.decision_policy as enum ('owner_decides', 'equal_authority_consensus');

alter table public.participants
  add column meeting_role public.meeting_role not null default 'participant',
  add column decision_role public.decision_role not null default 'contributor';

alter table public.rooms
  add column owner_participant_id text,
  add column decision_policy public.decision_policy not null default 'owner_decides';

-- Backfill already-created databases before making the owner pointer mandatory.
with selected_owners as (
  select room.id as room_id,
    coalesce(
      (
        select participant.id
        from public.participants participant
        where participant.room_id = room.id
          and participant.user_id = room.organizer_user_id
        order by participant.seat_order
        limit 1
      ),
      (
        select participant.id
        from public.participants participant
        where participant.room_id = room.id
        order by
          case when participant.kind = 'human' then 0 else 1 end,
          participant.seat_order
        limit 1
      )
    ) as participant_id
  from public.rooms room
)
update public.rooms room
set owner_participant_id = selected_owners.participant_id
from selected_owners
where selected_owners.room_id = room.id;

update public.participants participant
set meeting_role = case
      when participant.id = room.owner_participant_id then 'owner'::public.meeting_role
      else 'participant'::public.meeting_role
    end,
    decision_role = case
      when participant.id = room.owner_participant_id then 'decision_maker'::public.decision_role
      when participant.kind = 'simulation' then 'advisor'::public.decision_role
      when participant.required_for_approval then 'decision_maker'::public.decision_role
      else 'contributor'::public.decision_role
    end
from public.rooms room
where room.id = participant.room_id;

alter table public.rooms
  alter column owner_participant_id set not null,
  add constraint rooms_owner_participant_fk
    foreign key (owner_participant_id)
    references public.participants(id)
    deferrable initially deferred;

create unique index participants_one_owner_per_room_idx
  on public.participants(room_id)
  where meeting_role = 'owner';

comment on column public.rooms.owner_participant_id is
  'Canonical participant identity of the meeting owner. Auth user ids never enter RoomState.';
comment on column public.rooms.decision_policy is
  'Persisted decision authority policy. Full policy-aware finalization arrives in a later slice.';
comment on column public.participants.meeting_role is
  'Meeting authority; independent from the human-readable role label.';
comment on column public.participants.decision_role is
  'Decision authority; independent from meeting authority and action origin.';
comment on column public.participants.required_for_approval is
  'DEPRECATED private compatibility field for the legacy approval engine. Never expose as canonical authority.';
comment on column public.rooms.organizer_user_id is
  'DEPRECATED compatibility identity for legacy seat-invitation functions. Canonical meeting authority is owner_participant_id plus meeting_role.';

-- Preserve the old helper name for existing phase code while changing its
-- authority source from a room-level auth ID to the canonical owner membership.
create or replace function public.is_room_organizer(target_room_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.rooms room
    join public.participants participant
      on participant.room_id = room.id
     and participant.id = room.owner_participant_id
    where room.id = target_room_id
      and participant.meeting_role = 'owner'
      and participant.user_id = (select auth.uid())
  );
$$;

-- Internal/demo fixture rebuilds may reinsert a known owner participant. Keep
-- the authority columns derived from the room pointer rather than trusting the
-- insert payload for that participant.
create or replace function public.derive_owner_participant_authority()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.rooms room
    where room.id = new.room_id and room.owner_participant_id = new.id
  ) then
    new.meeting_role := 'owner';
    new.decision_role := 'decision_maker';
  elsif new.kind = 'simulation' then
    new.decision_role := 'advisor';
  elsif new.required_for_approval then
    -- TODO(Slice 3+): remove this legacy compatibility derivation when the
    -- approval engine is replaced by policy-aware alignment/finalization.
    new.decision_role := 'decision_maker';
  end if;
  return new;
end;
$$;

create trigger participants_derive_owner_authority
before insert or update on public.participants
for each row execute function public.derive_owner_participant_authority();

revoke all on function public.derive_owner_participant_authority() from public;

-- A deferred cross-table assertion lets creation insert the mutually-referencing
-- room and participant in either order while rejecting mismatched or duplicate
-- owners at transaction commit.
create or replace function public.assert_room_owner_invariant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_room_id text;
  expected_owner_id text;
  owner_count integer;
  matching_owner_count integer;
begin
  if tg_table_name = 'rooms' then
    target_room_id := case when tg_op = 'DELETE' then old.id else new.id end;
  else
    target_room_id := case when tg_op = 'DELETE' then old.room_id else new.room_id end;
  end if;

  select room.owner_participant_id
  into expected_owner_id
  from public.rooms room
  where room.id = target_room_id;

  -- Cascading deletion of a room has no invariant left to protect.
  if not found then
    return null;
  end if;

  select count(*), count(*) filter (where participant.id = expected_owner_id)
  into owner_count, matching_owner_count
  from public.participants participant
  where participant.room_id = target_room_id
    and participant.meeting_role = 'owner';

  if owner_count <> 1 or matching_owner_count <> 1 then
    raise exception 'room % must have exactly one owner matching owner_participant_id', target_room_id
      using errcode = '23514';
  end if;
  return null;
end;
$$;

create constraint trigger rooms_owner_invariant
after insert or update on public.rooms
deferrable initially deferred
for each row execute function public.assert_room_owner_invariant();

create constraint trigger participants_owner_invariant
after insert or update or delete on public.participants
deferrable initially deferred
for each row execute function public.assert_room_owner_invariant();

revoke all on function public.assert_room_owner_invariant() from public;

-- Remove the public production entry point that accepted predetermined seats.
revoke all on function public.create_room(text, text, jsonb, public.action_origin) from public;
drop function public.create_room(text, text, jsonb, public.action_origin);

create function public.create_room(
  p_title text,
  p_brief text,
  p_creator_name text,
  p_creator_role text,
  p_decision_policy public.decision_policy,
  p_origin public.action_origin
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  creator_user_id uuid := (select auth.uid());
  new_room_id text;
  owner_participant_id text := gen_random_uuid()::text;
  attempt int;
begin
  if creator_user_id is null then
    return public.action_failure('NOT_AUTHORIZED', 'An authenticated session is required.', 0);
  end if;
  if p_title is null or length(trim(p_title)) = 0 or length(trim(p_title)) > 160
    or p_brief is null or length(trim(p_brief)) = 0 or length(trim(p_brief)) > 4000
    or p_creator_name is null or length(trim(p_creator_name)) = 0 or length(trim(p_creator_name)) > 120
    or p_creator_role is null or length(trim(p_creator_role)) = 0 or length(trim(p_creator_role)) > 120 then
    return public.action_failure('VALIDATION_ERROR', 'Room and creator details are invalid.', 0);
  end if;

  new_room_id := null;
  for attempt in 1..8 loop
    begin
      insert into public.rooms (
        id, title, brief, phase, version, organizer_user_id,
        owner_participant_id, decision_policy
      ) values (
        public.generate_room_id(), trim(p_title), trim(p_brief), 'input', 0,
        creator_user_id, owner_participant_id, p_decision_policy
      ) returning id into new_room_id;
      exit;
    exception when unique_violation then
      new_room_id := null;
    end;
  end loop;
  if new_room_id is null then
    return public.action_failure('VALIDATION_ERROR', 'Could not allocate a room id; retry.', 0);
  end if;

  insert into public.participants (
    id, room_id, user_id, name, role, kind, meeting_role, decision_role,
    required_for_approval
  ) values (
    owner_participant_id, new_room_id, creator_user_id, trim(p_creator_name),
    trim(p_creator_role), 'human', 'owner', 'decision_maker', true
  );

  insert into public.audit_events (
    room_id, actor_type, actor_id, origin, action, entity_type, entity_id,
    sanitized_input, result, previous_room_version, resulting_room_version,
    confirmation_required
  ) values (
    new_room_id, 'participant', owner_participant_id, p_origin, 'room.created',
    'room', new_room_id,
    jsonb_build_object(
      'title', trim(p_title),
      'brief', trim(p_brief),
      'creatorName', trim(p_creator_name),
      'creatorRole', trim(p_creator_role),
      'decisionPolicy', p_decision_policy
    ),
    jsonb_build_object('ok', true, 'participantCount', 1),
    0, 0, false
  );

  return public.action_success_data(
    'Room created.',
    0,
    jsonb_build_object(
      'roomId', new_room_id,
      'ownerParticipantId', owner_participant_id
    )
  );
end;
$$;

revoke all on function public.create_room(
  text, text, text, text, public.decision_policy, public.action_origin
) from public;
grant execute on function public.create_room(
  text, text, text, text, public.decision_policy, public.action_origin
) to authenticated;

-- TODO(Slice 3+): replace required_for_approval reads in the legacy voting and
-- approval functions with decision-policy-aware alignment/finalization rules.
