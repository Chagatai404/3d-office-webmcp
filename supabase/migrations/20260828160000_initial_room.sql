create extension if not exists pgcrypto;

create type public.room_phase as enum (
  'input',
  'proposals',
  'deliberation',
  'voting',
  'approval',
  'finalized'
);

create type public.participant_kind as enum ('human', 'simulation');
create type public.proposal_status as enum (
  'draft',
  'candidate',
  'superseded',
  'accepted'
);
create type public.actor_type as enum ('participant', 'expert', 'system');
create type public.action_origin as enum (
  'manual_ui',
  'webmcp',
  'simulation',
  'expert_service',
  'system'
);
create type public.conflict_severity as enum ('blocking', 'warning');
create type public.conflict_status as enum ('open', 'resolved');
create type public.vote_choice as enum (
  'support',
  'oppose',
  'abstain',
  'request_changes'
);

create table public.rooms (
  id text primary key,
  title text not null check (length(trim(title)) > 0),
  brief text not null check (length(trim(brief)) > 0),
  phase public.room_phase not null default 'input',
  version bigint not null default 0 check (version >= 0),
  active_proposal_id text,
  created_at timestamptz not null default now(),
  finalized_at timestamptz
);

create table public.participants (
  id text primary key,
  room_id text not null references public.rooms(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  name text not null check (length(trim(name)) > 0),
  role text not null check (length(trim(role)) > 0),
  kind public.participant_kind not null default 'human',
  required_for_approval boolean not null default true,
  created_at timestamptz not null default now(),
  unique (room_id, name)
);

create unique index participants_one_seat_per_user_per_room
  on public.participants(room_id, user_id)
  where user_id is not null;

create table public.positions (
  id text primary key default gen_random_uuid()::text,
  room_id text not null references public.rooms(id) on delete cascade,
  participant_id text not null references public.participants(id) on delete cascade,
  summary text not null check (length(trim(summary)) > 0),
  category text,
  priority text,
  created_at timestamptz not null default now()
);

create table public.constraints (
  id text primary key default gen_random_uuid()::text,
  room_id text not null references public.rooms(id) on delete cascade,
  participant_id text not null references public.participants(id) on delete cascade,
  category text not null check (length(trim(category)) > 0),
  text text not null check (length(trim(text)) > 0),
  priority text,
  created_at timestamptz not null default now()
);

create table public.proposals (
  id text primary key default gen_random_uuid()::text,
  room_id text not null references public.rooms(id) on delete cascade,
  participant_id text not null references public.participants(id) on delete cascade,
  title text not null check (length(trim(title)) > 0),
  summary text not null check (length(trim(summary)) > 0),
  rationale text not null check (length(trim(rationale)) > 0),
  expected_outcomes text[] not null default '{}',
  referenced_constraint_ids text[] not null default '{}',
  parent_proposal_id text references public.proposals(id),
  status public.proposal_status not null default 'candidate',
  created_at timestamptz not null default now()
);

alter table public.rooms
  add constraint rooms_active_proposal_id_fkey
  foreign key (active_proposal_id) references public.proposals(id);

create table public.conflicts (
  id text primary key default gen_random_uuid()::text,
  room_id text not null references public.rooms(id) on delete cascade,
  proposal_id text not null references public.proposals(id) on delete cascade,
  constraint_id text references public.constraints(id) on delete set null,
  raised_by_actor_type public.actor_type not null,
  raised_by_actor_id text,
  severity public.conflict_severity not null,
  reason text not null check (length(trim(reason)) > 0),
  status public.conflict_status not null default 'open',
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table public.tradeoffs (
  id text primary key default gen_random_uuid()::text,
  room_id text not null references public.rooms(id) on delete cascade,
  conflict_ids text[] not null check (cardinality(conflict_ids) > 0),
  created_by_actor_type public.actor_type not null,
  created_by_actor_id text,
  description text not null,
  expected_effect text not null,
  resulting_proposal_id text references public.proposals(id),
  created_at timestamptz not null default now()
);

create table public.votes (
  room_id text not null references public.rooms(id) on delete cascade,
  proposal_id text not null references public.proposals(id) on delete cascade,
  participant_id text not null references public.participants(id) on delete cascade,
  choice public.vote_choice not null,
  comment text,
  updated_at timestamptz not null default now(),
  primary key (room_id, proposal_id, participant_id)
);

create table public.approvals (
  room_id text not null references public.rooms(id) on delete cascade,
  participant_id text not null references public.participants(id) on delete cascade,
  decision_hash text not null,
  approved_at timestamptz not null default now(),
  primary key (room_id, participant_id)
);

create table public.audit_events (
  id text primary key default gen_random_uuid()::text,
  room_id text not null references public.rooms(id) on delete cascade,
  actor_type public.actor_type not null,
  actor_id text,
  origin public.action_origin not null,
  action text not null,
  entity_type text,
  entity_id text,
  sanitized_input jsonb not null default '{}',
  result jsonb not null default '{}',
  previous_room_version bigint not null check (previous_room_version >= 0),
  resulting_room_version bigint not null check (resulting_room_version >= 0),
  confirmation_required boolean not null default false,
  created_at timestamptz not null default now()
);

create index positions_room_id_idx on public.positions(room_id);
create index constraints_room_id_idx on public.constraints(room_id);
create index proposals_room_id_idx on public.proposals(room_id);
create index conflicts_room_id_idx on public.conflicts(room_id);
create index tradeoffs_room_id_idx on public.tradeoffs(room_id);
create index votes_room_id_idx on public.votes(room_id);
create index approvals_room_id_idx on public.approvals(room_id);
create index audit_events_room_id_created_at_idx
  on public.audit_events(room_id, created_at);

create or replace function public.can_read_room(target_room_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select target_room_id = 'demo'
    or exists (
      select 1
      from public.participants
      where room_id = target_room_id
        and user_id = (select auth.uid())
    );
$$;

revoke all on function public.can_read_room(text) from public;
grant execute on function public.can_read_room(text) to authenticated;

alter table public.rooms enable row level security;
alter table public.participants enable row level security;
alter table public.positions enable row level security;
alter table public.constraints enable row level security;
alter table public.proposals enable row level security;
alter table public.conflicts enable row level security;
alter table public.tradeoffs enable row level security;
alter table public.votes enable row level security;
alter table public.approvals enable row level security;
alter table public.audit_events enable row level security;

create policy rooms_readable_by_room_members
  on public.rooms for select to authenticated
  using (public.can_read_room(id));
create policy participants_readable_by_room_members
  on public.participants for select to authenticated
  using (public.can_read_room(room_id));
create policy positions_readable_by_room_members
  on public.positions for select to authenticated
  using (public.can_read_room(room_id));
create policy constraints_readable_by_room_members
  on public.constraints for select to authenticated
  using (public.can_read_room(room_id));
create policy proposals_readable_by_room_members
  on public.proposals for select to authenticated
  using (public.can_read_room(room_id));
create policy conflicts_readable_by_room_members
  on public.conflicts for select to authenticated
  using (public.can_read_room(room_id));
create policy tradeoffs_readable_by_room_members
  on public.tradeoffs for select to authenticated
  using (public.can_read_room(room_id));
create policy votes_readable_by_room_members
  on public.votes for select to authenticated
  using (public.can_read_room(room_id));
create policy approvals_readable_by_room_members
  on public.approvals for select to authenticated
  using (public.can_read_room(room_id));
create policy audit_events_readable_by_room_members
  on public.audit_events for select to authenticated
  using (public.can_read_room(room_id));

revoke all on table public.rooms from anon, authenticated;
revoke all on table public.participants from anon, authenticated;
revoke all on table public.positions from anon, authenticated;
revoke all on table public.constraints from anon, authenticated;
revoke all on table public.proposals from anon, authenticated;
revoke all on table public.conflicts from anon, authenticated;
revoke all on table public.tradeoffs from anon, authenticated;
revoke all on table public.votes from anon, authenticated;
revoke all on table public.approvals from anon, authenticated;
revoke all on table public.audit_events from anon, authenticated;

grant select on table public.rooms to authenticated;
grant select on table public.participants to authenticated;
grant select on table public.positions to authenticated;
grant select on table public.constraints to authenticated;
grant select on table public.proposals to authenticated;
grant select on table public.conflicts to authenticated;
grant select on table public.tradeoffs to authenticated;
grant select on table public.votes to authenticated;
grant select on table public.approvals to authenticated;
grant select on table public.audit_events to authenticated;

create or replace function public.action_failure(
  error_code text,
  error_message text,
  current_room_version bigint,
  recovery_message text default null
)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'ok', false,
    'error', jsonb_strip_nulls(jsonb_build_object(
      'code', error_code,
      'message', error_message,
      'recovery', recovery_message
    )),
    'roomVersion', current_room_version
  );
$$;

create or replace function public.action_success(
  success_message text,
  current_room_version bigint
)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'ok', true,
    'data', null,
    'roomVersion', current_room_version,
    'message', success_message
  );
$$;

revoke all on function public.action_failure(text, text, bigint, text) from public;
revoke all on function public.action_success(text, bigint) from public;

create or replace function public.claim_participant_seat(
  p_room_id text,
  p_seat_id text,
  p_expected_version bigint,
  p_origin public.action_origin
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_version bigint;
  existing_seat_id text;
  target_user_id uuid;
  target_kind public.participant_kind;
begin
  if (select auth.uid()) is null then
    return public.action_failure('NOT_AUTHORIZED', 'An authenticated session is required.', 0);
  end if;

  select version into current_version
  from public.rooms where id = p_room_id for update;
  if not found then
    return public.action_failure('VALIDATION_ERROR', 'Room not found.', 0);
  end if;
  if current_version <> p_expected_version then
    return public.action_failure(
      'STALE_ROOM_STATE',
      'The room changed before this action completed.',
      current_version,
      'Review the latest room state and retry if the action is still appropriate.'
    );
  end if;

  select id into existing_seat_id
  from public.participants
  where room_id = p_room_id and user_id = (select auth.uid());
  if existing_seat_id is not null then
    if existing_seat_id = p_seat_id then
      return public.action_success('Seat already claimed by this session.', current_version);
    end if;
    return public.action_failure(
      'NOT_AUTHORIZED',
      'This session has already claimed another seat in the room.',
      current_version
    );
  end if;

  select user_id, kind into target_user_id, target_kind
  from public.participants
  where id = p_seat_id and room_id = p_room_id
  for update;
  if not found or target_kind <> 'human' or target_user_id is not null then
    return public.action_failure(
      'NOT_AUTHORIZED',
      'The requested human seat is unavailable.',
      current_version
    );
  end if;

  update public.participants
  set user_id = (select auth.uid())
  where id = p_seat_id and room_id = p_room_id and user_id is null;
  if not found then
    return public.action_failure('STALE_ROOM_STATE', 'The seat was claimed by another session.', current_version);
  end if;

  update public.rooms set version = current_version + 1 where id = p_room_id;
  insert into public.audit_events (
    room_id, actor_type, actor_id, origin, action, entity_type, entity_id,
    sanitized_input, result, previous_room_version, resulting_room_version,
    confirmation_required
  ) values (
    p_room_id, 'participant', p_seat_id, p_origin, 'participant.seat_claimed',
    'participant', p_seat_id, jsonb_build_object('seatId', p_seat_id),
    jsonb_build_object('ok', true), current_version, current_version + 1, false
  );
  return public.action_success('Seat claimed.', current_version + 1);
end;
$$;

create or replace function public.add_participant_position(
  p_room_id text,
  p_expected_version bigint,
  p_summary text,
  p_category text,
  p_priority text,
  p_constraints jsonb,
  p_origin public.action_origin
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_version bigint;
  current_phase public.room_phase;
  actor_participant_id text;
  new_position_id text := gen_random_uuid()::text;
  constraint_value jsonb;
begin
  select version, phase into current_version, current_phase
  from public.rooms where id = p_room_id for update;
  if not found then
    return public.action_failure('VALIDATION_ERROR', 'Room not found.', 0);
  end if;
  if current_version <> p_expected_version then
    return public.action_failure('STALE_ROOM_STATE', 'The room changed before this action completed.', current_version,
      'Review the latest room state and retry if the action is still appropriate.');
  end if;
  if current_phase <> 'input' then
    return public.action_failure('WRONG_PHASE', 'Positions can only be added during the input phase.', current_version);
  end if;

  select id into actor_participant_id from public.participants
  where room_id = p_room_id and user_id = (select auth.uid()) and kind = 'human';
  if actor_participant_id is null then
    return public.action_failure('NOT_AUTHORIZED', 'Claim a participant seat before adding a position.', current_version);
  end if;

  insert into public.positions (id, room_id, participant_id, summary, category, priority)
  values (new_position_id, p_room_id, actor_participant_id, p_summary, p_category, p_priority);

  for constraint_value in select value from jsonb_array_elements(p_constraints)
  loop
    insert into public.constraints (room_id, participant_id, category, text, priority)
    values (
      p_room_id,
      actor_participant_id,
      constraint_value->>'category',
      constraint_value->>'text',
      constraint_value->>'priority'
    );
  end loop;

  update public.rooms set version = current_version + 1 where id = p_room_id;
  insert into public.audit_events (
    room_id, actor_type, actor_id, origin, action, entity_type, entity_id,
    sanitized_input, result, previous_room_version, resulting_room_version,
    confirmation_required
  ) values (
    p_room_id, 'participant', actor_participant_id, p_origin, 'position.added',
    'position', new_position_id,
    jsonb_build_object('summary', p_summary, 'category', p_category, 'priority', p_priority,
      'constraints', p_constraints),
    jsonb_build_object('ok', true), current_version, current_version + 1, false
  );
  return public.action_success('Position and constraints added.', current_version + 1);
end;
$$;

create or replace function public.submit_participant_proposal(
  p_room_id text,
  p_expected_version bigint,
  p_title text,
  p_summary text,
  p_rationale text,
  p_expected_outcomes text[],
  p_referenced_constraint_ids text[],
  p_parent_proposal_id text,
  p_origin public.action_origin
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_version bigint;
  current_phase public.room_phase;
  actor_participant_id text;
  new_proposal_id text := gen_random_uuid()::text;
  reference_id text;
begin
  select version, phase into current_version, current_phase
  from public.rooms where id = p_room_id for update;
  if not found then return public.action_failure('VALIDATION_ERROR', 'Room not found.', 0); end if;
  if current_version <> p_expected_version then
    return public.action_failure('STALE_ROOM_STATE', 'The room changed before this action completed.', current_version,
      'Review the latest room state and retry if the action is still appropriate.');
  end if;
  if current_phase <> 'proposals' then
    return public.action_failure('WRONG_PHASE', 'Proposals can only be submitted during the proposals phase.', current_version);
  end if;
  select id into actor_participant_id from public.participants
  where room_id = p_room_id and user_id = (select auth.uid()) and kind = 'human';
  if actor_participant_id is null then
    return public.action_failure('NOT_AUTHORIZED', 'Claim a participant seat before submitting a proposal.', current_version);
  end if;
  if p_parent_proposal_id is not null and not exists (
    select 1 from public.proposals where id = p_parent_proposal_id and room_id = p_room_id
  ) then
    return public.action_failure('VALIDATION_ERROR', 'Parent proposal does not belong to this room.', current_version);
  end if;
  foreach reference_id in array p_referenced_constraint_ids loop
    if not exists (select 1 from public.constraints where id = reference_id and room_id = p_room_id) then
      return public.action_failure('VALIDATION_ERROR', 'A referenced constraint does not belong to this room.', current_version);
    end if;
  end loop;

  insert into public.proposals (
    id, room_id, participant_id, title, summary, rationale, expected_outcomes,
    referenced_constraint_ids, parent_proposal_id, status
  ) values (
    new_proposal_id, p_room_id, actor_participant_id, p_title, p_summary,
    p_rationale, p_expected_outcomes, p_referenced_constraint_ids,
    p_parent_proposal_id, 'candidate'
  );
  update public.rooms
  set version = current_version + 1, active_proposal_id = new_proposal_id
  where id = p_room_id;
  insert into public.audit_events (
    room_id, actor_type, actor_id, origin, action, entity_type, entity_id,
    sanitized_input, result, previous_room_version, resulting_room_version,
    confirmation_required
  ) values (
    p_room_id, 'participant', actor_participant_id, p_origin, 'proposal.submitted',
    'proposal', new_proposal_id,
    jsonb_build_object('title', p_title, 'summary', p_summary, 'rationale', p_rationale,
      'expectedOutcomes', to_jsonb(p_expected_outcomes),
      'referencedConstraintIds', to_jsonb(p_referenced_constraint_ids),
      'parentProposalId', p_parent_proposal_id),
    jsonb_build_object('ok', true), current_version, current_version + 1, false
  );
  return public.action_success('Proposal submitted.', current_version + 1);
end;
$$;

create or replace function public.raise_participant_objection(
  p_room_id text,
  p_expected_version bigint,
  p_proposal_id text,
  p_constraint_id text,
  p_reason text,
  p_severity public.conflict_severity,
  p_origin public.action_origin
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_version bigint;
  current_phase public.room_phase;
  actor_participant_id text;
  new_conflict_id text := gen_random_uuid()::text;
begin
  select version, phase into current_version, current_phase
  from public.rooms where id = p_room_id for update;
  if not found then return public.action_failure('VALIDATION_ERROR', 'Room not found.', 0); end if;
  if current_version <> p_expected_version then
    return public.action_failure('STALE_ROOM_STATE', 'The room changed before this action completed.', current_version,
      'Review the latest room state and retry if the action is still appropriate.');
  end if;
  if current_phase <> 'deliberation' then
    return public.action_failure('WRONG_PHASE', 'Objections can only be raised during deliberation.', current_version);
  end if;
  select id into actor_participant_id from public.participants
  where room_id = p_room_id and user_id = (select auth.uid()) and kind = 'human';
  if actor_participant_id is null then
    return public.action_failure('NOT_AUTHORIZED', 'Claim a participant seat before raising an objection.', current_version);
  end if;
  if not exists (select 1 from public.proposals where id = p_proposal_id and room_id = p_room_id) then
    return public.action_failure('VALIDATION_ERROR', 'Proposal does not belong to this room.', current_version);
  end if;
  if p_constraint_id is not null and not exists (
    select 1 from public.constraints where id = p_constraint_id and room_id = p_room_id
  ) then
    return public.action_failure('VALIDATION_ERROR', 'Constraint does not belong to this room.', current_version);
  end if;

  insert into public.conflicts (
    id, room_id, proposal_id, constraint_id, raised_by_actor_type,
    raised_by_actor_id, severity, reason, status
  ) values (
    new_conflict_id, p_room_id, p_proposal_id, p_constraint_id, 'participant',
    actor_participant_id, p_severity, p_reason, 'open'
  );
  update public.rooms set version = current_version + 1 where id = p_room_id;
  insert into public.audit_events (
    room_id, actor_type, actor_id, origin, action, entity_type, entity_id,
    sanitized_input, result, previous_room_version, resulting_room_version,
    confirmation_required
  ) values (
    p_room_id, 'participant', actor_participant_id, p_origin, 'objection.raised',
    'conflict', new_conflict_id,
    jsonb_build_object('proposalId', p_proposal_id, 'constraintId', p_constraint_id,
      'reason', p_reason, 'severity', p_severity),
    jsonb_build_object('ok', true), current_version, current_version + 1, false
  );
  return public.action_success('Objection raised.', current_version + 1);
end;
$$;

create or replace function public.advance_demo_room_phase(
  p_room_id text,
  p_expected_version bigint,
  p_next_phase public.room_phase,
  p_origin public.action_origin
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_version bigint;
  current_phase public.room_phase;
  actor_participant_id text;
begin
  select version, phase into current_version, current_phase
  from public.rooms where id = p_room_id for update;
  if not found then return public.action_failure('VALIDATION_ERROR', 'Room not found.', 0); end if;
  if p_room_id <> 'demo' then
    return public.action_failure('NOT_AUTHORIZED', 'Developer phase transitions are limited to the demo room.', current_version);
  end if;
  if current_version <> p_expected_version then
    return public.action_failure('STALE_ROOM_STATE', 'The room changed before this action completed.', current_version);
  end if;
  if not ((current_phase = 'input' and p_next_phase = 'proposals') or
          (current_phase = 'proposals' and p_next_phase = 'deliberation')) then
    return public.action_failure('WRONG_PHASE', 'Only the next early demo phase may be selected.', current_version);
  end if;
  select id into actor_participant_id from public.participants
  where room_id = p_room_id and user_id = (select auth.uid()) and kind = 'human';
  if actor_participant_id is null then
    return public.action_failure('NOT_AUTHORIZED', 'Claim a participant seat first.', current_version);
  end if;

  update public.rooms set version = current_version + 1, phase = p_next_phase where id = p_room_id;
  insert into public.audit_events (
    room_id, actor_type, actor_id, origin, action, entity_type, entity_id,
    sanitized_input, result, previous_room_version, resulting_room_version,
    confirmation_required
  ) values (
    p_room_id, 'participant', actor_participant_id, p_origin, 'room.phase_advanced',
    'room', p_room_id, jsonb_build_object('phase', p_next_phase),
    jsonb_build_object('ok', true), current_version, current_version + 1, false
  );
  return public.action_success('Demo room phase advanced.', current_version + 1);
end;
$$;

revoke all on function public.claim_participant_seat(text, text, bigint, public.action_origin) from public;
revoke all on function public.add_participant_position(text, bigint, text, text, text, jsonb, public.action_origin) from public;
revoke all on function public.submit_participant_proposal(text, bigint, text, text, text, text[], text[], text, public.action_origin) from public;
revoke all on function public.raise_participant_objection(text, bigint, text, text, text, public.conflict_severity, public.action_origin) from public;
revoke all on function public.advance_demo_room_phase(text, bigint, public.room_phase, public.action_origin) from public;

grant execute on function public.claim_participant_seat(text, text, bigint, public.action_origin) to authenticated;
grant execute on function public.add_participant_position(text, bigint, text, text, text, jsonb, public.action_origin) to authenticated;
grant execute on function public.submit_participant_proposal(text, bigint, text, text, text, text[], text[], text, public.action_origin) to authenticated;
grant execute on function public.raise_participant_objection(text, bigint, text, text, text, public.conflict_severity, public.action_origin) to authenticated;
grant execute on function public.advance_demo_room_phase(text, bigint, public.room_phase, public.action_origin) to authenticated;

alter table public.rooms replica identity full;
alter publication supabase_realtime add table public.rooms;
