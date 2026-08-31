-- Slice A3: production room lifecycle and participant readiness.
--
-- Two authorities, kept apart:
--   * a claimed human marks *their own* input ready (`mark_my_input_ready`);
--   * the room organizer advances the *room* (`advance_room_phase`).
-- Neither can act for the other, and neither can finalize: `approval` is left
-- out of the transition map, so the last required human approval remains the
-- only path to `finalized`.
--
-- `advance_demo_room_phase` stays a separate, demo-only entry point. The phase
-- rules it already encodes for `voting` and `approval` are extracted here into
-- `apply_room_phase_entry`, which both callers now share, so voting and
-- approval logic exists exactly once.

alter table public.participants
  add column ready_at timestamptz;

comment on column public.participants.ready_at is
  'When this human declared their own input complete. Server-set from the claimed session; the public DTO exposes only isReady.';

-- Rules and side effects for *entering* a phase, shared by the demo and the
-- production phase functions. Returns `{"ok": true, "decisionHash": ...}` or an
-- `action_failure` object the caller returns unchanged.
--
-- The caller has already locked the room row, so this reads a settled version.
create or replace function public.apply_room_phase_entry(
  p_room_id text,
  p_next_phase public.room_phase,
  p_current_version bigint,
  p_active_proposal_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  required_count integer;
  recorded_count integer;
  support_count integer;
  request_changes_count integer;
  candidate_value jsonb;
  candidate_hash text := null;
begin
  if p_next_phase = 'voting' then
    if p_active_proposal_id is null then
      return public.action_failure('VALIDATION_ERROR', 'An active proposal is required for voting.', p_current_version);
    end if;
    if exists (
      select 1 from public.conflicts
      where room_id = p_room_id and status = 'open' and severity = 'blocking'
    ) then
      return public.action_failure('UNRESOLVED_BLOCKING_CONFLICT',
        'A blocking conflict prevents voting.', p_current_version,
        'Resolve every blocking issue before entering voting.');
    end if;
    delete from public.votes where room_id = p_room_id;
    delete from public.approvals where room_id = p_room_id;
    update public.rooms
    set decision_candidate = null, decision_hash = null, final_record = null
    where id = p_room_id;
  elsif p_next_phase = 'approval' then
    select count(*) into required_count from public.participants
    where room_id = p_room_id and kind = 'human' and required_for_approval = true;
    select count(*) into recorded_count from public.votes vote
    join public.participants participant on participant.id = vote.participant_id
    where vote.room_id = p_room_id and vote.proposal_id = p_active_proposal_id
      and participant.kind = 'human' and participant.required_for_approval = true;
    select count(*) into support_count from public.votes vote
    join public.participants participant on participant.id = vote.participant_id
    where vote.room_id = p_room_id and vote.proposal_id = p_active_proposal_id
      and participant.kind = 'human' and participant.required_for_approval = true
      and vote.choice = 'support';
    select count(*) into request_changes_count from public.votes vote
    join public.participants participant on participant.id = vote.participant_id
    where vote.room_id = p_room_id and vote.proposal_id = p_active_proposal_id
      and participant.kind = 'human' and participant.required_for_approval = true
      and vote.choice = 'request_changes';
    if required_count = 0 or recorded_count <> required_count then
      return public.action_failure('VALIDATION_ERROR',
        'Every required human participant must vote before approval.', p_current_version);
    end if;
    if request_changes_count > 0 then
      return public.action_failure('VALIDATION_ERROR',
        'A required participant requested changes.', p_current_version,
        'Return to deliberation in a later workflow before seeking approval.');
    end if;
    if support_count <= required_count / 2 then
      return public.action_failure('VALIDATION_ERROR',
        'The active proposal did not receive a strict majority of required support votes.', p_current_version);
    end if;
    if exists (
      select 1 from public.conflicts
      where room_id = p_room_id and status = 'open' and severity = 'blocking'
    ) then
      return public.action_failure('UNRESOLVED_BLOCKING_CONFLICT',
        'A blocking conflict prevents approval.', p_current_version);
    end if;
    candidate_value := public.build_final_decision_candidate(p_room_id);
    candidate_hash := public.hash_decision_candidate(candidate_value);
    delete from public.approvals where room_id = p_room_id;
    update public.rooms
    set decision_candidate = candidate_value, decision_hash = candidate_hash
    where id = p_room_id;
  end if;

  return jsonb_build_object('ok', true, 'decisionHash', candidate_hash);
end;
$$;

-- Unchanged demo behaviour; the voting/approval branch now lives in
-- `apply_room_phase_entry` instead of being duplicated here.
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
  active_id text;
  actor_participant_id text;
  entry_result jsonb;
  candidate_hash text;
begin
  select version, phase, active_proposal_id into current_version, current_phase, active_id
  from public.rooms where id = p_room_id for update;
  if not found then return public.action_failure('VALIDATION_ERROR', 'Room not found.', 0); end if;
  if current_phase = 'finalized' then
    return public.action_failure('ALREADY_FINALIZED', 'The finalized decision is immutable.', current_version);
  end if;
  if p_room_id <> 'demo' then
    return public.action_failure('NOT_AUTHORIZED', 'Developer phase transitions are limited to the demo room.', current_version);
  end if;
  if current_version <> p_expected_version then
    return public.action_failure('STALE_ROOM_STATE', 'The room changed before this action completed.', current_version,
      'Review the latest room state and retry if the action is still appropriate.');
  end if;
  if not ((current_phase = 'input' and p_next_phase = 'proposals') or
          (current_phase = 'proposals' and p_next_phase = 'deliberation') or
          (current_phase = 'deliberation' and p_next_phase = 'voting') or
          (current_phase = 'voting' and p_next_phase = 'approval')) then
    return public.action_failure('WRONG_PHASE', 'Only the next controlled demo phase may be selected.', current_version);
  end if;
  select id into actor_participant_id from public.participants
  where room_id = p_room_id and user_id = (select auth.uid()) and kind = 'human';
  if actor_participant_id is null then
    return public.action_failure('NOT_AUTHORIZED', 'Claim a human participant seat first.', current_version);
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
    p_room_id, 'participant', actor_participant_id, p_origin, 'room.phase_advanced',
    'room', p_room_id, jsonb_build_object('phase', p_next_phase),
    jsonb_build_object('ok', true, 'decisionHash', candidate_hash),
    current_version, current_version + 1, false
  );
  return public.action_success('Demo room phase advanced.', current_version + 1);
