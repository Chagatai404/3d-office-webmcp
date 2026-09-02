-- A6: explicit role and decision-authority assignment.
--
-- Scope (matches the sprint checklist -- not a general RBAC system):
--   role         = human-readable/domain identity (CEO, CTO, Designer, ...)
--   meetingRole  = administrative authority (owner/cohost/participant)
--   decisionRole = meeting decision authority (decision_maker/contributor/advisor)
--
-- Two gaps this migration closes:
--
-- 1. Admission previously always used the joiner's own self-reported
--    `role` verbatim and always hardcoded `decision_role = 'contributor'`.
--    The joiner's requested role was therefore unquestioned authority, not
--    requested metadata -- exactly what the checklist flags. `admit_join_request`
--    (and the `resolve_join_request` it delegates to) now accept optional
--    `p_role` / `p_decision_role` overrides so the owner's agent can express
--    "Admit Deniz as CTO and give him decision authority" in one call. Both
--    default to null, which preserves the exact previous behavior (the
--    joiner's own role, `contributor`) when the owner supplies neither --
--    so every existing caller (including the demo/seed fixtures) is
--    unaffected.
-- 2. There was no way to change an existing participant's role or decision
--    authority after admission except a decision-role-only path
--    (`set_participant_decision_role`, unchanged and still the canonical
--    decision-role mutation). `configure_participant` is the new, single
--    owner-only capability the checklist asks for ("one clear configuration
--    capability rather than many ambiguous controls"): it can update role,
--    decision role, or both in one call, reusing the exact same owner-can
--    -never-cease-being-decision-maker and frozen-candidate invariants
--    `set_participant_decision_role` already enforces.
--
-- Both paths share the same hard rules:
--   * only an owner may call either;
--   * only an active, claimed `kind = 'human'` participant may be the
--     target -- `kind = 'expert'` / `kind = 'simulation'` can never be
--     assigned a decision role or promoted into human authority through
--     either path;
--   * `advisor` can never be assigned to a human through either path -- it
--     stays reserved for expert/simulation actors, exactly like
--     `set_participant_decision_role` already enforces;
--   * the current owner can never cease being a decision-maker;
--   * every change is audited.

drop function if exists public.resolve_join_request(text, text, bigint, public.action_origin, public.join_request_status);

create function public.resolve_join_request(
  p_room_id text, p_join_request_id text, p_expected_version bigint,
  p_origin public.action_origin, p_resolution public.join_request_status,
  p_role text default null, p_decision_role public.decision_role default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare room_row public.rooms; request_row public.join_requests; owner_id text; next_version bigint; participant_id text;
  resolved_role text; resolved_decision_role public.decision_role;
begin
  if p_resolution not in ('admitted', 'rejected') then return public.action_failure('VALIDATION_ERROR', 'Invalid join resolution.', 0); end if;
  if p_decision_role = 'advisor' then
    return public.action_failure('VALIDATION_ERROR',
      'A human participant cannot be admitted as advisor -- that role is reserved for expert/simulation actors.', 0);
  end if;
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
    -- The joiner's own requested role is metadata, not unquestioned
    -- authority: the owner's explicit `p_role`/`p_decision_role`, when
    -- supplied, always wins. Neither supplied preserves the previous
    -- behavior exactly.
    resolved_role := coalesce(p_role, request_row.role);
    resolved_decision_role := coalesce(p_decision_role, 'contributor'::public.decision_role);
    participant_id := gen_random_uuid()::text;
    insert into public.participants(id, room_id, user_id, name, role, kind, meeting_role, decision_role, required_for_approval)
    values (participant_id, p_room_id, request_row.requester_user_id, request_row.display_name, resolved_role, 'human', 'participant', resolved_decision_role, false);
  end if;
  update public.join_requests set status = p_resolution, resolved_at = now(), resolved_by_participant_id = owner_id
    where id = request_row.id returning * into request_row;
  next_version := room_row.version + 1;
  update public.rooms set version = next_version where id = p_room_id;
  insert into public.audit_events(room_id, actor_type, actor_id, origin, action, entity_type, entity_id, sanitized_input, result, previous_room_version, resulting_room_version, confirmation_required)
  values (p_room_id, 'participant', owner_id, p_origin,
    case when p_resolution = 'admitted' then 'join.admitted' else 'join.rejected' end,
    'join_request', request_row.id, jsonb_build_object('joinRequestId', request_row.id),
    jsonb_strip_nulls(jsonb_build_object(
      'status', p_resolution, 'participantId', participant_id,
      'role', case when p_resolution = 'admitted' then resolved_role else null end,
      'decisionRole', case when p_resolution = 'admitted' then resolved_decision_role else null end
    )), room_row.version, next_version, false);
  return public.action_success_data(case when p_resolution = 'admitted' then 'Participant admitted.' else 'Join request rejected.' end,
    next_version, public.join_request_dto(request_row));
end;
$$;

revoke all on function public.resolve_join_request(text, text, bigint, public.action_origin, public.join_request_status, text, public.decision_role) from public;

drop function if exists public.admit_join_request(text, text, bigint, public.action_origin);

create function public.admit_join_request(
  p_room_id text, p_join_request_id text, p_expected_version bigint, p_origin public.action_origin,
  p_role text default null, p_decision_role public.decision_role default null
)
returns jsonb language sql security definer set search_path = '' as $$
  select public.resolve_join_request(p_room_id, p_join_request_id, p_expected_version, p_origin, 'admitted', p_role, p_decision_role);
$$;

revoke all on function public.admit_join_request(text, text, bigint, public.action_origin, text, public.decision_role) from public;
grant execute on function public.admit_join_request(text, text, bigint, public.action_origin, text, public.decision_role) to authenticated;

-- --------------------------------------------------------------------------
-- configure_participant: the single post-admission role/decision-authority
-- configuration capability.
-- --------------------------------------------------------------------------

create function public.configure_participant(
  p_room_id text,
  p_participant_id text,
  p_expected_version bigint,
  p_origin public.action_origin,
  p_role text default null,
  p_decision_role public.decision_role default null
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
  resolved_role text;
  resolved_decision_role public.decision_role;
begin
  if p_role is null and p_decision_role is null then
    return public.action_failure('VALIDATION_ERROR', 'Provide a role, a decision role, or both.', 0);
  end if;
  if p_decision_role = 'advisor' then
    return public.action_failure('VALIDATION_ERROR',
      'A human participant cannot be assigned advisor -- that role is reserved for expert/simulation actors.', 0);
  end if;

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
    return public.action_failure('NOT_AUTHORIZED', 'Only the current room owner can configure a participant.', room_row.version);
  end if;

  -- Matches `set_participant_decision_role`'s exact invariant: once a
  -- candidate is frozen, decision authority cannot change at all, even to
  -- the same value, because its authority metadata was already reviewed
  -- against the current set. A role-only change (no `p_decision_role`) is
  -- not restricted by this -- it carries no decision-hash-relevant
  -- authority.
  if p_decision_role is not null and room_row.decision_hash is not null then
    return public.action_failure('VALIDATION_ERROR',
      'Decision authority cannot change once an exact decision candidate is frozen.', room_row.version,
      'Return to Alignment before changing decision authority.');
  end if;

  select * into target_row from public.participants where id = p_participant_id and room_id = p_room_id for update;
  if not found then
    return public.action_failure('VALIDATION_ERROR', 'That participant does not belong to this room.', room_row.version);
  end if;
  if target_row.status <> 'active' then
    return public.action_failure('VALIDATION_ERROR', 'Only an active participant can be configured.', room_row.version);
  end if;
  if target_row.kind <> 'human' then
    return public.action_failure('NOT_AUTHORIZED',
      'Only a human participant can be configured this way -- expert and simulation actors can never be assigned a role or decision authority.', room_row.version);
  end if;
  if p_decision_role is not null and target_row.id = owner_id and p_decision_role <> 'decision_maker' then
    return public.action_failure('NOT_AUTHORIZED', 'The current owner cannot cease being a decision maker.', room_row.version);
  end if;

  resolved_role := coalesce(p_role, target_row.role);
  resolved_decision_role := coalesce(p_decision_role, target_row.decision_role);
  if resolved_role = target_row.role and resolved_decision_role = target_row.decision_role then
    return public.action_success('Participant is already configured this way.', room_row.version);
  end if;

  update public.participants set role = resolved_role, decision_role = resolved_decision_role where id = target_row.id;
  next_version := room_row.version + 1;
  update public.rooms set version = next_version where id = p_room_id;
  insert into public.audit_events (
    room_id, actor_type, actor_id, origin, action, entity_type, entity_id,
    sanitized_input, result, previous_room_version, resulting_room_version, confirmation_required
  ) values (
    p_room_id, 'participant', owner_id, p_origin, 'participant.configured',
    'participant', target_row.id,
    jsonb_build_object(
      'participantId', target_row.id,
      'role', jsonb_build_object('from', target_row.role, 'to', resolved_role),
      'decisionRole', jsonb_build_object('from', target_row.decision_role, 'to', resolved_decision_role)
    ),
    jsonb_build_object('ok', true), room_row.version, next_version, false
  );
  return public.action_success('Participant configured.', next_version);
end;
$$;

revoke all on function public.configure_participant(text, text, bigint, public.action_origin, text, public.decision_role) from public;
grant execute on function public.configure_participant(text, text, bigint, public.action_origin, text, public.decision_role) to authenticated;
