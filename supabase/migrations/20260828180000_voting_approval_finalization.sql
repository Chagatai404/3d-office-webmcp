alter table public.conflicts
  add column resolved_by_actor_type public.actor_type,
  add column resolved_by_actor_id text,
  add column resolution_note text;

alter table public.rooms
  add column decision_candidate jsonb,
  add column decision_hash text,
  add column final_record jsonb;

create or replace function public.action_success_data(
  success_message text,
  current_room_version bigint,
  result_data jsonb
)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'ok', true,
    'data', result_data,
    'roomVersion', current_room_version,
    'message', success_message
  );
$$;

create or replace function public.canonical_jsonb_text(input_value jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  item record;
  parts text[] := '{}';
begin
  case jsonb_typeof(input_value)
    when 'object' then
      for item in select key, value from jsonb_each(input_value) order by key
      loop
        parts := array_append(
          parts,
          to_jsonb(item.key)::text || ':' || public.canonical_jsonb_text(item.value)
        );
      end loop;
      return '{' || array_to_string(parts, ',') || '}';
    when 'array' then
      for item in
        select value from jsonb_array_elements(input_value) with ordinality
        order by ordinality
      loop
        parts := array_append(parts, public.canonical_jsonb_text(item.value));
      end loop;
      return '[' || array_to_string(parts, ',') || ']';
    else
      return input_value::text;
  end case;
end;
$$;

create or replace function public.hash_decision_candidate(candidate jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(extensions.digest(public.canonical_jsonb_text(candidate), 'sha256'), 'hex');
$$;

create or replace function public.build_final_decision_candidate(p_room_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  active_id text;
  proposal_value jsonb;
  tradeoff_values jsonb;
  warning_values jsonb;
  vote_values jsonb;
  dissent_values jsonb;
  required_ids jsonb;
begin
  select active_proposal_id into active_id
  from public.rooms where id = p_room_id;
  if active_id is null then return null; end if;

  select jsonb_build_object(
    'id', p.id,
    'participantId', p.participant_id,
    'title', p.title,
    'summary', p.summary,
    'rationale', p.rationale,
    'expectedOutcomes', (
      select coalesce(jsonb_agg(value order by value), '[]'::jsonb)
      from unnest(p.expected_outcomes) as expected(value)
    ),
    'referencedConstraintIds', (
      select coalesce(jsonb_agg(value order by value), '[]'::jsonb)
      from unnest(p.referenced_constraint_ids) as referenced(value)
    ),
    'parentProposalId', p.parent_proposal_id,
    'status', p.status,
    'createdAt', p.created_at
  ) into proposal_value
  from public.proposals p
  where p.id = active_id and p.room_id = p_room_id;
  if proposal_value is null then return null; end if;

  with recursive lineage as (
    select id, parent_proposal_id
    from public.proposals
    where id = active_id and room_id = p_room_id
    union all
    select parent.id, parent.parent_proposal_id
    from public.proposals parent
    join lineage child on parent.id = child.parent_proposal_id
    where parent.room_id = p_room_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id,
    'conflictIds', (
      select coalesce(jsonb_agg(value order by value), '[]'::jsonb)
      from unnest(t.conflict_ids) as conflicts(value)
    ),
    'createdByActorType', t.created_by_actor_type,
    'createdByActorId', t.created_by_actor_id,
    'description', t.description,
    'expectedEffect', t.expected_effect,
    'resultingProposalId', t.resulting_proposal_id,
    'createdAt', t.created_at
  ) order by t.id), '[]'::jsonb)
  into tradeoff_values
  from public.tradeoffs t
  where t.room_id = p_room_id
    and t.resulting_proposal_id in (select id from lineage);

  with recursive lineage as (
    select id, parent_proposal_id
    from public.proposals
    where id = active_id and room_id = p_room_id
    union all
    select parent.id, parent.parent_proposal_id
    from public.proposals parent
    join lineage child on parent.id = child.parent_proposal_id
    where parent.room_id = p_room_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id,
    'proposalId', c.proposal_id,
    'constraintId', c.constraint_id,
    'raisedByActorType', c.raised_by_actor_type,
    'raisedByActorId', c.raised_by_actor_id,
    'severity', c.severity,
    'reason', c.reason,
    'status', c.status,
    'resolvedByActorType', c.resolved_by_actor_type,
    'resolvedByActorId', c.resolved_by_actor_id,
    'resolutionNote', c.resolution_note,
    'createdAt', c.created_at,
    'resolvedAt', c.resolved_at
  ) order by c.id), '[]'::jsonb)
  into warning_values
  from public.conflicts c
  where c.room_id = p_room_id
    and c.proposal_id in (select id from lineage)
    and c.status = 'open'
    and c.severity = 'warning';

  select coalesce(jsonb_agg(jsonb_build_object(
    'proposalId', v.proposal_id,
    'participantId', v.participant_id,
    'choice', v.choice,
    'comment', v.comment,
    'updatedAt', v.updated_at
  ) order by v.participant_id), '[]'::jsonb)
  into vote_values
  from public.votes v
  where v.room_id = p_room_id and v.proposal_id = active_id;

  select coalesce(jsonb_agg(to_jsonb(
    participant.name || ' (' || participant.role || '): ' || vote.choice::text ||
    case when vote.comment is null then '' else ' — ' || vote.comment end
  ) order by participant.id), '[]'::jsonb)
  into dissent_values
  from public.votes vote
  join public.participants participant on participant.id = vote.participant_id
  where vote.room_id = p_room_id
    and vote.proposal_id = active_id
    and vote.choice <> 'support';

  select coalesce(jsonb_agg(to_jsonb(id) order by id), '[]'::jsonb)
  into required_ids
  from public.participants
  where room_id = p_room_id
    and kind = 'human'
    and required_for_approval = true;

  return jsonb_build_object(
    'proposal', proposal_value,
    'rationale', proposal_value->>'rationale',
    'acceptedTradeoffs', tradeoff_values,
    'unresolvedWarnings', warning_values,
    'votes', vote_values,
    'owners', '[]'::jsonb,
    'deadlines', '[]'::jsonb,
    'actionItems', '[]'::jsonb,
    'dissent', dissent_values,
    'requiredApprovalParticipantIds', required_ids
  );