end;
$$;

-- A claimed human declares their own input complete. The seat is derived from
-- `auth.uid()`, so this operation can never mark anyone else ready, and it is
-- available only while the room is still collecting input.
--
-- Re-marking an already-ready seat succeeds without a second version bump or
-- audit event, matching how a repeated seat claim behaves.
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
  where room_id = p_room_id and user_id = (select auth.uid()) and kind = 'human'
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

-- Organizer-only room progression for real rooms.
--
-- Authority is the server-derived organizer of this room, never a request
-- field, and never a participant seat: `is_room_organizer` reads
-- `rooms.organizer_user_id`, which only `create_room` ever sets. The seeded
-- demo room has no organizer, so it can never be driven through here.
--
-- `approval` is absent from the transition map on purpose: an organizer moves
-- the room *into* approval, and only the last required human approval moves it
-- to `finalized`.
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
  where room_id = p_room_id and user_id = (select auth.uid()) and kind = 'human';

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

revoke all on function public.apply_room_phase_entry(text, public.room_phase, bigint, text) from public;
revoke all on function public.mark_my_input_ready(text, bigint, public.action_origin) from public;
revoke all on function public.advance_room_phase(text, bigint, public.room_phase, public.action_origin) from public;

grant execute on function public.mark_my_input_ready(text, bigint, public.action_origin) to authenticated;
grant execute on function public.advance_room_phase(text, bigint, public.room_phase, public.action_origin) to authenticated;
