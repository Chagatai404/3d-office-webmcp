-- A4: correct authority gating for room-phase progression.
--
-- Product distinction this migration encodes:
--
--   meeting administration != meeting progression != decision authority
--
-- Before this migration, `advance_room_phase` required
-- `is_room_organizer(p_room_id)` (meeting-owner authority) for every
-- transition it handles: Input -> Proposals, Proposals -> Deliberation,
-- Deliberation -> Alignment, and Alignment -> Decision review. That
-- conflated three different kinds of authority into one gate. Genuine
-- meeting administration (admitting/removing participants, locking the
-- meeting, transferring ownership, decision-policy/decision-role
-- assignment, enabling the Security Expert) stays owner-only and is
-- untouched here -- see `is_room_organizer`'s remaining call sites.
--
-- What changes:
--   * Input -> Proposals, Proposals -> Deliberation, and
--     Deliberation -> Alignment (the transitions `advance_discussion` and
--     `request_team_alignment` drive) no longer require meeting ownership.
--     Any active, claimed human participant may initiate them -- procedural
--     progression is normal collaboration, not administration. Every
--     existing prerequisite (all required participants joined/positioned/
--     ready before Proposals; an active proposal before Deliberation; no
--     open blocking conflict before Alignment, enforced by
--     `apply_room_phase_entry`) is completely unchanged: this migration
--     only widens *who* may attempt the transition, never *when* it can
--     succeed.
--   * Alignment -> Decision review (`review_final_decision`) now requires
--     the caller to be an active, claimed human whose `decision_role` is
--     `decision_maker` -- decision-review authority, not administrative
--     authority. The current owner is always a decision-maker (see
--     `set_participant_decision_role`'s invariant that the owner can never
--     be demoted from decision-maker), so this is a superset of "owner may
--     always review," not a narrowing of it.
--
-- The actor recorded on the resulting `room.phase_advanced` audit event is
-- still derived from `auth.uid()`, exactly as before -- only the
-- authorization *rule* changes, not how the actor is identified.
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
  actor_participant_id text;
  actor_decision_role public.decision_role;
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

  select id, decision_role into actor_participant_id, actor_decision_role
  from public.participants
  where room_id = p_room_id and user_id = (select auth.uid()) and kind = 'human' and status = 'active';

  if actor_participant_id is null then
    return public.action_failure('NOT_AUTHORIZED',
      'Claim an active participant seat before advancing the room phase.', current_version,
      'Claim a seat in the visible application UI, then retry.');
  end if;

  -- Only entering decision review requires decision authority. Every other
  -- procedural step is open to any active claimed human -- see this
  -- migration's header comment.
  if p_next_phase = 'approval' and actor_decision_role <> 'decision_maker' then
    return public.action_failure('NOT_AUTHORIZED',
      'Only a participant with decision authority can move the room into decision review.', current_version,
      'Ask a decision-maker to review the final decision.');
  end if;

  if current_version <> p_expected_version then
    return public.action_failure('STALE_ROOM_STATE', 'The room changed before this action completed.', current_version,
      'Review the latest room state and retry if the action is still appropriate.');
  end if;
  if current_phase = 'approval' then
    return public.action_failure('WRONG_PHASE',
      'The room cannot be advanced out of decision review this way.', current_version,
      'Finalization happens when every required participant approves the exact decision.');
  end if;
  if not ((current_phase = 'input' and p_next_phase = 'proposals') or
          (current_phase = 'proposals' and p_next_phase = 'deliberation') or
          (current_phase = 'deliberation' and p_next_phase = 'voting') or
          (current_phase = 'voting' and p_next_phase = 'approval')) then
    return public.action_failure('WRONG_PHASE', 'Only the next room phase may be selected.', current_version);
  end if;

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
    p_room_id, 'participant', actor_participant_id, p_origin, 'room.phase_advanced',
    'room', p_room_id, jsonb_build_object('phase', p_next_phase),
    jsonb_build_object('ok', true, 'decisionHash', candidate_hash),
    current_version, current_version + 1, false
  );
  return public.action_success('Room phase advanced.', current_version + 1);
end;
$$;
