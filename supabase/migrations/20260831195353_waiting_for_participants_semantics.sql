-- A5: explicit waiting/recovery semantics.
--
-- Adds a `details` parameter to `action_failure` (a JSON-safe structured
-- payload, e.g. `{"waitingParticipantIds": [...]}`, merged into the same
-- `error` object as `code`/`message`/`recovery`, omitted entirely when
-- null via the same `jsonb_strip_nulls` every existing refusal already
-- relies on). This is additive: every existing call site passes 3 or 4
-- positional arguments and continues to resolve to this function via the
-- trailing defaults, so no other function's `action_failure(...)` call
-- needs to change.
--
-- `advance_room_phase`'s three Input -> Proposals readiness checks
-- (join / position / ready) moved from a generic `VALIDATION_ERROR` to the
-- new canonical `WAITING_FOR_PARTICIPANTS` code, now carrying exactly which
-- required participants are still pending in
-- `details.waitingParticipantIds`. This is a genuine, frequently-hit
-- "waiting for people" state distinct from a malformed request, so it earns
-- the dedicated code the sprint checklist asks for. `WAITING_FOR_ALIGNMENT`
-- (also listed in the checklist) is deliberately *not* wired to anything:
-- alignment is informative by product design and never mechanically gates
-- a phase transition anywhere in this schema (see
-- `20260830130000_alignment_and_decision_policy.sql`'s header comment) --
-- inventing a call site for it would misrepresent that invariant, not
-- clarify it. `UNRESOLVED_BLOCKING_CONFLICT` and `HUMAN_CONFIRMATION_REQUIRED`,
-- the other two codes the checklist names, already exist and are already
-- used exactly where they apply.
drop function if exists public.action_failure(text, text, bigint, text);

create function public.action_failure(
  error_code text,
  error_message text,
  current_room_version bigint,
  recovery_message text default null,
  details jsonb default null
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
      'recovery', recovery_message,
      'details', details
    )),
    'roomVersion', current_room_version
  );
$$;

-- `drop function` resets permissions to the Postgres default (EXECUTE
-- granted to PUBLIC), so this is re-revoked exactly like the original
-- 4-argument function was: internal-only, never called directly via
-- PostgREST RPC.
revoke all on function public.action_failure(text, text, bigint, text, jsonb) from public;

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
  waiting_ids text[];
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
  -- procedural step is open to any active claimed human -- see the A4
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

    select coalesce(array_agg(id), '{}') into waiting_ids from public.participants
    where room_id = p_room_id and kind = 'human' and required_for_approval = true and user_id is null;
    if cardinality(waiting_ids) > 0 then
      return public.action_failure('WAITING_FOR_PARTICIPANTS',
        'Every required participant must join before proposals begin.', current_version,
        'Share the remaining invite links.',
        jsonb_build_object('waitingParticipantIds', to_jsonb(waiting_ids)));
    end if;

    select coalesce(array_agg(participant.id), '{}') into waiting_ids from public.participants participant
    where participant.room_id = p_room_id and participant.kind = 'human'
      and participant.required_for_approval = true
      and not exists (
        select 1 from public.positions position_row
        where position_row.room_id = p_room_id
          and position_row.participant_id = participant.id
      );
    if cardinality(waiting_ids) > 0 then
      return public.action_failure('WAITING_FOR_PARTICIPANTS',
        'Every required participant must publish a position before proposals begin.', current_version,
        'Wait for the remaining participants to share their input.',
        jsonb_build_object('waitingParticipantIds', to_jsonb(waiting_ids)));
    end if;

    select coalesce(array_agg(id), '{}') into waiting_ids from public.participants
    where room_id = p_room_id and kind = 'human' and required_for_approval = true and ready_at is null;
    if cardinality(waiting_ids) > 0 then
      return public.action_failure('WAITING_FOR_PARTICIPANTS',
        'Every required participant must mark their input ready before proposals begin.', current_version,
        'Ask the remaining participants to confirm their input is complete.',
        jsonb_build_object('waitingParticipantIds', to_jsonb(waiting_ids)));
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
