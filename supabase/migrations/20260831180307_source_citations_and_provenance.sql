-- Meeting source files, slices 4 & 6:
--   * participant inputs (positions, constraints, proposals) can cite the
--     meeting sources that informed them (`referenced_source_ids`),
--   * a citation is rejected unless it points at a source the caller may read,
--   * the frozen decision candidate carries deterministic `sourceProvenance`
--     (shared, non-removed sources only) plus the proposal's citations, so a
--     source summary can never silently redefine an existing decision hash.

alter table public.positions
  add column if not exists referenced_source_ids text[] not null default '{}';
alter table public.constraints
  add column if not exists referenced_source_ids text[] not null default '{}';
alter table public.proposals
  add column if not exists referenced_source_ids text[] not null default '{}';

-- ---------------------------------------------------------------------------
-- Shared guard: every id must resolve to a source in this room that the
-- calling participant is allowed to read (so a private source another
-- participant uploaded can never be cited).
-- ---------------------------------------------------------------------------
create or replace function public.meeting_source_citations_valid(
  p_room_id text,
  p_source_ids text[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(bool_and(
    exists (
      select 1 from public.meeting_sources source
      where source.id = candidate.id
        and source.room_id = p_room_id
        and source.status <> 'removed'
        and public.can_read_meeting_source(source.id)
    )
  ), true)
  from unnest(coalesce(p_source_ids, '{}')) as candidate(id);
$$;

revoke all on function public.meeting_source_citations_valid(text, text[]) from public, anon, authenticated;
grant execute on function public.meeting_source_citations_valid(text, text[]) to authenticated;

-- ---------------------------------------------------------------------------
-- add_participant_position: + p_referenced_source_ids, + per-constraint
-- referencedSourceIds carried in p_constraints jsonb.
-- ---------------------------------------------------------------------------
drop function if exists public.add_participant_position(text, bigint, text, text, text, jsonb, public.action_origin);

create or replace function public.add_participant_position(
  p_room_id text,
  p_expected_version bigint,
  p_summary text,
  p_category text,
  p_priority text,
  p_constraints jsonb,
  p_referenced_source_ids text[],
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
  constraint_sources text[];
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

  if not public.meeting_source_citations_valid(p_room_id, p_referenced_source_ids) then
    return public.action_failure('VALIDATION_ERROR', 'A cited meeting source is not available in this room.', current_version);
  end if;

  insert into public.positions (id, room_id, participant_id, summary, category, priority, referenced_source_ids)
  values (new_position_id, p_room_id, actor_participant_id, p_summary, p_category, p_priority,
    coalesce(p_referenced_source_ids, '{}'));

  for constraint_value in select value from jsonb_array_elements(coalesce(p_constraints, '[]'::jsonb))
  loop
    constraint_sources := coalesce(
      array(select jsonb_array_elements_text(constraint_value->'referencedSourceIds')),
      '{}'
    );
    if not public.meeting_source_citations_valid(p_room_id, constraint_sources) then
      return public.action_failure('VALIDATION_ERROR', 'A cited meeting source is not available in this room.', current_version);
    end if;
    insert into public.constraints (room_id, participant_id, category, text, priority, referenced_source_ids)
    values (
      p_room_id,
      actor_participant_id,
      constraint_value->>'category',
      constraint_value->>'text',
      constraint_value->>'priority',
      constraint_sources
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
      'constraints', coalesce(p_constraints, '[]'::jsonb),
      'referencedSourceIds', to_jsonb(coalesce(p_referenced_source_ids, '{}'))),
    jsonb_build_object('ok', true), current_version, current_version + 1, false
  );
  return public.action_success('Position and constraints added.', current_version + 1);
end;
$$;

-- ---------------------------------------------------------------------------
-- submit_participant_proposal: + p_referenced_source_ids
-- ---------------------------------------------------------------------------
drop function if exists public.submit_participant_proposal(text, bigint, text, text, text, text[], text[], text, public.action_origin);

create or replace function public.submit_participant_proposal(
  p_room_id text,
  p_expected_version bigint,
  p_title text,
  p_summary text,
  p_rationale text,
  p_expected_outcomes text[],
  p_referenced_constraint_ids text[],
  p_referenced_source_ids text[],
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
  if not public.meeting_source_citations_valid(p_room_id, p_referenced_source_ids) then
    return public.action_failure('VALIDATION_ERROR', 'A cited meeting source is not available in this room.', current_version);
  end if;

  insert into public.proposals (
    id, room_id, participant_id, title, summary, rationale, expected_outcomes,
    referenced_constraint_ids, referenced_source_ids, parent_proposal_id, status
  ) values (
    new_proposal_id, p_room_id, actor_participant_id, p_title, p_summary,
    p_rationale, p_expected_outcomes, p_referenced_constraint_ids,
    coalesce(p_referenced_source_ids, '{}'), p_parent_proposal_id, 'candidate'
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
      'referencedSourceIds', to_jsonb(coalesce(p_referenced_source_ids, '{}')),
      'parentProposalId', p_parent_proposal_id),
    jsonb_build_object('ok', true), current_version, current_version + 1, false
  );
  return public.action_success('Proposal submitted.', current_version + 1);
end;
$$;

revoke all on function public.add_participant_position(text, bigint, text, text, text, jsonb, text[], public.action_origin) from public, anon, authenticated;
revoke all on function public.submit_participant_proposal(text, bigint, text, text, text, text[], text[], text[], text, public.action_origin) from public, anon, authenticated;
grant execute on function public.add_participant_position(text, bigint, text, text, text, jsonb, text[], public.action_origin) to authenticated;
grant execute on function public.submit_participant_proposal(text, bigint, text, text, text, text[], text[], text[], text, public.action_origin) to authenticated;

-- ---------------------------------------------------------------------------
-- build_final_decision_candidate: add proposal.referencedSourceIds and the
-- top-level sourceProvenance array. Deterministic ordering (by source id /
-- value) mirrors the TypeScript normalizer so the SQL and JS hashes agree.
-- ---------------------------------------------------------------------------
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
  alignment_values jsonb;
  dissent_alignment_values jsonb;
  dissent_warning_values jsonb;
  dissent_values jsonb;
  required_ids jsonb;
  expert_advice_values jsonb;
  source_provenance_values jsonb;
  current_policy public.decision_policy;
  current_owner_id text;
begin
  select active_proposal_id, decision_policy, owner_participant_id
  into active_id, current_policy, current_owner_id
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
    'referencedSourceIds', (
      select coalesce(jsonb_agg(value order by value), '[]'::jsonb)
      from unnest(p.referenced_source_ids) as referenced_source(value)
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
    'proposalId', alignment.proposal_id,
    'participantId', alignment.participant_id,
    'choice', alignment.choice,
    'comment', alignment.comment,
    'updatedAt', alignment.updated_at
  ) order by alignment.participant_id), '[]'::jsonb)
  into alignment_values
  from public.alignments alignment
  join public.participants participant on participant.id = alignment.participant_id
  where alignment.room_id = p_room_id and alignment.proposal_id = active_id
    and participant.status = 'active';

  select coalesce(jsonb_agg(
    participant.name || ' (' || participant.role || '): ' ||
    case alignment.choice
      when 'strong_objection' then 'Strong objection'
      when 'concern' then 'Concern'
      else alignment.choice::text
    end ||
    case when alignment.comment is null then '' else ' — ' || alignment.comment end
    order by participant.id
  ), '[]'::jsonb)
  into dissent_alignment_values
  from public.alignments alignment
  join public.participants participant on participant.id = alignment.participant_id
  where alignment.room_id = p_room_id and alignment.proposal_id = active_id
    and participant.status = 'active'
    and alignment.choice in ('concern', 'strong_objection');

  select coalesce(jsonb_agg('Unresolved warning: ' || (elems.value->>'reason') order by elems.ord), '[]'::jsonb)
  into dissent_warning_values
  from jsonb_array_elements(warning_values) with ordinality as elems(value, ord);

  dissent_values := coalesce(dissent_alignment_values, '[]'::jsonb) || coalesce(dissent_warning_values, '[]'::jsonb);

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
    'expertKey', finding.expert_key,
    'findingId', finding.id,
    'proposalId', finding.proposal_id,
    'category', finding.category,
    'title', finding.title,
    'status', finding.status,
    'resolutionRationale', finding.resolution_rationale
  ) order by finding.id), '[]'::jsonb)
  into expert_advice_values
  from public.expert_findings finding
  where finding.room_id = p_room_id and finding.proposal_id in (select id from lineage);

  select coalesce(jsonb_agg(jsonb_build_object(
    'sourceId', source.id,
    'uploadedByParticipantId', source.uploaded_by_participant_id,
    'visibility', source.visibility,
    'sha256', source.sha256,
    'status', source.status
  ) order by source.id), '[]'::jsonb)
  into source_provenance_values
  from public.meeting_sources source
  where source.room_id = p_room_id
    and source.visibility = 'shared_room'
    and source.status <> 'removed';

  if current_policy = 'owner_decides' then
    select coalesce(jsonb_agg(to_jsonb(id)), '[]'::jsonb)
    into required_ids
    from public.participants
    where id = current_owner_id and room_id = p_room_id and status = 'active'
      and user_id is not null;
  else
    select coalesce(jsonb_agg(to_jsonb(id) order by id), '[]'::jsonb)
    into required_ids
    from public.participants
    where room_id = p_room_id and kind = 'human' and status = 'active'
      and decision_role = 'decision_maker' and user_id is not null;
  end if;

  return jsonb_build_object(
    'proposal', proposal_value,
    'rationale', proposal_value->>'rationale',
    'acceptedTradeoffs', tradeoff_values,
    'unresolvedWarnings', warning_values,
    'alignments', alignment_values,
    'decisionPolicy', current_policy,
    'owners', '[]'::jsonb,
    'deadlines', '[]'::jsonb,
    'actionItems', '[]'::jsonb,
    'dissent', dissent_values,
    'sourceProvenance', source_provenance_values,
    'requiredApprovalParticipantIds', required_ids,
    'expertAdvice', expert_advice_values
  );
end;
$$;

revoke all on function public.build_final_decision_candidate(text) from public;
