-- Slice 4 / Gate 4: replace Vote with Alignment, and replace the legacy
-- universal-vote/strict-majority/`required_for_approval` finalization engine
-- with policy-aware finalization.
--
-- Product rule: "Agents deliberate. Humans intervene. Leaders decide."
-- Alignment is informative, never mechanically decisive. `owner_decides`
-- requires only the current owner's explicit confirmation of the exact
-- decision hash; `equal_authority_consensus` requires every active human
-- decision-maker's explicit approval of that same hash. Neither policy reads
-- the deprecated, private `required_for_approval` column any more.
--
-- This migration does not touch the `room_phase` enum: `voting` remains the
-- internal Alignment phase and `approval` remains the internal Decision
-- phase, per the brief's explicit instruction not to perform a risky global
-- phase-enum migration for naming alone. User-facing labels live centrally
-- in `src/components/room/room-labels.ts`.

-- --------------------------------------------------------------------------
-- Schema: alignments
-- --------------------------------------------------------------------------

create type public.alignment_choice as enum (
  'support',
  'concern',
  'strong_objection',
  'needs_clarification'
);

-- One current alignment per participant per proposal: the primary key on
-- (proposal_id, participant_id) enforces this directly, matching the room's
-- other decision tables (`votes`, `approvals`).
create table public.alignments (
  room_id text not null references public.rooms(id) on delete cascade,
  proposal_id text not null references public.proposals(id) on delete cascade,
  participant_id text not null references public.participants(id) on delete cascade,
  choice public.alignment_choice not null,
  comment text,
  updated_at timestamptz not null default now(),
  primary key (proposal_id, participant_id)
);

create index alignments_room_id_idx on public.alignments(room_id);

alter table public.alignments enable row level security;
revoke all on table public.alignments from anon, authenticated;
grant select on table public.alignments to authenticated;

create policy alignments_readable_by_room_members
  on public.alignments for select to authenticated
  using (public.can_read_room(room_id));

create trigger alignments_prevent_finalized_mutation
before insert or update or delete on public.alignments
for each row execute function public.prevent_finalized_entity_mutation();

comment on table public.alignments is
  'Alignment replaces Vote as the canonical decision-informing signal. It is participant-scoped, upserted, and never mechanically decisive on its own -- see DecisionPolicy.';

-- --------------------------------------------------------------------------
-- Authenticated human alignment mutation
-- --------------------------------------------------------------------------

