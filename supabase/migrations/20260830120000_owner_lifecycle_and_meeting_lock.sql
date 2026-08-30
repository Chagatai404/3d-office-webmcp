-- Slice 3 / Gate 3: owner lifecycle (meeting lock, participant removal,
-- ownership transfer) and the security boundary that goes with it -- a
-- participant row is no longer sufficient membership; it must also be
-- `status = 'active'`.

-- --------------------------------------------------------------------------
-- Schema: meeting lock and participant membership status
-- --------------------------------------------------------------------------

alter table public.rooms
  add column is_locked boolean not null default false;

comment on column public.rooms.is_locked is
  'Owner-controlled meeting access. Locked rooms refuse new join requests; existing admitted participants are unaffected.';

create type public.participant_status as enum ('active', 'removed');

-- The NOT NULL DEFAULT backfills every existing row to 'active' as part of
-- this single statement; no separate UPDATE is needed. Demo simulations are
-- untouched by this slice and remain 'active'.
alter table public.participants
  add column status public.participant_status not null default 'active',
  add column removed_at timestamptz;

comment on column public.participants.status is
  'Canonical membership lifecycle, independent of isClaimed. A participant row alone is not sufficient authority -- it must also be active.';
comment on column public.participants.removed_at is
  'When an owner removed this participant. Historical positions/proposals/votes/audit rows are preserved and keep referencing this id.';

-- --------------------------------------------------------------------------
-- Central security boundary: a participant row is membership only while active.
-- --------------------------------------------------------------------------

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
        and status = 'active'
    );
$$;

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
      and participant.status = 'active'
      and participant.user_id = (select auth.uid())
  );
$$;

-- Re-grant: a table-level `select` would expose new columns beyond the
-- intended canonical projection.
revoke select on table public.rooms from authenticated;
grant select (
  id, title, brief, phase, version, active_proposal_id, created_at, finalized_at,
  demo_mode, owner_participant_id, decision_policy, decision_candidate,
  decision_hash, final_record, is_locked
) on public.rooms to authenticated;

-- --------------------------------------------------------------------------
-- Every participant-authority derivation below is redefined to additionally
-- require `status = 'active'`, so a removed participant's still-authenticated
-- browser session immediately loses every mutation surface. Reads are covered
-- centrally by `can_read_room` above.
-- --------------------------------------------------------------------------

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
  where room_id = p_room_id and user_id = (select auth.uid()) and kind = 'human' and status = 'active';
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
  where room_id = p_room_id and user_id = (select auth.uid()) and kind = 'human' and status = 'active';
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
  where room_id = p_room_id and user_id = (select auth.uid()) and kind = 'human' and status = 'active';
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