end;
$$;

create or replace function public.build_final_decision_preview(
  p_room_id text,
  candidate jsonb,
  candidate_hash text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  approval_values jsonb;
  missing_ids jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
    'participantId', approval.participant_id,
    'decisionHash', approval.decision_hash,
    'approvedAt', approval.approved_at
  ) order by approval.participant_id), '[]'::jsonb)
  into approval_values
  from public.approvals approval
  where approval.room_id = p_room_id
    and approval.decision_hash = candidate_hash;

  select coalesce(jsonb_agg(to_jsonb(participant.id) order by participant.id), '[]'::jsonb)
  into missing_ids
  from public.participants participant
  where participant.room_id = p_room_id
    and participant.kind = 'human'
    and participant.required_for_approval = true
    and not exists (
      select 1 from public.approvals approval
      where approval.room_id = p_room_id
        and approval.participant_id = participant.id
        and approval.decision_hash = candidate_hash
    );

  return candidate || jsonb_build_object(
    'decisionHash', candidate_hash,
    'approvals', approval_values,
    'missingApprovalParticipantIds', missing_ids
  );
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
  where room_id = p_room_id and user_id = (select auth.uid()) and kind = 'human';
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
  where room_id = p_room_id and user_id = (select auth.uid()) and kind = 'human';
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

