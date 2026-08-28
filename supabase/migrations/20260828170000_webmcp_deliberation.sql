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
    and kind = 'human';
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

revoke all on function public.propose_participant_tradeoff(
  text, bigint, text[], text, text, text, text, text, text[], text[], public.action_origin
) from public;

grant execute on function public.propose_participant_tradeoff(
  text, bigint, text[], text, text, text, text, text, text[], text[], public.action_origin
) to authenticated;