-- Only an active, human, room-member participant may express human
-- alignment. There is no browser-reachable path for a simulation or expert
-- to call this: the acting participant is derived from `auth.uid()` joined
-- to `kind = 'human'`, so a simulation (which has no `user_id`) can never
-- match, and there is no "expert" participant kind to match either.
create or replace function public.express_my_alignment(
  p_room_id text,
  p_expected_version bigint,
  p_proposal_id text,
  p_choice public.alignment_choice,
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
  alignment_existed boolean;
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
    return public.action_failure('WRONG_PHASE', 'Alignment can only be shared during the Alignment phase.', current_version);
  end if;
  if p_origin not in ('manual_ui', 'webmcp') then
    return public.action_failure('NOT_AUTHORIZED', 'This operation is limited to human participant sessions.', current_version);
  end if;
  select id into actor_participant_id from public.participants
  where room_id = p_room_id and user_id = (select auth.uid()) and kind = 'human' and status = 'active';
  if actor_participant_id is null then
    return public.action_failure('NOT_AUTHORIZED', 'Claim an active human participant seat before sharing alignment.', current_version);
  end if;
  if active_id is null or p_proposal_id <> active_id or not exists (
    select 1 from public.proposals
    where id = p_proposal_id and room_id = p_room_id and status = 'candidate'
  ) then
    return public.action_failure('VALIDATION_ERROR', 'Share alignment on the active candidate proposal only.', current_version);
  end if;

  select exists (
    select 1 from public.alignments
    where proposal_id = p_proposal_id and participant_id = actor_participant_id
  ) into alignment_existed;

  insert into public.alignments (room_id, proposal_id, participant_id, choice, comment, updated_at)
  values (p_room_id, p_proposal_id, actor_participant_id, p_choice, p_comment, now())
  on conflict (proposal_id, participant_id)
  do update set choice = excluded.choice, comment = excluded.comment, updated_at = excluded.updated_at;

  update public.rooms set version = current_version + 1 where id = p_room_id;
  insert into public.audit_events (
    room_id, actor_type, actor_id, origin, action, entity_type, entity_id,
    sanitized_input, result, previous_room_version, resulting_room_version,
    confirmation_required
  ) values (
    p_room_id, 'participant', actor_participant_id, p_origin,
    case when alignment_existed then 'alignment.updated' else 'alignment.expressed' end,
    'alignment', p_proposal_id,
    jsonb_build_object('proposalId', p_proposal_id, 'choice', p_choice, 'comment', p_comment),
    jsonb_build_object('ok', true), current_version, current_version + 1, false
  );
  return public.action_success(
    case when alignment_existed then 'Alignment updated.' else 'Alignment shared.' end,
    current_version + 1
  );
end;
$$;

-- --------------------------------------------------------------------------
-- Internal-only simulation alignment (never browser-reachable)
-- --------------------------------------------------------------------------

create or replace function public.demo_express_simulation_alignment(
  p_room_id text,
  p_participant_id text,
  p_proposal_id text,
  p_choice public.alignment_choice,
  p_comment text,
  p_reaction_key text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_version bigint;
begin
  select room.version into current_version
  from public.rooms room
  where room.id = p_room_id and room.id = 'demo'
    and room.demo_mode = 'solo_judge' and room.phase = 'voting'
    and room.active_proposal_id = p_proposal_id
  for update;
  if current_version is null then return false; end if;
  if not exists (
    select 1 from public.participants participant
    where participant.id = p_participant_id and participant.room_id = p_room_id
      and participant.kind = 'simulation'
  ) then return false; end if;
  if not public.demo_claim_reaction(p_room_id, p_reaction_key) then return false; end if;

  insert into public.alignments (room_id, proposal_id, participant_id, choice, comment)
  values (p_room_id, p_proposal_id, p_participant_id, p_choice, p_comment)
  on conflict (proposal_id, participant_id)
  do update set choice = excluded.choice, comment = excluded.comment, updated_at = now();
  update public.rooms set version = current_version + 1 where id = p_room_id;
  insert into public.audit_events (
    room_id, actor_type, actor_id, origin, action, entity_type, entity_id,
    sanitized_input, result, previous_room_version, resulting_room_version,
    confirmation_required
  ) values (
    p_room_id, 'participant', p_participant_id, 'simulation', 'alignment.expressed',
    'alignment', p_proposal_id,
    jsonb_build_object('proposalId', p_proposal_id, 'choice', p_choice, 'comment', p_comment),
    jsonb_build_object('ok', true), current_version, current_version + 1, false
  );
  return true;
end;
$$;

-- --------------------------------------------------------------------------
-- Policy-aware exact final decision candidate
-- --------------------------------------------------------------------------

-- Replaces the `votes` field with `alignments`, adds `decisionPolicy`, and
-- computes `requiredApprovalParticipantIds` from the room's current
-- DecisionPolicy instead of the deprecated `required_for_approval` column:
--   * owner_decides            -> [current active owner] only;
--   * equal_authority_consensus -> every active human decision-maker.
-- `dissent` is derived deterministically from concern/strong_objection
-- alignments and unresolved warnings -- never generated prose -- so the
-- candidate hash stays reproducible.
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

  -- Removed participants are excluded from the current candidate's
  -- alignment authority summary: their historical alignment row remains in
  -- the `alignments` table and audit trail, but it is not embedded here.
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

  -- `user_id is not null` excludes an unclaimed seat from required-approver
  -- authority: nobody is behind it who could ever approve, so counting it as
  -- required would make the decision permanently unfinalizable. Every normal
  -- production room's decision-makers are always claimed by construction
  -- (dynamic admission never creates an unclaimed human participant); this
  -- guard matters only for the legacy predetermined-seat demo fixture.
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
    'requiredApprovalParticipantIds', required_ids
  );
end;
$$;

-- Required-approver authority now lives inside the frozen candidate itself
-- (`requiredApprovalParticipantIds`, computed above), so the preview no
-- longer reads `required_for_approval` at all.
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

  select coalesce(jsonb_agg(required.value order by required.value), '[]'::jsonb)
  into missing_ids
  from jsonb_array_elements_text(candidate->'requiredApprovalParticipantIds') as required(value)
  where not exists (
    select 1 from public.approvals approval
    where approval.room_id = p_room_id
      and approval.participant_id = required.value
      and approval.decision_hash = candidate_hash
  );

  return candidate || jsonb_build_object(
    'decisionHash', candidate_hash,
    'approvals', approval_values,
    'missingApprovalParticipantIds', missing_ids
  );
end;
$$;

-- --------------------------------------------------------------------------
-- Entering the Alignment phase (internal: voting) and the Decision phase
-- (internal: approval) -- shared by production and demo phase advance.
--
-- The Decision-phase entry rules are now identical for both DecisionPolicy
-- values and no longer gate on Alignment completeness, majority support, or
-- the absence of a "request changes"-equivalent response: alignment is
-- informative, not decisive. Only a structural, policy-independent
-- precondition remains: an active proposal must exist, and no unresolved
-- blocking conflict may exist. Freezing the candidate always clears any
-- previously collected approvals, since a new candidate voids old approvals
-- by construction.
-- --------------------------------------------------------------------------

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
  candidate_value jsonb;
  candidate_hash text := null;
begin
  if p_next_phase = 'voting' then
    if p_active_proposal_id is null then
      return public.action_failure('VALIDATION_ERROR', 'An active proposal is required for the Alignment phase.', p_current_version);
    end if;
    if exists (
      select 1 from public.conflicts
      where room_id = p_room_id and status = 'open' and severity = 'blocking'
    ) then
      return public.action_failure('UNRESOLVED_BLOCKING_CONFLICT',
        'A blocking conflict prevents entering Alignment.', p_current_version,
        'Resolve every blocking issue before entering Alignment.');
    end if;
    delete from public.alignments where room_id = p_room_id;
    delete from public.approvals where room_id = p_room_id;
    update public.rooms
    set decision_candidate = null, decision_hash = null, final_record = null
    where id = p_room_id;
  elsif p_next_phase = 'approval' then
    if p_active_proposal_id is null then
      return public.action_failure('VALIDATION_ERROR', 'An active proposal is required before decision review.', p_current_version);
    end if;
    if exists (
      select 1 from public.conflicts
      where room_id = p_room_id and status = 'open' and severity = 'blocking'
    ) then
      return public.action_failure('UNRESOLVED_BLOCKING_CONFLICT',
        'A blocking conflict prevents entering decision review.', p_current_version,
        'Resolve every blocking issue before entering decision review.');
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

-- --------------------------------------------------------------------------
-- Policy-aware approval / finalization
-- --------------------------------------------------------------------------

-- Approval now means: explicit human approval of one exact decision hash by
-- a participant who is currently required under the room's DecisionPolicy
-- (embedded in the frozen candidate's `requiredApprovalParticipantIds`). It
-- does not mean "every participant must approve." The legacy
-- `required_for_approval` column is not read here at all.
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
  required_ids text[];
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
    return public.action_failure('WRONG_PHASE', 'Approval is available only during decision review.', current_version);
  end if;
  if p_origin not in ('manual_ui', 'webmcp') then
    return public.action_failure('NOT_AUTHORIZED', 'Only a human participant session may approve.', current_version);
  end if;
  select id into actor_participant_id from public.participants
  where room_id = p_room_id
    and user_id = (select auth.uid())
    and kind = 'human'
    and status = 'active';
  if actor_participant_id is null then
    return public.action_failure('NOT_AUTHORIZED', 'Claim an active human participant seat before approving.', current_version);
  end if;

  current_candidate := public.build_final_decision_candidate(p_room_id);
  current_hash := public.hash_decision_candidate(current_candidate);
  if p_decision_hash <> current_hash or stored_hash <> current_hash or stored_candidate <> current_candidate then
    return public.action_failure('DECISION_CHANGED', 'The final decision changed after it was reviewed.', current_version,
      'Review the updated final decision before approving again.');
  end if;

  select array(select jsonb_array_elements_text(current_candidate->'requiredApprovalParticipantIds'))
  into required_ids;
  if not (actor_participant_id = any(required_ids)) then
    return public.action_failure('NOT_AUTHORIZED',
      'This participant is not required to approve this decision under the current decision policy.', current_version);
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
  from unnest(required_ids) as required_id
  where not exists (
    select 1 from public.approvals approval
    where approval.room_id = p_room_id
      and approval.participant_id = required_id
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
      'alignments', current_candidate->'alignments',
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
  return public.action_success('Approval recorded; additional required approvals are outstanding.', current_version + 1);
end;
$$;

-- --------------------------------------------------------------------------
-- Decision policy mutation (owner-only)
-- --------------------------------------------------------------------------

-- Rejected once an exact decision candidate is frozen (`decision_hash is not
-- null`): a policy change would silently redefine who is required to
-- approve an already-reviewed candidate. Returning to Alignment first keeps
-- this a single, simple, testable invariant rather than trying to safely
-- recompute both a changed policy and a changed candidate at once.
create or replace function public.set_decision_policy(
  p_room_id text,
  p_decision_policy public.decision_policy,
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
    return public.action_failure('NOT_AUTHORIZED', 'Only the current room owner can change the decision policy.', room_row.version);
  end if;

  if room_row.decision_hash is not null then
    return public.action_failure('VALIDATION_ERROR',
      'The decision policy cannot change once an exact decision candidate is frozen.', room_row.version,
      'Return to Alignment before changing the decision policy.');
  end if;

  if room_row.decision_policy = p_decision_policy then
    return public.action_success('The decision policy is unchanged.', room_row.version);
  end if;

  next_version := room_row.version + 1;
  update public.rooms set decision_policy = p_decision_policy, version = next_version where id = p_room_id;
  insert into public.audit_events (
    room_id, actor_type, actor_id, origin, action, entity_type, entity_id,
    sanitized_input, result, previous_room_version, resulting_room_version, confirmation_required
  ) values (
    p_room_id, 'participant', owner_id, p_origin, 'decision_policy.changed',
    'room', p_room_id, jsonb_build_object('from', room_row.decision_policy, 'to', p_decision_policy),
    jsonb_build_object('ok', true), room_row.version, next_version, false
  );
  return public.action_success('Decision policy updated.', next_version);
end;
$$;

-- --------------------------------------------------------------------------
-- Decision-role management (owner-only)
-- --------------------------------------------------------------------------

-- Only `decision_maker` and `contributor` are assignable through this
-- action -- `advisor` is reserved for expert/simulation actors and is never
-- assignable to an ordinary human here. The current owner can never cease
-- being a decision-maker: `owner_decides` treats the owner as the sole
-- required approver, and `equal_authority_consensus` requires the owner to
-- remain a decision-maker so consensus always has at least one required
-- approver. Rejected once a candidate is frozen, for the same reason
-- `set_decision_policy` is.
create or replace function public.set_participant_decision_role(
  p_room_id text,
  p_participant_id text,
  p_decision_role public.decision_role,
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
begin
  if p_decision_role not in ('decision_maker', 'contributor') then
    return public.action_failure('VALIDATION_ERROR', 'Only decision_maker or contributor may be assigned this way.', 0);
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
    return public.action_failure('NOT_AUTHORIZED', 'Only the current room owner can change decision authority.', room_row.version);
  end if;

  if room_row.decision_hash is not null then
    return public.action_failure('VALIDATION_ERROR',
      'Decision authority cannot change once an exact decision candidate is frozen.', room_row.version,
      'Return to Alignment before changing decision authority.');
  end if;

  select * into target_row from public.participants where id = p_participant_id and room_id = p_room_id for update;
  if not found then
    return public.action_failure('VALIDATION_ERROR', 'That participant does not belong to this room.', room_row.version);
  end if;
  if target_row.status <> 'active' then
    return public.action_failure('VALIDATION_ERROR', 'Only an active participant can have their decision authority changed.', room_row.version);
  end if;
  if target_row.kind <> 'human' then
    return public.action_failure('VALIDATION_ERROR', 'Only human participants can be assigned decision authority through this action.', room_row.version);
  end if;
  if target_row.id = owner_id and p_decision_role <> 'decision_maker' then
    return public.action_failure('NOT_AUTHORIZED', 'The current owner cannot cease being a decision maker.', room_row.version);
  end if;

  if target_row.decision_role = p_decision_role then
    return public.action_success('Decision authority is unchanged.', room_row.version);
  end if;

  update public.participants set decision_role = p_decision_role where id = target_row.id;
  next_version := room_row.version + 1;
  update public.rooms set version = next_version where id = p_room_id;
  insert into public.audit_events (
    room_id, actor_type, actor_id, origin, action, entity_type, entity_id,
    sanitized_input, result, previous_room_version, resulting_room_version, confirmation_required
  ) values (
    p_room_id, 'participant', owner_id, p_origin, 'participant.decision_role_changed',
    'participant', target_row.id,
    jsonb_build_object('participantId', target_row.id, 'from', target_row.decision_role, 'to', p_decision_role),
    jsonb_build_object('ok', true), room_row.version, next_version, false
  );
  return public.action_success('Decision authority updated.', next_version);
end;
$$;

-- --------------------------------------------------------------------------
-- Ownership-transfer interaction with a frozen candidate
-- --------------------------------------------------------------------------

-- If a candidate is already frozen when ownership transfers, its authority
-- metadata may depend on who owns the room (directly, under owner_decides;
-- the required decision-maker set is unaffected under consensus, but is
-- recomputed anyway for a single, uniform, always-safe invariant). Recompute
-- and reissue the hash so a previous approval can never be mistaken for
-- approval of the new authority's decision: any collected approvals against
-- the stale hash are cleared in the same transaction.
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

  if room_row.decision_hash is not null then
    new_candidate := public.build_final_decision_candidate(p_room_id);
    if new_candidate is not null then
      new_hash := public.hash_decision_candidate(new_candidate);
      delete from public.approvals where room_id = p_room_id;
      update public.rooms set decision_candidate = new_candidate, decision_hash = new_hash where id = p_room_id;
    end if;
  end if;

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

-- --------------------------------------------------------------------------
-- Demo: phase entry now shares the same policy-neutral rules production
-- uses, instead of duplicating a majority-vote gate.
-- --------------------------------------------------------------------------

create or replace function public.demo_advance_solo_phase(
  p_room_id text,
  p_next_phase public.room_phase,
  p_reaction_key text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_version bigint;
  current_phase public.room_phase;
  active_id text;
  entry_result jsonb;
begin
  select room.version, room.phase, room.active_proposal_id
  into current_version, current_phase, active_id
  from public.rooms room
  where room.id = p_room_id and room.id = 'demo' and room.demo_mode = 'solo_judge'
  for update;
  if current_version is null then return false; end if;
  if (current_phase, p_next_phase) not in (
    ('input'::public.room_phase, 'proposals'::public.room_phase),
    ('proposals'::public.room_phase, 'deliberation'::public.room_phase),
    ('deliberation'::public.room_phase, 'voting'::public.room_phase),
    ('voting'::public.room_phase, 'approval'::public.room_phase)
  ) then return false; end if;

  if p_next_phase = 'proposals' and not exists (
    select 1 from public.positions position
    join public.participants participant on participant.id = position.participant_id
    where position.room_id = p_room_id and participant.kind = 'human'
      and participant.required_for_approval = true
  ) then return false; end if;
  if p_next_phase = 'deliberation' and (
    active_id is null or not exists (
      select 1 from public.proposals proposal
      join public.participants participant on participant.id = proposal.participant_id
      where proposal.id = active_id and proposal.room_id = p_room_id
        and participant.kind = 'human'
    )
  ) then return false; end if;

  if p_next_phase in ('voting', 'approval') then
    entry_result := public.apply_room_phase_entry(p_room_id, p_next_phase, current_version, active_id);
    if not coalesce((entry_result->>'ok')::boolean, false) then return false; end if;
  end if;

  if not public.demo_claim_reaction(p_room_id, p_reaction_key) then return false; end if;

  update public.rooms
  set phase = p_next_phase, version = current_version + 1
  where id = p_room_id;
  insert into public.audit_events (
    room_id, actor_type, actor_id, origin, action, entity_type, entity_id,
    sanitized_input, result, previous_room_version, resulting_room_version,
    confirmation_required
  ) values (
    p_room_id, 'system', null, 'simulation', 'demo.phase_advanced',
    'room', p_room_id, jsonb_build_object('phase', p_next_phase),
    jsonb_build_object('ok', true, 'decisionHash', entry_result->>'decisionHash'),
    current_version, current_version + 1, false
  );
  return true;
end;
$$;

-- Same deterministic scenario, alignment-flavoured: simulated participants
-- express alignment instead of casting a vote once entering the Alignment
-- phase; entering decision review requires only an active proposal and no
-- unresolved blocking conflict, shared with production via
-- `apply_room_phase_entry`.
create or replace function public.run_solo_demo_orchestration(p_room_id text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_version bigint;
  current_phase public.room_phase;
  current_mode public.demo_mode;
  active_id text;
  active_parent_id text;
  actor_id text;
  actor_role text;
  constraint_id text;
  conflict_id text;
  pending_reaction_key text;
  acted boolean;
  iteration integer;
begin
  if (select auth.uid()) is null and (select auth.role()) <> 'service_role' then
    return public.action_failure('NOT_AUTHORIZED', 'An authenticated session is required.', 0);
  end if;
  if p_room_id <> 'demo' then
    return public.action_failure('NOT_AUTHORIZED', 'Only the demo room may run scenario orchestration.', 0);
  end if;
  perform pg_advisory_xact_lock(hashtextextended('solo-demo:' || p_room_id, 0));

  for iteration in 1..32 loop
    select room.version, room.phase, room.demo_mode, room.active_proposal_id
    into current_version, current_phase, current_mode, active_id
    from public.rooms room where room.id = p_room_id for update;
    if current_version is null then
      return public.action_failure('VALIDATION_ERROR', 'Demo room not found.', 0);
    end if;
    if current_mode <> 'solo_judge' or current_phase in ('approval', 'finalized') then
      return public.action_success('Demo scenario is stable.', current_version);
    end if;
    acted := false;

    if current_phase = 'input' then
      select participant.id, participant.role,
        case participant.role
          when 'Product Manager' then 'Improve onboarding completion and time to first value.'
          when 'Engineer' then 'Ship within two-week capacity without rewriting authentication.'
          when 'Designer' then 'Preserve accessibility and interaction consistency.'
          else 'Do not move the campaign launch date.'
        end
      into actor_id, actor_role, pending_reaction_key
      from public.participants participant
      where participant.room_id = p_room_id and participant.kind = 'simulation'
        and not exists (
          select 1 from public.positions position
          where position.room_id = p_room_id and position.participant_id = participant.id
        )
      order by participant.id limit 1;
      if actor_id is not null then
        acted := public.demo_add_simulation_position(
          p_room_id, actor_id, pending_reaction_key, 'scenario', 'high',
          'position:' || actor_id
        );
      else
        acted := public.demo_advance_solo_phase(
          p_room_id, 'proposals', 'phase:input:proposals'
        );
      end if;

    elsif current_phase = 'proposals' then
      if active_id is not null then
        acted := public.demo_advance_solo_phase(
          p_room_id, 'deliberation', 'phase:proposals:deliberation:' || active_id
        );
      end if;

    elsif current_phase = 'deliberation' then
      select proposal.parent_proposal_id into active_parent_id
      from public.proposals proposal
      where proposal.id = active_id and proposal.room_id = p_room_id;

      if active_parent_id is null then
        if public.demo_is_ambitious_proposal(active_id) then
          select participant.id into actor_id
          from public.participants participant
          where participant.room_id = p_room_id and participant.role = 'Engineer'
            and participant.kind = 'simulation';
          pending_reaction_key := 'engineer_capacity_objection:' || active_id;
          if actor_id is not null and not exists (
            select 1 from public.demo_reactions reaction
            where reaction.room_id = p_room_id and reaction.reaction_key = pending_reaction_key
          ) then
            select constraint_value.id into constraint_id
            from public.constraints constraint_value
            where constraint_value.room_id = p_room_id
              and constraint_value.participant_id = actor_id
              and constraint_value.id = 'constraint-engineering-capacity';
            acted := public.demo_raise_simulation_objection(
              p_room_id, actor_id, active_id, constraint_id,
              'Estimated scope exceeds available engineering capacity for the two-week release window.',
              'blocking', pending_reaction_key
            );
          end if;
        end if;
        if not acted and public.demo_needs_accessibility_objection(active_id) then
          select participant.id into actor_id
          from public.participants participant
          where participant.room_id = p_room_id and participant.role = 'Designer'
            and participant.kind = 'simulation';
          pending_reaction_key := 'designer_accessibility_objection:' || active_id;
          if actor_id is not null and not exists (
            select 1 from public.demo_reactions reaction
            where reaction.room_id = p_room_id and reaction.reaction_key = pending_reaction_key
          ) then
            select constraint_value.id into constraint_id
            from public.constraints constraint_value
            where constraint_value.room_id = p_room_id
              and constraint_value.participant_id = actor_id
              and constraint_value.id = 'constraint-design-accessibility';
            acted := public.demo_raise_simulation_objection(
              p_room_id, actor_id, active_id, constraint_id,
              'The proposed custom flow introduces accessibility review scope that cannot be safely skipped.',
              'blocking', pending_reaction_key
            );
          end if;
        end if;
        if not acted and public.demo_threatens_deadline(active_id) then
          select participant.id into actor_id
          from public.participants participant
          where participant.room_id = p_room_id and participant.role = 'Marketing Lead'
            and participant.kind = 'simulation';
          pending_reaction_key := 'marketing_deadline_objection:' || active_id;
          if actor_id is not null and not exists (
            select 1 from public.demo_reactions reaction
            where reaction.room_id = p_room_id and reaction.reaction_key = pending_reaction_key
          ) then
            select constraint_value.id into constraint_id
            from public.constraints constraint_value
            where constraint_value.room_id = p_room_id
              and constraint_value.participant_id = actor_id
              and constraint_value.id = 'constraint-marketing-date';
            acted := public.demo_raise_simulation_objection(
              p_room_id, actor_id, active_id, constraint_id,
              'The proposal threatens the fixed campaign launch date.',
              'warning', pending_reaction_key
            );
          end if;
        end if;
      elsif public.demo_revision_is_acceptable(active_id) then
        with recursive lineage as (
          select proposal.id, proposal.parent_proposal_id
          from public.proposals proposal where proposal.id = active_id
          union all
          select parent.id, parent.parent_proposal_id
          from public.proposals parent join lineage child on parent.id = child.parent_proposal_id
        )
        select conflict_value.id, conflict_value.raised_by_actor_id
        into conflict_id, actor_id
        from public.conflicts conflict_value
        join public.participants participant on participant.id = conflict_value.raised_by_actor_id
        where conflict_value.room_id = p_room_id and conflict_value.status = 'open'
          and conflict_value.proposal_id in (select id from lineage)
          and conflict_value.raised_by_actor_type = 'participant'
          and participant.kind = 'simulation'
        order by conflict_value.created_at, conflict_value.id limit 1;
        if conflict_id is not null then
          acted := public.demo_resolve_simulation_objection(
            p_room_id, actor_id, conflict_id,
            'The scoped revision preserves existing authentication, the launch date, and explicit accessibility validation.',
            'resolve:' || conflict_id || ':' || active_id
          );
        end if;
      end if;
      if not acted then
        acted := public.demo_advance_solo_phase(
          p_room_id, 'voting', 'phase:deliberation:voting:' || active_id
        );
      end if;

    elsif current_phase = 'voting' then
      select participant.id, participant.role into actor_id, actor_role
      from public.participants participant
      where participant.room_id = p_room_id and participant.kind = 'simulation'
        and not exists (
          select 1 from public.alignments alignment
          where alignment.room_id = p_room_id and alignment.proposal_id = active_id
            and alignment.participant_id = participant.id
        )
      order by participant.id limit 1;
      if actor_id is not null then
        acted := public.demo_express_simulation_alignment(
          p_room_id, actor_id, active_id, 'support',
          actor_role || ' simulation is aligned with the scoped two-week compromise.',
          'alignment:' || actor_id || ':' || active_id
        );
      elsif exists (
        select 1 from public.participants participant
        where participant.room_id = p_room_id and participant.kind = 'human' and participant.status = 'active'
          and not exists (
            select 1 from public.alignments alignment
            where alignment.room_id = p_room_id and alignment.proposal_id = active_id
              and alignment.participant_id = participant.id
          )
      ) then
        -- The deterministic scenario never decides for the judge: it waits
        -- for the human's own alignment before entering decision review, even
        -- though `apply_room_phase_entry` itself no longer requires this for
        -- a real, owner-driven room.
        null;
      else
        acted := public.demo_advance_solo_phase(
          p_room_id, 'approval', 'phase:voting:approval:' || active_id
        );
      end if;
    end if;

    if not acted then exit; end if;
    actor_id := null;
    actor_role := null;
    constraint_id := null;
    conflict_id := null;
    pending_reaction_key := null;
  end loop;

  select room.version into current_version from public.rooms room where room.id = p_room_id;
  return public.action_success('Demo scenario settled deterministically.', current_version);
end;
$$;

-- --------------------------------------------------------------------------
-- Grants
-- --------------------------------------------------------------------------

revoke all on function public.express_my_alignment(text, bigint, text, public.alignment_choice, text, public.action_origin) from public;
revoke all on function public.demo_express_simulation_alignment(text, text, text, public.alignment_choice, text, text) from public;
revoke all on function public.build_final_decision_candidate(text) from public;
revoke all on function public.build_final_decision_preview(text, jsonb, text) from public;
revoke all on function public.apply_room_phase_entry(text, public.room_phase, bigint, text) from public;
revoke all on function public.approve_participant_final_decision(text, bigint, text, boolean, public.action_origin) from public;
revoke all on function public.set_decision_policy(text, public.decision_policy, bigint, public.action_origin) from public;
revoke all on function public.set_participant_decision_role(text, text, public.decision_role, bigint, public.action_origin) from public;
revoke all on function public.transfer_ownership(text, text, bigint, public.action_origin) from public;
revoke all on function public.demo_advance_solo_phase(text, public.room_phase, text) from public;
revoke all on function public.run_solo_demo_orchestration(text) from public;

revoke all on function public.demo_express_simulation_alignment(text, text, text, public.alignment_choice, text, text) from anon, authenticated;
revoke all on function public.demo_advance_solo_phase(text, public.room_phase, text) from anon, authenticated;

grant execute on function public.express_my_alignment(text, bigint, text, public.alignment_choice, text, public.action_origin) to authenticated;
grant execute on function public.approve_participant_final_decision(text, bigint, text, boolean, public.action_origin) to authenticated;
grant execute on function public.set_decision_policy(text, public.decision_policy, bigint, public.action_origin) to authenticated;
grant execute on function public.set_participant_decision_role(text, text, public.decision_role, bigint, public.action_origin) to authenticated;
grant execute on function public.transfer_ownership(text, text, bigint, public.action_origin) to authenticated;
grant execute on function public.run_solo_demo_orchestration(text) to authenticated, service_role;

-- --------------------------------------------------------------------------
-- Legacy voting/approval engine: retained in the database for
-- migration/history only. Normal authenticated production access no longer
-- depends on it; the canonical contract no longer exposes `Vote` at all.
-- --------------------------------------------------------------------------

revoke execute on function public.cast_participant_vote(text, bigint, text, public.vote_choice, text, public.action_origin) from authenticated;

comment on table public.votes is
  'DEPRECATED legacy compatibility table from the pre-Alignment voting/approval engine. Superseded by public.alignments. Retained for migration/history only; no authenticated production path writes to it any more.';
comment on column public.participants.required_for_approval is
  'DEPRECATED legacy compatibility column. Superseded by policy-aware requiredApprovalParticipantIds computed in build_final_decision_candidate(). Never read by normal finalization.';