create or replace function public.get_final_decision_preview(p_room_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_version bigint;
  current_phase public.room_phase;
  stored_candidate jsonb;
  stored_hash text;
  current_candidate jsonb;
  current_hash text;
begin
  if (select auth.uid()) is null then
    return public.action_failure('NOT_AUTHORIZED', 'An authenticated session is required.', 0);
  end if;
  select version, phase, decision_candidate, decision_hash
  into current_version, current_phase, stored_candidate, stored_hash
  from public.rooms where id = p_room_id;
  if not found then return public.action_failure('VALIDATION_ERROR', 'Room not found.', 0); end if;
  if not public.can_read_room(p_room_id) then
    return public.action_failure('NOT_AUTHORIZED', 'Room access is not authorized.', current_version);
  end if;
  if current_phase <> 'approval' then
    return public.action_failure(
      case when current_phase = 'finalized' then 'ALREADY_FINALIZED' else 'WRONG_PHASE' end,
      case when current_phase = 'finalized'
        then 'The decision is already finalized; read its immutable record.'
        else 'Final decision preview is available only during approval.' end,
      current_version
    );
  end if;
  current_candidate := public.build_final_decision_candidate(p_room_id);
  current_hash := public.hash_decision_candidate(current_candidate);
  if stored_candidate is null or stored_hash is null
    or stored_candidate <> current_candidate or stored_hash <> current_hash then
    return public.action_failure('DECISION_CHANGED', 'The final decision candidate changed.', current_version,
      'Review the updated final decision before approving again.');
  end if;
  return public.action_success_data(
    'Exact final decision loaded. Voting does not count as approval.',
    current_version,
    public.build_final_decision_preview(p_room_id, current_candidate, current_hash)
  );
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

create or replace function public.get_persisted_decision_record(p_room_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_version bigint;
  current_phase public.room_phase;
  record_value jsonb;
begin
  if (select auth.uid()) is null then
    return public.action_failure('NOT_AUTHORIZED', 'An authenticated session is required.', 0);
  end if;
  select version, phase, final_record into current_version, current_phase, record_value
  from public.rooms where id = p_room_id;
  if not found then return public.action_failure('VALIDATION_ERROR', 'Room not found.', 0); end if;
  if not public.can_read_room(p_room_id) then
    return public.action_failure('NOT_AUTHORIZED', 'Room access is not authorized.', current_version);
  end if;
  if current_phase <> 'finalized' or record_value is null then
    return public.action_failure('WRONG_PHASE', 'No finalized decision record exists.', current_version);
  end if;
  return public.action_success_data('Immutable decision record loaded.', current_version, record_value);
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
  active_id text;
  actor_participant_id text;
  required_count integer;
  recorded_count integer;
  support_count integer;
  request_changes_count integer;
  candidate_value jsonb;
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

  if p_next_phase = 'voting' then
    if active_id is null then
      return public.action_failure('VALIDATION_ERROR', 'An active proposal is required for voting.', current_version);
    end if;
    if exists (
      select 1 from public.conflicts
      where room_id = p_room_id and status = 'open' and severity = 'blocking'
    ) then
      return public.action_failure('UNRESOLVED_BLOCKING_CONFLICT',
        'A blocking conflict prevents voting.', current_version,
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
    where vote.room_id = p_room_id and vote.proposal_id = active_id
      and participant.kind = 'human' and participant.required_for_approval = true;
    select count(*) into support_count from public.votes vote
    join public.participants participant on participant.id = vote.participant_id
    where vote.room_id = p_room_id and vote.proposal_id = active_id
      and participant.kind = 'human' and participant.required_for_approval = true
      and vote.choice = 'support';
    select count(*) into request_changes_count from public.votes vote
    join public.participants participant on participant.id = vote.participant_id
    where vote.room_id = p_room_id and vote.proposal_id = active_id
      and participant.kind = 'human' and participant.required_for_approval = true
      and vote.choice = 'request_changes';
    if required_count = 0 or recorded_count <> required_count then
      return public.action_failure('VALIDATION_ERROR',
        'Every required human participant must vote before approval.', current_version);
    end if;
    if request_changes_count > 0 then
      return public.action_failure('VALIDATION_ERROR',
        'A required participant requested changes.', current_version,
        'Return to deliberation in a later workflow before seeking approval.');
    end if;
    if support_count <= required_count / 2 then
      return public.action_failure('VALIDATION_ERROR',
        'The active proposal did not receive a strict majority of required support votes.', current_version);
    end if;
    if exists (
      select 1 from public.conflicts
      where room_id = p_room_id and status = 'open' and severity = 'blocking'
    ) then
      return public.action_failure('UNRESOLVED_BLOCKING_CONFLICT',
        'A blocking conflict prevents approval.', current_version);
    end if;
    candidate_value := public.build_final_decision_candidate(p_room_id);
    candidate_hash := public.hash_decision_candidate(candidate_value);
    delete from public.approvals where room_id = p_room_id;
    update public.rooms
    set decision_candidate = candidate_value, decision_hash = candidate_hash
    where id = p_room_id;
  end if;

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

create or replace function public.prevent_finalized_entity_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_room_id text;
begin
  target_room_id := case when tg_op = 'DELETE' then old.room_id else new.room_id end;
  if exists (select 1 from public.rooms where id = target_room_id and phase = 'finalized') then
    raise exception 'ALREADY_FINALIZED: the finalized room is immutable';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger participants_prevent_finalized_mutation before insert or update or delete on public.participants
for each row execute function public.prevent_finalized_entity_mutation();
create trigger positions_prevent_finalized_mutation before insert or update or delete on public.positions
for each row execute function public.prevent_finalized_entity_mutation();
create trigger constraints_prevent_finalized_mutation before insert or update or delete on public.constraints
for each row execute function public.prevent_finalized_entity_mutation();
create trigger proposals_prevent_finalized_mutation before insert or update or delete on public.proposals
for each row execute function public.prevent_finalized_entity_mutation();
create trigger conflicts_prevent_finalized_mutation before insert or update or delete on public.conflicts
for each row execute function public.prevent_finalized_entity_mutation();
create trigger tradeoffs_prevent_finalized_mutation before insert or update or delete on public.tradeoffs
for each row execute function public.prevent_finalized_entity_mutation();
create trigger votes_prevent_finalized_mutation before insert or update or delete on public.votes
for each row execute function public.prevent_finalized_entity_mutation();
create trigger approvals_prevent_finalized_mutation before insert or update or delete on public.approvals
for each row execute function public.prevent_finalized_entity_mutation();

create or replace function public.prevent_finalized_room_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.phase = 'finalized' and new is distinct from old then
    raise exception 'ALREADY_FINALIZED: the finalized room is immutable';
  end if;
  return new;
end;
$$;

create trigger rooms_prevent_finalized_update before update on public.rooms
for each row execute function public.prevent_finalized_room_update();

revoke all on function public.action_success_data(text, bigint, jsonb) from public;
revoke all on function public.canonical_jsonb_text(jsonb) from public;
revoke all on function public.hash_decision_candidate(jsonb) from public;
revoke all on function public.build_final_decision_candidate(text) from public;
revoke all on function public.build_final_decision_preview(text, jsonb, text) from public;
revoke all on function public.prevent_finalized_entity_mutation() from public;
revoke all on function public.prevent_finalized_room_update() from public;
revoke all on function public.resolve_participant_objection(text, bigint, text, text, public.action_origin) from public;
revoke all on function public.cast_participant_vote(text, bigint, text, public.vote_choice, text, public.action_origin) from public;
revoke all on function public.get_final_decision_preview(text) from public;
revoke all on function public.approve_participant_final_decision(text, bigint, text, boolean, public.action_origin) from public;
revoke all on function public.get_persisted_decision_record(text) from public;

grant execute on function public.resolve_participant_objection(text, bigint, text, text, public.action_origin) to authenticated;
grant execute on function public.cast_participant_vote(text, bigint, text, public.vote_choice, text, public.action_origin) to authenticated;
grant execute on function public.get_final_decision_preview(text) to authenticated;
grant execute on function public.approve_participant_final_decision(text, bigint, text, boolean, public.action_origin) to authenticated;
grant execute on function public.get_persisted_decision_record(text) to authenticated;