create or replace function public.resolve_participant_objection(
  p_room_id text,
  p_expected_version bigint,
  p_conflict_id text,
  p_resolution_note text,
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
  if current_phase = 'finalized' then
    return public.action_failure('ALREADY_FINALIZED', 'The finalized decision is immutable.', current_version);
  end if;
  if current_version <> p_expected_version then
    return public.action_failure('STALE_ROOM_STATE', 'The room changed before this action completed.', current_version,
      'Review the latest room state and retry if the action is still appropriate.');
  end if;
  if current_phase <> 'deliberation' then
    return public.action_failure('WRONG_PHASE', 'Objections can only be resolved during deliberation.', current_version);
  end if;
  if p_resolution_note is null or length(p_resolution_note) = 0 then
    return public.action_failure('VALIDATION_ERROR', 'A resolution note is required.', current_version);
  end if;
  select id into actor_participant_id from public.participants
  where room_id = p_room_id and user_id = (select auth.uid()) and kind = 'human' and status = 'active';
  if actor_participant_id is null then
    return public.action_failure('NOT_AUTHORIZED', 'Claim a human participant seat first.', current_version);
  end if;
  if not exists (
    select 1 from public.conflicts
    where id = p_conflict_id and room_id = p_room_id and status = 'open'
  ) then
    return public.action_failure('VALIDATION_ERROR', 'The conflict is not an open issue in this room.', current_version);
  end if;

  update public.conflicts
  set status = 'resolved', resolved_at = now(),
      resolved_by_actor_type = 'participant', resolved_by_actor_id = actor_participant_id,
      resolution_note = p_resolution_note
  where id = p_conflict_id and room_id = p_room_id;
  update public.rooms set version = current_version + 1 where id = p_room_id;
  insert into public.audit_events (
    room_id, actor_type, actor_id, origin, action, entity_type, entity_id,
    sanitized_input, result, previous_room_version, resulting_room_version,
    confirmation_required
  ) values (
    p_room_id, 'participant', actor_participant_id, p_origin, 'conflict.resolved',
    'conflict', p_conflict_id, jsonb_build_object('resolutionNote', p_resolution_note),
    jsonb_build_object('ok', true), current_version, current_version + 1, false
  );
  return public.action_success('Objection explicitly resolved.', current_version + 1);
end;
$$;

create or replace function public.propose_participant_tradeoff(
  p_room_id text,
  p_expected_version bigint,
  p_conflict_ids text[],
  p_description text,
  p_expected_effect text,
  p_revised_title text,
  p_revised_summary text,
  p_revised_rationale text,
  p_expected_outcomes text[],
  p_referenced_constraint_ids text[],
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
  source_proposal_id text;
  actor_participant_id text;
  new_tradeoff_id text := gen_random_uuid()::text;
  new_proposal_id text := gen_random_uuid()::text;
  supplied_conflict_count integer;
  valid_conflict_count integer;
  reference_id text;
begin
  select version, phase, active_proposal_id
  into current_version, current_phase, source_proposal_id
  from public.rooms
  where id = p_room_id
  for update;

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
  if current_phase <> 'deliberation' then
    return public.action_failure(
      'WRONG_PHASE',
      'Trade-offs can only be proposed during the deliberation phase.',
      current_version
    );
  end if;
  if p_conflict_ids is null
    or p_expected_outcomes is null
    or p_referenced_constraint_ids is null
    or p_description is null or length(p_description) = 0
    or p_expected_effect is null or length(p_expected_effect) = 0
    or p_revised_title is null or length(p_revised_title) = 0
    or p_revised_summary is null or length(p_revised_summary) = 0
    or p_revised_rationale is null or length(p_revised_rationale) = 0
    or exists (
      select 1 from unnest(p_conflict_ids) as supplied(conflict_id)
      where conflict_id is null or length(conflict_id) = 0
    )
    or exists (
      select 1 from unnest(p_expected_outcomes) as supplied(outcome)
      where outcome is null or length(outcome) = 0
    )
    or exists (
      select 1 from unnest(p_referenced_constraint_ids) as supplied(reference_id)
      where supplied.reference_id is null or length(supplied.reference_id) = 0
    ) then
    return public.action_failure(
      'VALIDATION_ERROR',
      'Trade-off and revised proposal inputs are invalid.',
      current_version
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
      'Claim a participant seat before proposing a trade-off.',
      current_version
    );
  end if;
  if source_proposal_id is null or not exists (
    select 1 from public.proposals
    where id = source_proposal_id and room_id = p_room_id
  ) then
    return public.action_failure(
      'VALIDATION_ERROR',
      'The room has no active proposal to revise.',
      current_version
    );
  end if;

  select count(*) into supplied_conflict_count
  from unnest(p_conflict_ids) as supplied(conflict_id);
  if supplied_conflict_count = 0 or supplied_conflict_count <> (
    select count(distinct conflict_id)
    from unnest(p_conflict_ids) as supplied(conflict_id)
  ) then
    return public.action_failure(
      'VALIDATION_ERROR',
      'Conflict IDs must be a non-empty set of unique open issues.',
      current_version
    );
  end if;

  select count(*) into valid_conflict_count
  from public.conflicts
  where id = any(p_conflict_ids)
    and room_id = p_room_id
    and proposal_id = source_proposal_id
    and status = 'open';
  if valid_conflict_count <> supplied_conflict_count then
    return public.action_failure(
      'VALIDATION_ERROR',
      'Every conflict must be open, belong to this room, and target the active proposal.',
      current_version
    );
  end if;

  foreach reference_id in array p_referenced_constraint_ids loop
    if not exists (
      select 1 from public.constraints
      where id = reference_id and room_id = p_room_id
    ) then
      return public.action_failure(
        'VALIDATION_ERROR',
        'A referenced constraint does not belong to this room.',
        current_version
      );
    end if;
  end loop;

  update public.proposals
  set status = 'superseded'
  where id = source_proposal_id and room_id = p_room_id;

  insert into public.proposals (
    id, room_id, participant_id, title, summary, rationale, expected_outcomes,
    referenced_constraint_ids, parent_proposal_id, status
  ) values (
    new_proposal_id, p_room_id, actor_participant_id, p_revised_title,
    p_revised_summary, p_revised_rationale, p_expected_outcomes,
    p_referenced_constraint_ids, source_proposal_id, 'candidate'
  );

  insert into public.tradeoffs (
    id, room_id, conflict_ids, created_by_actor_type, created_by_actor_id,
    description, expected_effect, resulting_proposal_id
  ) values (
    new_tradeoff_id, p_room_id, p_conflict_ids, 'participant',
    actor_participant_id, p_description, p_expected_effect, new_proposal_id
  );

  update public.rooms
  set version = current_version + 1, active_proposal_id = new_proposal_id
  where id = p_room_id;

  insert into public.audit_events (
    room_id, actor_type, actor_id, origin, action, entity_type, entity_id,
    sanitized_input, result, previous_room_version, resulting_room_version,
    confirmation_required
  ) values (
    p_room_id,
    'participant',
    actor_participant_id,
    p_origin,
    'tradeoff.proposed',
    'tradeoff',
    new_tradeoff_id,
    jsonb_build_object(
      'conflictIds', p_conflict_ids,
      'description', p_description,
      'expectedEffect', p_expected_effect,
      'revisedProposal', jsonb_build_object(
        'title', p_revised_title,
        'summary', p_revised_summary,
        'rationale', p_revised_rationale,
        'expectedOutcomes', p_expected_outcomes,
        'referencedConstraintIds', p_referenced_constraint_ids
      )
    ),
    jsonb_build_object(
      'ok', true,
      'resultingProposalId', new_proposal_id,
      'conflictsRemainOpen', true
    ),
    current_version,
    current_version + 1,
    false
  );

  return public.action_success(
    'Trade-off and revised proposal recorded; referenced conflicts remain open.',
    current_version + 1
  );
end;
$$;

create or replace function public.cast_participant_vote(
  p_room_id text,
  p_expected_version bigint,
  p_proposal_id text,
  p_choice public.vote_choice,
  p_comment text,
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
  active_id text;
  actor_participant_id text;
  vote_existed boolean;
begin
  select version, phase, active_proposal_id into current_version, current_phase, active_id
  from public.rooms where id = p_room_id for update;
  if not found then return public.action_failure('VALIDATION_ERROR', 'Room not found.', 0); end if;
  if current_phase = 'finalized' then
    return public.action_failure('ALREADY_FINALIZED', 'The finalized decision is immutable.', current_version);
  end if;
  if current_version <> p_expected_version then
    return public.action_failure('STALE_ROOM_STATE', 'The room changed before this action completed.', current_version,
      'Review the latest room state and retry if the action is still appropriate.');
  end if;
  if current_phase <> 'voting' then
    return public.action_failure('WRONG_PHASE', 'Votes can only be cast during voting.', current_version);
  end if;
  if p_origin not in ('manual_ui', 'webmcp') then
    return public.action_failure('NOT_AUTHORIZED', 'This voting operation is limited to human participant sessions.', current_version);
  end if;
  select id into actor_participant_id from public.participants
  where room_id = p_room_id and user_id = (select auth.uid()) and kind = 'human' and status = 'active';
  if actor_participant_id is null then
    return public.action_failure('NOT_AUTHORIZED', 'Claim a human participant seat before voting.', current_version);
  end if;
  if active_id is null or p_proposal_id <> active_id or not exists (
    select 1 from public.proposals
    where id = p_proposal_id and room_id = p_room_id and status = 'candidate'
  ) then
    return public.action_failure('VALIDATION_ERROR', 'Vote for the active candidate proposal only.', current_version);
  end if;

  select exists (
    select 1 from public.votes
    where room_id = p_room_id and proposal_id = p_proposal_id
      and participant_id = actor_participant_id
  ) into vote_existed;

  insert into public.votes (room_id, proposal_id, participant_id, choice, comment, updated_at)
  values (p_room_id, p_proposal_id, actor_participant_id, p_choice, p_comment, now())
  on conflict (room_id, proposal_id, participant_id)
  do update set choice = excluded.choice, comment = excluded.comment, updated_at = excluded.updated_at;

  update public.rooms set version = current_version + 1 where id = p_room_id;
  insert into public.audit_events (
    room_id, actor_type, actor_id, origin, action, entity_type, entity_id,
    sanitized_input, result, previous_room_version, resulting_room_version,
    confirmation_required
  ) values (
    p_room_id, 'participant', actor_participant_id, p_origin,
    case when vote_existed then 'vote.updated' else 'vote.cast' end,
    'vote', p_proposal_id,
    jsonb_build_object('proposalId', p_proposal_id, 'choice', p_choice, 'comment', p_comment),
    jsonb_build_object('ok', true), current_version, current_version + 1, false
  );
  return public.action_success(
    case when vote_existed then 'Vote updated.' else 'Vote recorded.' end,
    current_version + 1
  );
end;
$$;

create or replace function public.mark_my_input_ready(
  p_room_id text,
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
  current_phase public.room_phase;
  actor_participant_id text;
  actor_ready_at timestamptz;
begin
  if (select auth.uid()) is null then
    return public.action_failure('NOT_AUTHORIZED', 'An authenticated session is required.', 0);
  end if;

  select version, phase into current_version, current_phase
  from public.rooms where id = p_room_id for update;
  if not found then
    return public.action_failure('VALIDATION_ERROR', 'Room not found.', 0);
  end if;
  if current_phase = 'finalized' then
    return public.action_failure('ALREADY_FINALIZED', 'The finalized decision is immutable.', current_version);
  end if;
  if current_version <> p_expected_version then
    return public.action_failure('STALE_ROOM_STATE', 'The room changed before this action completed.', current_version,
      'Review the latest room state and retry if the action is still appropriate.');
  end if;
  if current_phase <> 'input' then
    return public.action_failure('WRONG_PHASE', 'Input can only be marked ready during the input phase.', current_version);
  end if;

  select id, ready_at into actor_participant_id, actor_ready_at
  from public.participants
  where room_id = p_room_id and user_id = (select auth.uid()) and kind = 'human' and status = 'active'
  for update;
  if actor_participant_id is null then
    return public.action_failure('NOT_AUTHORIZED',
      'Claim a participant seat before marking your input ready.', current_version);
  end if;
  if not exists (
    select 1 from public.positions
    where room_id = p_room_id and participant_id = actor_participant_id
  ) then
    return public.action_failure('VALIDATION_ERROR',
      'Publish at least one position before marking your input ready.', current_version,
      'Add your position and constraints first.');
  end if;
  if actor_ready_at is not null then
    return public.action_success('Input was already marked ready.', current_version);
  end if;

  update public.participants set ready_at = now() where id = actor_participant_id;
  update public.rooms set version = current_version + 1 where id = p_room_id;
  insert into public.audit_events (
    room_id, actor_type, actor_id, origin, action, entity_type, entity_id,
    sanitized_input, result, previous_room_version, resulting_room_version,
    confirmation_required
  ) values (
    p_room_id, 'participant', actor_participant_id, p_origin, 'participant.input_ready',
    'participant', actor_participant_id, '{}'::jsonb,
    jsonb_build_object('ok', true), current_version, current_version + 1, false
  );
  return public.action_success('Input marked ready.', current_version + 1);
end;
$$;

create or replace function public.approve_participant_final_decision(
  p_room_id text,
  p_expected_version bigint,
  p_decision_hash text,
  p_human_confirmed boolean,
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
  active_id text;
  stored_candidate jsonb;
  stored_hash text;
  current_candidate jsonb;
  current_hash text;
  actor_participant_id text;
  missing_count integer;
  preview_value jsonb;
  record_value jsonb;
  provenance_values jsonb;
  finalized_time timestamptz;
begin
  select version, phase, active_proposal_id, decision_candidate, decision_hash
  into current_version, current_phase, active_id, stored_candidate, stored_hash
  from public.rooms where id = p_room_id for update;
  if not found then return public.action_failure('VALIDATION_ERROR', 'Room not found.', 0); end if;
  if current_phase = 'finalized' then
    return public.action_failure('ALREADY_FINALIZED', 'The decision is already finalized.', current_version);
  end if;
  if current_version <> p_expected_version then
    return public.action_failure('STALE_ROOM_STATE', 'The room changed before this action completed.', current_version,
      'Review the latest room state and retry if the action is still appropriate.');
  end if;
  if current_phase <> 'approval' then
    return public.action_failure('WRONG_PHASE', 'Approval is available only during the approval phase.', current_version);
  end if;
  if p_origin not in ('manual_ui', 'webmcp') then
    return public.action_failure('NOT_AUTHORIZED', 'Only a human participant session may approve.', current_version);
  end if;
  select id into actor_participant_id from public.participants
  where room_id = p_room_id
    and user_id = (select auth.uid())
    and kind = 'human'
    and status = 'active'
    and required_for_approval = true;
  if actor_participant_id is null then
    return public.action_failure('NOT_AUTHORIZED', 'This participant is not a required human approver.', current_version);
  end if;

  current_candidate := public.build_final_decision_candidate(p_room_id);
  current_hash := public.hash_decision_candidate(current_candidate);
  if p_decision_hash <> current_hash or stored_hash <> current_hash or stored_candidate <> current_candidate then
    return public.action_failure('DECISION_CHANGED', 'The final decision changed after it was reviewed.', current_version,
      'Review the updated final decision before approving again.');
  end if;

  insert into public.audit_events (
    room_id, actor_type, actor_id, origin, action, entity_type, entity_id,
    sanitized_input, result, previous_room_version, resulting_room_version,
    confirmation_required
  ) values (
    p_room_id, 'participant', actor_participant_id, p_origin, 'approval.requested',
    'proposal', active_id, jsonb_build_object('decisionHash', current_hash),
    jsonb_build_object('confirmed', p_human_confirmed),
    current_version, current_version, true
  );

  if not p_human_confirmed then
    return public.action_failure(
      'HUMAN_CONFIRMATION_REQUIRED',
      'Review and confirm the exact final decision in the visible approval UI.',
      current_version,
      'Open the final decision preview and confirm this exact decision hash.'
    );
  end if;

  insert into public.approvals (room_id, participant_id, decision_hash, approved_at)
  values (p_room_id, actor_participant_id, current_hash, now())
  on conflict (room_id, participant_id)
  do update set decision_hash = excluded.decision_hash, approved_at = excluded.approved_at;

  insert into public.audit_events (
    room_id, actor_type, actor_id, origin, action, entity_type, entity_id,
    sanitized_input, result, previous_room_version, resulting_room_version,
    confirmation_required
  ) values (
    p_room_id, 'participant', actor_participant_id, p_origin, 'approval.recorded',
    'proposal', active_id, jsonb_build_object('decisionHash', current_hash),
    jsonb_build_object('ok', true), current_version, current_version + 1, true
  );

  select count(*) into missing_count
  from public.participants participant
  where participant.room_id = p_room_id
    and participant.kind = 'human'
    and participant.required_for_approval = true
    and not exists (
      select 1 from public.approvals approval
      where approval.room_id = p_room_id
        and approval.participant_id = participant.id
        and approval.decision_hash = current_hash
    );

  if missing_count = 0 then
    if exists (
      select 1 from public.conflicts
      where room_id = p_room_id and status = 'open' and severity = 'blocking'
    ) then
      return public.action_failure('UNRESOLVED_BLOCKING_CONFLICT',
        'A blocking conflict prevents finalization.', current_version,
        'Resolve every blocking issue before finalization.');
    end if;

    finalized_time := now();
    preview_value := public.build_final_decision_preview(p_room_id, current_candidate, current_hash);
    insert into public.audit_events (
      room_id, actor_type, actor_id, origin, action, entity_type, entity_id,
      sanitized_input, result, previous_room_version, resulting_room_version,
      confirmation_required
    ) values (
      p_room_id, 'participant', actor_participant_id, p_origin, 'decision.finalized',
      'proposal', active_id, jsonb_build_object('decisionHash', current_hash),
      jsonb_build_object('ok', true), current_version, current_version + 1, false
    );
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', event.id,
      'actorType', event.actor_type,
      'actorId', event.actor_id,
      'origin', event.origin,
      'action', event.action,
      'entityType', event.entity_type,
      'entityId', event.entity_id,
      'sanitizedInput', event.sanitized_input,
      'result', event.result,
      'previousRoomVersion', event.previous_room_version,
      'resultingRoomVersion', event.resulting_room_version,
      'confirmationRequired', event.confirmation_required,
      'createdAt', event.created_at
    ) order by
      event.created_at,
      event.resulting_room_version,
      case when event.action = 'decision.finalized' then 1 else 0 end,
      event.id), '[]'::jsonb)
    into provenance_values
    from public.audit_events event where event.room_id = p_room_id;
    record_value := jsonb_build_object(
      'roomId', p_room_id,
      'finalizedAt', finalized_time,
      'decision', preview_value,
      'acceptedTradeoffs', current_candidate->'acceptedTradeoffs',
      'votes', current_candidate->'votes',
      'approvals', preview_value->'approvals',
      'provenance', provenance_values
    );
    update public.proposals set status = 'accepted'
    where id = active_id and room_id = p_room_id;
    update public.rooms
    set phase = 'finalized', finalized_at = finalized_time,
        final_record = record_value, version = current_version + 1
    where id = p_room_id;
    return public.action_success('Approval recorded and decision finalized.', current_version + 1);
  end if;

  update public.rooms set version = current_version + 1 where id = p_room_id;
  return public.action_success('Approval recorded; additional human approvals are required.', current_version + 1);
end;
$$;

-- Organizer-only room progression for real rooms. Unchanged except the
-- authority check now flows through the updated `is_room_organizer`, and the
-- audit actor lookup requires an active seat.
create or replace function public.advance_room_phase(
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
  active_id text;
  organizer_participant_id text;
  required_total integer;
  joined_count integer;
  positioned_count integer;
  ready_count integer;
  entry_result jsonb;
  candidate_hash text;
begin
  if (select auth.uid()) is null then
    return public.action_failure('NOT_AUTHORIZED', 'An authenticated session is required.', 0);
  end if;

  select version, phase, active_proposal_id into current_version, current_phase, active_id
  from public.rooms where id = p_room_id for update;
  if not found then
    return public.action_failure('VALIDATION_ERROR', 'Room not found.', 0);
  end if;
  if current_phase = 'finalized' then
    return public.action_failure('ALREADY_FINALIZED', 'The finalized decision is immutable.', current_version);
  end if;
  if not public.is_room_organizer(p_room_id) then
    return public.action_failure('NOT_AUTHORIZED',
      'Only the room organizer may advance the room phase.', current_version,
      'Ask the organizer to move the room forward.');
  end if;
  if current_version <> p_expected_version then
    return public.action_failure('STALE_ROOM_STATE', 'The room changed before this action completed.', current_version,
      'Review the latest room state and retry if the action is still appropriate.');
  end if;
  if current_phase = 'approval' then
    return public.action_failure('WRONG_PHASE',
      'The organizer cannot finalize the decision.', current_version,
      'Finalization happens when every required participant approves the exact decision.');
  end if;
  if not ((current_phase = 'input' and p_next_phase = 'proposals') or
          (current_phase = 'proposals' and p_next_phase = 'deliberation') or
          (current_phase = 'deliberation' and p_next_phase = 'voting') or
          (current_phase = 'voting' and p_next_phase = 'approval')) then
    return public.action_failure('WRONG_PHASE', 'Only the next room phase may be selected.', current_version);
  end if;

  select id into organizer_participant_id from public.participants
  where room_id = p_room_id and user_id = (select auth.uid()) and kind = 'human' and status = 'active';

  if p_next_phase = 'proposals' then
    select count(*) into required_total from public.participants
    where room_id = p_room_id and kind = 'human' and required_for_approval = true;
    if required_total = 0 then
      return public.action_failure('VALIDATION_ERROR',
        'The room has no participant whose approval is required.', current_version,
        'A decision needs at least one required human participant.');
    end if;
    select count(*) into joined_count from public.participants
    where room_id = p_room_id and kind = 'human' and required_for_approval = true
      and user_id is not null;
    if joined_count <> required_total then
      return public.action_failure('VALIDATION_ERROR',
        'Every required participant must join before proposals begin.', current_version,
        'Share the remaining invite links.');
    end if;
    select count(*) into positioned_count from public.participants participant
    where participant.room_id = p_room_id and participant.kind = 'human'
      and participant.required_for_approval = true
      and exists (
        select 1 from public.positions position_row
        where position_row.room_id = p_room_id
          and position_row.participant_id = participant.id
      );
    if positioned_count <> required_total then
      return public.action_failure('VALIDATION_ERROR',
        'Every required participant must publish a position before proposals begin.', current_version);
    end if;
    select count(*) into ready_count from public.participants
    where room_id = p_room_id and kind = 'human' and required_for_approval = true
      and ready_at is not null;
    if ready_count <> required_total then
      return public.action_failure('VALIDATION_ERROR',
        'Every required participant must mark their input ready before proposals begin.', current_version,
        'Ask the remaining participants to confirm their input is complete.');
    end if;
  elsif p_next_phase = 'deliberation' and active_id is null then
    return public.action_failure('VALIDATION_ERROR',
      'An active proposal is required before deliberation.', current_version);
  end if;

  entry_result := public.apply_room_phase_entry(p_room_id, p_next_phase, current_version, active_id);
  if not coalesce((entry_result->>'ok')::boolean, false) then
    return entry_result;
  end if;
  candidate_hash := entry_result->>'decisionHash';

  update public.rooms
  set version = current_version + 1, phase = p_next_phase
  where id = p_room_id;
  insert into public.audit_events (
    room_id, actor_type, actor_id, origin, action, entity_type, entity_id,
    sanitized_input, result, previous_room_version, resulting_room_version,
    confirmation_required
  ) values (
    p_room_id, 'participant', organizer_participant_id, p_origin, 'room.phase_advanced',
    'room', p_room_id, jsonb_build_object('phase', p_next_phase),
    jsonb_build_object('ok', true, 'decisionHash', candidate_hash),
    current_version, current_version + 1, false
  );
  return public.action_success('Room phase advanced.', current_version + 1);
end;
$$;

-- --------------------------------------------------------------------------
-- Meeting lock
-- --------------------------------------------------------------------------

create or replace function public.resolve_meeting_lock(
  p_room_id text,
  p_expected_version bigint,
  p_locked boolean,
  p_origin public.action_origin
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  room_row public.rooms;
  owner_id text;
  next_version bigint;
begin
  select * into room_row from public.rooms where id = p_room_id for update;
  if not found then return public.action_failure('VALIDATION_ERROR', 'Room not found.', 0); end if;
  if room_row.version <> p_expected_version then
    return public.action_failure('STALE_ROOM_STATE', 'The room changed before this action completed.', room_row.version,
      'Review the latest room state and retry if the action is still appropriate.');
  end if;
  if room_row.phase = 'finalized' then
    return public.action_failure('ALREADY_FINALIZED', 'The finalized room is immutable.', room_row.version);
  end if;

  select participant.id into owner_id from public.participants participant
    where participant.id = room_row.owner_participant_id and participant.room_id = p_room_id
      and participant.meeting_role = 'owner' and participant.status = 'active'
      and participant.user_id = (select auth.uid());
  if owner_id is null then
    return public.action_failure('NOT_AUTHORIZED', 'Only the current room owner can change meeting access.', room_row.version);
  end if;

  if room_row.is_locked = p_locked then
    return public.action_success(
      case when p_locked then 'Meeting is already locked.' else 'Meeting is already open.' end,
      room_row.version
    );
  end if;

  next_version := room_row.version + 1;
  update public.rooms set is_locked = p_locked, version = next_version where id = p_room_id;
  insert into public.audit_events (
    room_id, actor_type, actor_id, origin, action, entity_type, entity_id,
    sanitized_input, result, previous_room_version, resulting_room_version, confirmation_required
  ) values (
    p_room_id, 'participant', owner_id, p_origin,
    case when p_locked then 'meeting.locked' else 'meeting.unlocked' end,
    'room', p_room_id, jsonb_build_object('locked', p_locked),
    jsonb_build_object('ok', true), room_row.version, next_version, false
  );
  return public.action_success(
    case when p_locked then 'Meeting locked.' else 'Meeting unlocked.' end,
    next_version
  );
end;
$$;

create or replace function public.lock_meeting(p_room_id text, p_expected_version bigint, p_origin public.action_origin)
returns jsonb language sql security definer set search_path = '' as $$
  select public.resolve_meeting_lock(p_room_id, p_expected_version, true, p_origin);
$$;

create or replace function public.unlock_meeting(p_room_id text, p_expected_version bigint, p_origin public.action_origin)
returns jsonb language sql security definer set search_path = '' as $$
  select public.resolve_meeting_lock(p_room_id, p_expected_version, false, p_origin);
$$;

-- A locked room refuses to create a *new* waiting join request, but an
-- already-waiting request (created before the lock, or re-submitted by the
-- same session) is returned unchanged so the requester's own polling keeps
-- working and the owner keeps seeing it in the waiting room.
create or replace function public.create_or_reuse_join_request(
  p_room_id text, p_display_name text, p_role text, p_origin public.action_origin
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  requester uuid := (select auth.uid());
  room_version bigint;
  room_locked boolean;
  existing_status public.participant_status;
  request_row public.join_requests;
begin
  if requester is null then return public.action_failure('NOT_AUTHORIZED', 'An authenticated session is required.', 0); end if;
  if length(trim(p_display_name)) not between 1 and 120 or length(trim(p_role)) not between 1 and 120 then
    return public.action_failure('VALIDATION_ERROR', 'Join request details are invalid.', 0);
  end if;
  select version, is_locked into room_version, room_locked from public.rooms where id = p_room_id;
  if not found then return public.action_failure('INVALID_JOIN_CREDENTIALS', 'Room access details are invalid.', 0); end if;

  select status into existing_status from public.participants
    where room_id = p_room_id and user_id = requester;
  if existing_status = 'removed' then
    return public.action_failure('NOT_AUTHORIZED', 'This session was removed from the meeting and cannot rejoin.', room_version);
  end if;
  if existing_status = 'active' then
    return public.action_failure('ALREADY_PARTICIPANT', 'This session already belongs to the room.', room_version, 'Open the room directly.');
  end if;

  select * into request_row from public.join_requests
    where room_id = p_room_id and requester_user_id = requester and status = 'waiting';
  if not found then
    if room_locked then
      return public.action_failure('MEETING_LOCKED', 'This meeting is not accepting new participants right now.', room_version);
    end if;
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

-- Re-derive owner authority through the updated `is_room_organizer`-equivalent
-- check (inline, matching the rest of this function's style) so a removed
-- former owner can never resolve a waiting request either.
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
      and participant.meeting_role = 'owner' and participant.status = 'active'
      and participant.user_id = (select auth.uid());
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

-- --------------------------------------------------------------------------
-- Participant removal
-- --------------------------------------------------------------------------

-- Soft membership lifecycle: the row is never deleted, so positions,
-- constraints, proposals, objections, votes, approvals and audit provenance
-- keep referencing a valid participant id. Removal only flips `status` and
-- authority derivation (this migration's updated functions, plus `can_read_room`
-- and `is_room_organizer`) everywhere else.
create or replace function public.remove_participant(
  p_room_id text,
  p_participant_id text,
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
  owner_id text;
  target_row public.participants;
  next_version bigint;
  new_candidate jsonb;
  new_hash text;
begin
  select * into room_row from public.rooms where id = p_room_id for update;
  if not found then return public.action_failure('VALIDATION_ERROR', 'Room not found.', 0); end if;
  if room_row.version <> p_expected_version then
    return public.action_failure('STALE_ROOM_STATE', 'The room changed before this action completed.', room_row.version,
      'Review the latest room state and retry if the action is still appropriate.');
  end if;
  if room_row.phase = 'finalized' then
    return public.action_failure('ALREADY_FINALIZED', 'The finalized room is immutable.', room_row.version);
  end if;

  select participant.id into owner_id from public.participants participant
    where participant.id = room_row.owner_participant_id and participant.room_id = p_room_id
      and participant.meeting_role = 'owner' and participant.status = 'active'
      and participant.user_id = (select auth.uid());
  if owner_id is null then
    return public.action_failure('NOT_AUTHORIZED', 'Only the current room owner can remove a participant.', room_row.version);
  end if;

  select * into target_row from public.participants
    where id = p_participant_id and room_id = p_room_id for update;
  if not found then
    return public.action_failure('VALIDATION_ERROR', 'That participant does not belong to this room.', room_row.version);
  end if;
  if target_row.id = owner_id then
    return public.action_failure('NOT_AUTHORIZED', 'The current owner cannot remove themselves.', room_row.version,
      'Transfer ownership first.');
  end if;
  if target_row.kind <> 'human' then
    return public.action_failure('VALIDATION_ERROR', 'Only human participants can be removed with this action.', room_row.version);
  end if;
  if target_row.status = 'removed' then
    return public.action_failure('VALIDATION_ERROR', 'That participant was already removed.', room_row.version);
  end if;

  update public.participants
  set status = 'removed', removed_at = now(), required_for_approval = false
  where id = target_row.id;

  -- Minimal, safe legacy-engine compatibility cleanup: if the room already
  -- froze an approval candidate that counted this participant as required,
  -- recompute it now that they can no longer approve anything, and clear
  -- collected approvals against the stale hash so nobody is stuck waiting on
  -- a removed participant. This does not redesign Alignment; it only keeps
  -- the existing compatibility engine from deadlocking.
  if room_row.phase = 'approval' then
    new_candidate := public.build_final_decision_candidate(p_room_id);
    if new_candidate is not null then
      new_hash := public.hash_decision_candidate(new_candidate);
      delete from public.approvals where room_id = p_room_id;
      update public.rooms set decision_candidate = new_candidate, decision_hash = new_hash where id = p_room_id;
    end if;
  end if;

  next_version := room_row.version + 1;
  update public.rooms set version = next_version where id = p_room_id;
  insert into public.audit_events (
    room_id, actor_type, actor_id, origin, action, entity_type, entity_id,
    sanitized_input, result, previous_room_version, resulting_room_version, confirmation_required
  ) values (
    p_room_id, 'participant', owner_id, p_origin, 'participant.removed',
    'participant', target_row.id, jsonb_build_object('participantId', target_row.id),
    jsonb_build_object('ok', true), room_row.version, next_version, false
  );
  return public.action_success('Participant removed.', next_version);
end;
$$;

-- --------------------------------------------------------------------------
-- Ownership transfer
-- --------------------------------------------------------------------------

-- The room's `owner_participant_id` pointer is updated *before* the old
-- owner's row is demoted: `derive_owner_participant_authority` (Gate 1) forces
-- `meeting_role = 'owner'` back onto whichever participant currently matches
-- that pointer on every update, so demoting the old owner while the pointer
-- still names them would be silently undone by that trigger. Flipping the
-- pointer first makes the demotion stick and the promotion is then exactly
-- what the trigger would have done anyway.
create or replace function public.transfer_ownership(
  p_room_id text,
  p_participant_id text,
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
  old_owner_row public.participants;
  new_owner_row public.participants;
  next_version bigint;
begin
  select * into room_row from public.rooms where id = p_room_id for update;
  if not found then return public.action_failure('VALIDATION_ERROR', 'Room not found.', 0); end if;
  if room_row.version <> p_expected_version then
    return public.action_failure('STALE_ROOM_STATE', 'The room changed before this action completed.', room_row.version,
      'Review the latest room state and retry if the action is still appropriate.');
  end if;
  if room_row.phase = 'finalized' then
    return public.action_failure('ALREADY_FINALIZED', 'The finalized room is immutable.', room_row.version);
  end if;

  select * into old_owner_row from public.participants
    where id = room_row.owner_participant_id and room_id = p_room_id
      and meeting_role = 'owner' and status = 'active' and user_id = (select auth.uid())
    for update;
  if not found then
    return public.action_failure('NOT_AUTHORIZED', 'Only the current room owner can transfer ownership.', room_row.version);
  end if;

  select * into new_owner_row from public.participants
    where id = p_participant_id and room_id = p_room_id for update;
  if not found then
    return public.action_failure('VALIDATION_ERROR', 'That participant does not belong to this room.', room_row.version);
  end if;
  if new_owner_row.id = old_owner_row.id then
    return public.action_failure('VALIDATION_ERROR', 'The target is already the meeting owner.', room_row.version);
  end if;
  if new_owner_row.kind <> 'human' or new_owner_row.status <> 'active' then
    return public.action_failure('VALIDATION_ERROR',
      'Ownership can be transferred only to an active human participant.', room_row.version);
  end if;

  next_version := room_row.version + 1;
  update public.rooms set owner_participant_id = new_owner_row.id, version = next_version where id = p_room_id;

  update public.participants set meeting_role = 'participant' where id = old_owner_row.id;
  update public.participants set meeting_role = 'owner', decision_role = 'decision_maker' where id = new_owner_row.id;

  insert into public.audit_events (
    room_id, actor_type, actor_id, origin, action, entity_type, entity_id,
    sanitized_input, result, previous_room_version, resulting_room_version, confirmation_required
  ) values (
    p_room_id, 'participant', old_owner_row.id, p_origin, 'ownership.transferred',
    'participant', new_owner_row.id,
    jsonb_build_object('fromParticipantId', old_owner_row.id, 'toParticipantId', new_owner_row.id),
    jsonb_build_object('ok', true), room_row.version, next_version, false
  );
  return public.action_success('Ownership transferred.', next_version);
end;
$$;

revoke all on function public.resolve_meeting_lock(text, bigint, boolean, public.action_origin) from public;
revoke all on function public.lock_meeting(text, bigint, public.action_origin) from public;
revoke all on function public.unlock_meeting(text, bigint, public.action_origin) from public;
revoke all on function public.remove_participant(text, text, bigint, public.action_origin) from public;
revoke all on function public.transfer_ownership(text, text, bigint, public.action_origin) from public;

grant execute on function public.lock_meeting(text, bigint, public.action_origin) to authenticated;
grant execute on function public.unlock_meeting(text, bigint, public.action_origin) to authenticated;
grant execute on function public.remove_participant(text, text, bigint, public.action_origin) to authenticated;
grant execute on function public.transfer_ownership(text, text, bigint, public.action_origin) to authenticated;
