-- Slice 6 / Gate 6: Security Expert advisory actor + deterministic
-- solo-judge `/room/demo` rebuild.
--
-- Product rule: "Agents deliberate. Humans intervene. Leaders decide."
-- The Security Expert is a distinct, non-human, advisory-only actor kind. It
-- can never join as a human, become owner, align as a decision-maker,
-- approve, or finalize -- every existing authority-deriving function in this
-- database already requires `kind = 'human'` (positive match), so `expert`
-- is excluded from all of them by construction. The one place that needed an
-- explicit fix is `derive_owner_participant_authority()` below, which
-- previously fell through an unhandled `kind = 'expert'` row to the legacy
-- `required_for_approval` branch and would have mis-classified it as a
-- decision-maker.

-- --------------------------------------------------------------------------
-- 1. participant_kind: add 'expert'
--
-- Postgres does not allow a value added by ALTER TYPE ... ADD VALUE to be
-- used in the same transaction that added it, so this migration swaps in a
-- fresh enum type (with all three values) rather than altering the existing
-- one in place. `participant_kind` is referenced only as a column type and
-- as untyped local plpgsql variables (never as a function return type or a
-- view column), so the swap has no other dependents to update.
-- --------------------------------------------------------------------------

create type public.participant_kind_v2 as enum ('human', 'simulation', 'expert');

alter table public.participants alter column kind drop default;
alter table public.participants
  alter column kind type public.participant_kind_v2
  using kind::text::public.participant_kind_v2;
alter table public.participants
  alter column kind set default 'human'::public.participant_kind_v2;

drop type public.participant_kind;
alter type public.participant_kind_v2 rename to participant_kind;

comment on column public.participants.kind is
  'human: an admitted, authenticated person. simulation: a deterministic demo teammate. expert: a server-side advisory actor (e.g. Security) that can never gain human decision authority.';

-- Fix the one authority-deriving trigger that previously had no branch for
-- `kind = 'expert'` and would have fallen through to the legacy
-- required_for_approval-based decision-maker default.
create or replace function public.derive_owner_participant_authority()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.rooms room
    where room.id = new.room_id and room.owner_participant_id = new.id
  ) then
    new.meeting_role := 'owner';
    new.decision_role := 'decision_maker';
  elsif new.kind = 'simulation' then
    new.decision_role := 'advisor';
  elsif new.kind = 'expert' then
    new.decision_role := 'advisor';
  elsif new.required_for_approval then
    -- TODO(Slice 3+): remove this legacy compatibility derivation when the
    -- approval engine is replaced by policy-aware alignment/finalization.
    new.decision_role := 'decision_maker';
  end if;
  return new;
end;
$$;

-- --------------------------------------------------------------------------
-- 2. Expert findings: canonical, persisted advisory data.
--
-- ExpertFinding != a human Conflict and never mechanically gates a phase
-- transition or finalization -- see docs/backend-integration.md's Slice 6
-- section. Idempotency is a database-enforced fingerprint
-- (`unique (room_id, fingerprint)`), not merely an application-level check,
-- so reviewing the same immutable proposal twice can never create duplicate
-- findings even under concurrent calls.
-- --------------------------------------------------------------------------

create type public.expert_finding_status as enum (
  'open',
  'resolved',
  'accepted_risk',
  'rejected'
);

create table public.expert_findings (
  id text primary key,
  room_id text not null references public.rooms(id) on delete cascade,
  expert_participant_id text not null references public.participants(id) on delete cascade,
  expert_key text not null default 'security' check (expert_key = 'security'),
  proposal_id text not null references public.proposals(id) on delete cascade,
  category text not null check (length(trim(category)) > 0),
  title text not null check (length(trim(title)) > 0),
  summary text not null check (length(trim(summary)) > 0),
  recommendation text not null check (length(trim(recommendation)) > 0),
  status public.expert_finding_status not null default 'open',
  resolution_rationale text,
  fingerprint text not null check (length(trim(fingerprint)) > 0),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (room_id, fingerprint)
);

create index expert_findings_room_id_idx on public.expert_findings(room_id);
create index expert_findings_proposal_id_idx on public.expert_findings(proposal_id);

alter table public.expert_findings enable row level security;
revoke all on table public.expert_findings from anon, authenticated;
grant select on table public.expert_findings to authenticated;

-- Room-readable for active participants, exactly like every other
-- room-scoped table. Never client-writable: the only inserts/updates come
-- from the SECURITY DEFINER functions below.
create policy expert_findings_readable_by_room_members
  on public.expert_findings for select to authenticated
  using (public.can_read_room(room_id));

create trigger expert_findings_prevent_finalized_mutation
before insert or update or delete on public.expert_findings
for each row execute function public.prevent_finalized_entity_mutation();

comment on table public.expert_findings is
  'Advisory findings from a server-side expert service (e.g. Security). Never a human Conflict, never a vote, and never mechanically decisive -- see record_expert_advice_outcome for the only owner-controlled disposition path.';

-- --------------------------------------------------------------------------
-- 3. Deterministic, local security/privacy rule set.
--
-- Intentionally small and explicitly scoped -- this is not a comprehensive
-- security audit. Proposal text (title/summary/rationale/expectedOutcomes)
-- is participant-authored, untrusted DATA: it is only ever matched against
-- fixed regular expressions here, never interpreted as instructions, and
-- nothing in this function can branch on anything other than the fixed
-- category list below.
-- --------------------------------------------------------------------------

create or replace function public.security_expert_classify(p_proposal_id text)
returns table(category text, title text, summary text, recommendation text)
language sql
stable
security definer
set search_path = ''
as $$
  with proposal_text as (
    select public.demo_proposal_text(p_proposal_id) as normalized
  )
  select
    'behavioral_tracking',
    'Behavioral tracking / profiling risk',
    'The proposal describes collecting behavioral event data and/or building a persistent per-user profile.',
    'Collect only minimal, aggregate, already-approved metrics. Avoid a persistent per-user behavioral profile.'
  from proposal_text
  where normalized ~ '(behavioral|event tracking|persistent.*profile|profiling|user profile|\btrack\w*)'
  union all
  select
    'auth_boundary_expansion',
    'Authentication / profile boundary expansion',
    'The proposal references new fields or scope linked to the authentication or user-profile boundary.',
    'Reuse the existing authentication and session model. Avoid new auth-linked profile fields.'
  from proposal_text
  where normalized ~ '(new auth|auth.*linked|new profile field|profile field|expand.*auth|auth.*expan)'
  union all
  select
    'data_retention',
    'Data retention / storage scope',
    'The proposal implies broad analytics instrumentation and/or new sensitive data storage without a stated retention limit.',
    'Define a minimal retention window and store no more than required for the stated outcome.'
  from proposal_text
  where normalized ~ '(analytics instrumentation|broad analytics|sensitive.*stor|data retention|\bretention\b)';
$$;

revoke all on function public.security_expert_classify(text) from public, anon, authenticated;

-- --------------------------------------------------------------------------
-- 4. Enable the Security Expert (owner-only, idempotent).
-- --------------------------------------------------------------------------

create or replace function public.enable_security_expert(
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
  room_row public.rooms;
  owner_id text;
  next_version bigint;
  expert_id text := 'expert-security-' || p_room_id;
  existing_expert_id text;
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
    return public.action_failure('NOT_AUTHORIZED', 'Only the current room owner can enable the Security Expert.', room_row.version);
  end if;

  select id into existing_expert_id from public.participants
    where room_id = p_room_id and kind = 'expert' limit 1;
  if existing_expert_id is not null then
    return public.action_success_data(
      'The Security Expert is already enabled.', room_row.version,
      jsonb_build_object('expertParticipantId', existing_expert_id)
    );
  end if;

  insert into public.participants (
    id, room_id, name, role, kind, meeting_role, decision_role, status, required_for_approval, created_at
  ) values (
    expert_id, p_room_id, 'Security Expert', 'Security Expert · Advisory', 'expert', 'participant', 'advisor',
    'active', false, now()
  );

  next_version := room_row.version + 1;
  update public.rooms set version = next_version where id = p_room_id;
  insert into public.audit_events (
    room_id, actor_type, actor_id, origin, action, entity_type, entity_id,
    sanitized_input, result, previous_room_version, resulting_room_version, confirmation_required
  ) values (
    p_room_id, 'participant', owner_id, p_origin, 'expert.enabled',
    'participant', expert_id, jsonb_build_object('expertKey', 'security'),
    jsonb_build_object('ok', true), room_row.version, next_version, false
  );
  return public.action_success_data('Security Expert enabled.', next_version, jsonb_build_object('expertParticipantId', expert_id));
end;
$$;

revoke all on function public.enable_security_expert(text, bigint, public.action_origin) from public, anon, authenticated;
grant execute on function public.enable_security_expert(text, bigint, public.action_origin) to authenticated;

-- --------------------------------------------------------------------------
-- 5. Review internals: idempotent classification + insertion + deterministic
-- auto-resolution when a revision no longer matches a category. Shared by
-- the public `run_security_expert_review` wrapper and the demo orchestrator
-- so the demo's Security Expert step is the same real logic, not a parallel
-- copy.
-- --------------------------------------------------------------------------

create or replace function public.run_security_expert_review_internal(
  p_room_id text,
  p_expert_id text,
  p_proposal_id text,
  p_origin public.action_origin
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_version bigint;
  category_row record;
  finding_row record;
  finding_id text;
  fp text;
  inserted_ids jsonb := '[]'::jsonb;
  did_insert boolean;
  resolution_text text := 'The revised proposal no longer matches this risk pattern.';
begin
  select version into current_version from public.rooms where id = p_room_id for update;
  if current_version is null then return inserted_ids; end if;

  for category_row in select * from public.security_expert_classify(p_proposal_id) loop
    fp := p_proposal_id || ':' || category_row.category;
    finding_id := 'finding-' || md5(p_room_id || ':' || fp);
    did_insert := false;
    begin
      insert into public.expert_findings (
        id, room_id, expert_participant_id, expert_key, proposal_id, category, title, summary,
        recommendation, status, fingerprint
      ) values (
        finding_id, p_room_id, p_expert_id, 'security', p_proposal_id, category_row.category,
        category_row.title, category_row.summary, category_row.recommendation, 'open', fp
      );
      did_insert := true;
    exception when unique_violation then
      did_insert := false;
    end;
    if did_insert then
      inserted_ids := inserted_ids || to_jsonb(finding_id);
      current_version := current_version + 1;
      update public.rooms set version = current_version where id = p_room_id;
      insert into public.audit_events (
        room_id, actor_type, actor_id, origin, action, entity_type, entity_id,
        sanitized_input, result, previous_room_version, resulting_room_version, confirmation_required
      ) values (
        p_room_id, 'expert', p_expert_id, 'expert_service', 'expert_finding.raised',
        'expert_finding', finding_id,
        jsonb_build_object('category', category_row.category, 'proposalId', p_proposal_id),
        jsonb_build_object('ok', true), current_version - 1, current_version, false
      );
    end if;
  end loop;

  -- Deterministic auto-resolution: if an ancestor proposal in this
  -- proposal's lineage has an OPEN finding for a category the *current*
  -- active proposal's text no longer matches, resolve it. This is the
  -- narrow, auditable exception the product spec allows for revisions that
  -- clearly eliminate a previously-detected risk -- never a silent
  -- "accepted risk", always a distinct, logged resolution.
  for finding_row in
    with recursive lineage as (
      select id, parent_proposal_id from public.proposals where id = p_proposal_id and room_id = p_room_id
      union all
      select parent.id, parent.parent_proposal_id
      from public.proposals parent join lineage child on parent.id = child.parent_proposal_id
      where parent.room_id = p_room_id
    )
    select finding.id
    from public.expert_findings finding
    where finding.room_id = p_room_id
      and finding.status = 'open'
      and finding.proposal_id in (select lineage.id from lineage where lineage.id <> p_proposal_id)
      and finding.category not in (
        select classify.category from public.security_expert_classify(p_proposal_id) as classify
      )
  loop
    update public.expert_findings
    set status = 'resolved', resolved_at = now(), resolution_rationale = resolution_text
    where id = finding_row.id;
    current_version := current_version + 1;
    update public.rooms set version = current_version where id = p_room_id;
    insert into public.audit_events (
      room_id, actor_type, actor_id, origin, action, entity_type, entity_id,
      sanitized_input, result, previous_room_version, resulting_room_version, confirmation_required
    ) values (
      p_room_id, 'expert', p_expert_id, 'expert_service', 'expert_finding.resolved',
      'expert_finding', finding_row.id,
      jsonb_build_object('resolutionRationale', resolution_text),
      jsonb_build_object('ok', true), current_version - 1, current_version, false
    );
  end loop;

  return inserted_ids;
end;
$$;

revoke all on function public.run_security_expert_review_internal(text, text, text, public.action_origin) from public, anon, authenticated;

create or replace function public.run_security_expert_review(
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
  room_row public.rooms;
  actor_participant_id text;
  expert_id text;
  active_id text;
  finding_ids jsonb;
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

  select participant.id into actor_participant_id from public.participants participant
    where participant.room_id = p_room_id and participant.kind = 'human' and participant.status = 'active'
      and participant.user_id = (select auth.uid());
  if actor_participant_id is null then
    return public.action_failure('NOT_AUTHORIZED', 'Claim an active human participant seat before requesting a security review.', room_row.version);
  end if;

  select participant.id into expert_id from public.participants participant
    where participant.room_id = p_room_id and participant.kind = 'expert' and participant.status = 'active'
    limit 1;
  if expert_id is null then
    return public.action_failure('VALIDATION_ERROR', 'Enable the Security Expert before requesting a review.', room_row.version,
      'An owner can call enable_security_expert first.');
  end if;

  active_id := room_row.active_proposal_id;
  if active_id is null then
    return public.action_failure('VALIDATION_ERROR', 'A security review needs an active proposal.', room_row.version);
  end if;

  finding_ids := public.run_security_expert_review_internal(p_room_id, expert_id, active_id, p_origin);
  select room.version into next_version from public.rooms room where room.id = p_room_id;
  return public.action_success_data('Security review complete.', next_version, jsonb_build_object('findingIds', finding_ids));
end;
$$;

revoke all on function public.run_security_expert_review(text, bigint, public.action_origin) from public, anon, authenticated;
grant execute on function public.run_security_expert_review(text, bigint, public.action_origin) to authenticated;

-- --------------------------------------------------------------------------
-- 6. Owner-only expert-advice disposition, before an exact candidate freeze.
-- --------------------------------------------------------------------------

create or replace function public.record_expert_advice_outcome(
  p_room_id text,
  p_finding_id text,
  p_status public.expert_finding_status,
  p_rationale text,
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
  finding_row public.expert_findings;
  next_version bigint;
begin
  if p_status not in ('resolved', 'accepted_risk', 'rejected') then
    return public.action_failure('VALIDATION_ERROR', 'Only resolved, accepted_risk, or rejected may be recorded through this action.', 0);
  end if;
  if p_rationale is null or length(trim(p_rationale)) = 0 then
    return public.action_failure('VALIDATION_ERROR', 'A rationale is required.', 0);
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
    return public.action_failure('NOT_AUTHORIZED', 'Only the current room owner can record how expert advice was addressed.', room_row.version);
  end if;

  if room_row.decision_hash is not null then
    return public.action_failure('VALIDATION_ERROR',
      'Expert advice can no longer be classified once an exact decision candidate is frozen.', room_row.version,
      'Return to Alignment before recording this disposition.');
  end if;

  select * into finding_row from public.expert_findings where id = p_finding_id and room_id = p_room_id for update;
  if not found then
    return public.action_failure('VALIDATION_ERROR', 'That expert finding does not belong to this room.', room_row.version);
  end if;
  if finding_row.status <> 'open' then
    return public.action_failure('VALIDATION_ERROR', 'Only an open finding can be classified through this action.', room_row.version);
  end if;

  update public.expert_findings
  set status = p_status, resolved_at = now(), resolution_rationale = p_rationale
  where id = p_finding_id;

  next_version := room_row.version + 1;
  update public.rooms set version = next_version where id = p_room_id;
  insert into public.audit_events (
    room_id, actor_type, actor_id, origin, action, entity_type, entity_id,
    sanitized_input, result, previous_room_version, resulting_room_version, confirmation_required
  ) values (
    p_room_id, 'participant', owner_id, p_origin, 'expert_finding.disposition_recorded',
    'expert_finding', p_finding_id,
    jsonb_build_object('status', p_status, 'rationale', p_rationale),
    jsonb_build_object('ok', true), room_row.version, next_version, false
  );
  return public.action_success('Expert advice disposition recorded.', next_version);
end;
$$;

revoke all on function public.record_expert_advice_outcome(text, text, public.expert_finding_status, text, bigint, public.action_origin) from public, anon, authenticated;
grant execute on function public.record_expert_advice_outcome(text, text, public.expert_finding_status, text, bigint, public.action_origin) to authenticated;

-- --------------------------------------------------------------------------
-- 7. Expert advice becomes part of the exact decision candidate, so material
-- expert-advice changes before finalization affect the decision hash.
-- Deterministic fields only (expertKey/findingId/proposalId/category/title/
-- status/resolutionRationale) -- never free-form generated prose beyond what
-- is already immutable on the finding.
-- --------------------------------------------------------------------------

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
    'requiredApprovalParticipantIds', required_ids,
    'expertAdvice', expert_advice_values
  );
end;
$$;

revoke all on function public.build_final_decision_candidate(text) from public;

-- --------------------------------------------------------------------------
-- 8. Demo rebuild: five canonical participants (Founder/Product Lead,
-- Engineer, Product Designer, Growth, Security Expert), an over-scoped
-- "Highly personalized AI onboarding" seed proposal that deterministically
-- triggers engineering + accessibility + security findings, and a
-- deliberation sequence that settles them once a compatible revision exists.
--
-- Role-string matching from the original solo-demo implementation is
-- replaced with fixed participant-id matching throughout, which is more
-- robust and is what let this rewrite change display names/roles freely
-- without touching the classification logic below.
-- --------------------------------------------------------------------------

create or replace function public.demo_raise_simulation_security_finding(
  p_room_id text,
  p_proposal_id text,
  p_reaction_key text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  expert_id text;
  current_phase public.room_phase;
  current_mode public.demo_mode;
  active_id text;
begin
  select room.phase, room.demo_mode, room.active_proposal_id
  into current_phase, current_mode, active_id
  from public.rooms room where room.id = p_room_id and room.id = 'demo';
  if current_phase is distinct from 'deliberation'
    or current_mode is distinct from 'solo_judge'
    or active_id is distinct from p_proposal_id then return false; end if;

  select participant.id into expert_id from public.participants participant
    where participant.room_id = p_room_id and participant.kind = 'expert' and participant.status = 'active'
    limit 1;
  if expert_id is null then return false; end if;

  if not public.demo_claim_reaction(p_room_id, p_reaction_key) then return false; end if;

  perform public.run_security_expert_review_internal(p_room_id, expert_id, p_proposal_id, 'expert_service');
  return true;
end;
$$;

revoke all on function public.demo_raise_simulation_security_finding(text, text, text) from public, anon, authenticated;

create or replace function public.start_demo_scenario(
  p_room_id text,
  p_mode public.demo_mode,
  p_human_role text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  previous_version bigint;
  human_participant_id text;
begin
  if (select auth.role()) <> 'service_role' then
    return public.action_failure('NOT_AUTHORIZED', 'Demo reset requires the guarded server route.', 0);
  end if;
  if p_room_id <> 'demo' then
    return public.action_failure('NOT_AUTHORIZED', 'Only the shared demo room may be reset.', 0);
  end if;
  if p_mode = 'solo_judge' and p_human_role not in ('product', 'engineer', 'designer', 'marketing') then
    return public.action_failure('VALIDATION_ERROR', 'A supported solo human role is required.', 0);
  end if;
  if p_mode = 'multi_user' and p_human_role is not null then
    return public.action_failure('VALIDATION_ERROR', 'Multi-user reset does not select one human role.', 0);
  end if;
  human_participant_id := case p_human_role
    when 'product' then 'demo-product'
    when 'engineer' then 'demo-engineer'
    when 'designer' then 'demo-designer'
    when 'marketing' then 'demo-marketing'
    else null
  end;

  perform pg_advisory_xact_lock(hashtextextended('solo-demo:' || p_room_id, 0));
  select room.version into previous_version
  from public.rooms room where room.id = p_room_id for update;
  if previous_version is null then
    return public.action_failure('VALIDATION_ERROR', 'Demo room not found.', 0);
  end if;
  perform set_config('app.demo_reset', 'true', true);

  update public.rooms set active_proposal_id = null where id = p_room_id;
  delete from public.approvals where room_id = p_room_id;
  delete from public.alignments where room_id = p_room_id;
  delete from public.votes where room_id = p_room_id;
  delete from public.expert_findings where room_id = p_room_id;
  delete from public.tradeoffs where room_id = p_room_id;
  delete from public.conflicts where room_id = p_room_id;
  delete from public.proposals where room_id = p_room_id;
  delete from public.positions where room_id = p_room_id;
  delete from public.constraints where room_id = p_room_id;
  delete from public.participants where room_id = p_room_id;
  delete from public.audit_events where room_id = p_room_id;
  delete from public.demo_reactions where room_id = p_room_id;

  update public.rooms
  set title = 'AI Onboarding Release Decision',
      brief = 'Decide whether to ship AI-assisted onboarding in the upcoming release while respecting engineering capacity, accessibility, campaign timing, privacy, and existing authentication boundaries.',
      demo_mode = p_mode, phase = 'input', version = 0,
      owner_participant_id = 'demo-product',
      -- Gate 6's canonical solo-judge scenario defaults to owner_decides per
      -- the product brief; multi_user keeps the original equal-authority
      -- shape, where every decision-maker must approve.
      decision_policy = (case when p_mode = 'solo_judge' then 'owner_decides' else 'equal_authority_consensus' end)::public.decision_policy,
      active_proposal_id = null, finalized_at = null,
      decision_candidate = null, decision_hash = null, final_record = null,
      is_locked = false,
      created_at = '2026-08-28T12:00:00Z'
  where id = p_room_id;

  insert into public.participants (
    id, room_id, name, role, kind, required_for_approval, created_at
  ) values
    ('demo-product', p_room_id, 'Founder / Product Lead', 'Decision owner',
      (case when p_mode = 'multi_user' or human_participant_id = 'demo-product'
        then 'human' else 'simulation' end)::public.participant_kind,
      case when p_mode = 'solo_judge' then human_participant_id = 'demo-product' else false end,
      '2026-08-28T12:00:00Z'),
    ('demo-engineer', p_room_id, 'Engineer', 'Engineering',
      (case when p_mode = 'multi_user' or human_participant_id = 'demo-engineer'
        then 'human' else 'simulation' end)::public.participant_kind,
      case when p_mode = 'solo_judge' then human_participant_id = 'demo-engineer' else true end,
      '2026-08-28T12:00:00Z'),
    ('demo-designer', p_room_id, 'Product Designer', 'Design',
      (case when p_mode = 'multi_user' or human_participant_id = 'demo-designer'
        then 'human' else 'simulation' end)::public.participant_kind,
      case when p_mode = 'solo_judge' then human_participant_id = 'demo-designer' else true end,
      '2026-08-28T12:00:00Z'),
    ('demo-marketing', p_room_id, 'Growth Lead', 'Growth / Marketing',
      (case when p_mode = 'multi_user' or human_participant_id = 'demo-marketing'
        then 'human' else 'simulation' end)::public.participant_kind,
      false,
      '2026-08-28T12:00:00Z');

  -- The Security Expert is never human, regardless of mode -- present from
  -- the start of every demo run per the canonical scenario.
  insert into public.participants (
    id, room_id, name, role, kind, meeting_role, decision_role, required_for_approval, created_at
  ) values (
    'demo-security', p_room_id, 'Security Expert', 'Security Expert · Advisory', 'expert',
    'participant', 'advisor', false, '2026-08-28T12:00:00Z'
  );

  if p_mode = 'multi_user' then
    insert into public.positions (
      id, room_id, participant_id, summary, category, priority, created_at
    ) values
      ('seed-position-product', p_room_id, 'demo-product', 'Improve onboarding completion and help users reach first value faster.', 'outcome', 'high', '2026-08-28T12:01:00Z'),
      ('seed-position-engineering', p_room_id, 'demo-engineer', 'Keep the release scope within existing architecture and team capacity.', 'feasibility', 'critical', '2026-08-28T12:01:00Z'),
      ('seed-position-design', p_room_id, 'demo-designer', 'Preserve accessibility and interaction consistency.', 'quality', 'critical', '2026-08-28T12:01:00Z'),
      ('seed-position-marketing', p_room_id, 'demo-marketing', 'Stabilize the onboarding surface before the fixed campaign cutoff.', 'timing', 'high', '2026-08-28T12:01:00Z');
  end if;

  insert into public.constraints (
    id, room_id, participant_id, category, text, priority, created_at
  ) values
    ('constraint-product-completion', p_room_id, 'demo-product', 'outcome', 'Improve onboarding completion.', 'high', '2026-08-28T12:02:00Z'),
    ('constraint-product-value', p_room_id, 'demo-product', 'outcome', 'Help users reach first value faster.', 'high', '2026-08-28T12:02:01Z'),
    ('constraint-engineering-capacity', p_room_id, 'demo-engineer', 'capacity', 'Only about two engineering days are available for this release.', 'critical', '2026-08-28T12:02:02Z'),
    ('constraint-engineering-auth', p_room_id, 'demo-engineer', 'architecture', 'Do not rewrite authentication.', 'critical', '2026-08-28T12:02:03Z'),
    ('constraint-engineering-dependencies', p_room_id, 'demo-engineer', 'reliability', 'Reuse existing infrastructure; avoid fragile new dependencies.', 'high', '2026-08-28T12:02:04Z'),
    ('constraint-design-accessibility', p_room_id, 'demo-designer', 'accessibility', 'Accessibility cannot regress.', 'critical', '2026-08-28T12:02:05Z'),
    ('constraint-design-consistency', p_room_id, 'demo-designer', 'consistency', 'Interaction patterns must remain consistent; avoid untested onboarding patterns.', 'high', '2026-08-28T12:02:06Z'),
    ('constraint-marketing-date', p_room_id, 'demo-marketing', 'timing', 'The campaign launch date cannot move.', 'critical', '2026-08-28T12:02:07Z'),
    ('constraint-marketing-cutoff', p_room_id, 'demo-marketing', 'timing', 'The onboarding surface must stabilize before the campaign cutoff; the launch needs a measurable but simple experiment.', 'critical', '2026-08-28T12:02:08Z'),
    ('constraint-security-minimal-data', p_room_id, 'demo-security', 'privacy', 'Collect only the data needed; avoid unnecessary auth/security boundary expansion.', 'critical', '2026-08-28T12:02:09Z');

  insert into public.proposals (
    id, room_id, participant_id, title, summary, rationale, expected_outcomes,
    referenced_constraint_ids, parent_proposal_id, status, created_at
  ) values (
    'seed-proposal-onboarding-v1', p_room_id, 'demo-product',
    'Highly personalized AI onboarding',
    'Roll out AI-assisted onboarding with behavioral event tracking, a persistent per-user profile, dynamic onboarding paths, new auth-linked profile fields, broad analytics instrumentation, and a custom interactive onboarding UI, in the upcoming release.',
    'Maximizes short-term onboarding personalization, but has not yet been reconciled with engineering capacity, accessibility, or data-handling constraints.',
    array['Higher onboarding completion', 'Faster time to first value'],
    array['constraint-product-completion', 'constraint-product-value'],
    null, 'draft', '2026-08-28T12:03:00Z'
  );

  insert into public.audit_events (
    id, room_id, actor_type, actor_id, origin, action, entity_type, entity_id,
    sanitized_input, result, previous_room_version, resulting_room_version,
    confirmation_required, created_at
  ) values (
    'demo-event-scenario-started', p_room_id, 'system', null, 'manual_ui',
    'demo.scenario_started', 'room', p_room_id,
    jsonb_build_object('mode', p_mode, 'humanRole', p_human_role),
    jsonb_build_object('ok', true), previous_version, 0, false, now()
  );
  return public.action_success('Demo scenario reset transactionally.', 0);
end;
$$;

-- Same deterministic scenario as Slice 4/5, extended with a Security Expert
-- advisory step in Deliberation. Matching is by fixed participant id
-- throughout (not display role text), so the renamed roles above never
-- affect this logic.
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
  pending_summary text;
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

  for iteration in 1..40 loop
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
      select participant.id,
        case participant.id
          when 'demo-product' then 'Improve onboarding completion and time to first value.'
          when 'demo-engineer' then 'Ship within available capacity without rewriting authentication.'
          when 'demo-designer' then 'Preserve accessibility and existing interaction patterns.'
          else 'Do not move the campaign launch date.'
        end
      into actor_id, pending_summary
      from public.participants participant
      where participant.room_id = p_room_id and participant.kind = 'simulation'
        and not exists (
          select 1 from public.positions position
          where position.room_id = p_room_id and position.participant_id = participant.id
        )
      order by participant.id limit 1;
      if actor_id is not null then
        acted := public.demo_add_simulation_position(
          p_room_id, actor_id, pending_summary, 'scenario', 'high',
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
          pending_summary := 'engineer_capacity_objection:' || active_id;
          if exists (
            select 1 from public.participants where id = 'demo-engineer' and room_id = p_room_id and kind = 'simulation'
          ) and not exists (
            select 1 from public.demo_reactions reaction
            where reaction.room_id = p_room_id and reaction.reaction_key = pending_summary
          ) then
            select constraint_value.id into constraint_id
            from public.constraints constraint_value
            where constraint_value.room_id = p_room_id
              and constraint_value.participant_id = 'demo-engineer'
              and constraint_value.id = 'constraint-engineering-capacity';
            acted := public.demo_raise_simulation_objection(
              p_room_id, 'demo-engineer', active_id, constraint_id,
              'This scope requires auth/profile work beyond available engineering capacity.',
              'blocking', pending_summary
            );
          end if;
        end if;
        if not acted and public.demo_needs_accessibility_objection(active_id) then
          pending_summary := 'designer_accessibility_objection:' || active_id;
          if exists (
            select 1 from public.participants where id = 'demo-designer' and room_id = p_room_id and kind = 'simulation'
          ) and not exists (
            select 1 from public.demo_reactions reaction
            where reaction.room_id = p_room_id and reaction.reaction_key = pending_summary
          ) then
            select constraint_value.id into constraint_id
            from public.constraints constraint_value
            where constraint_value.room_id = p_room_id
              and constraint_value.participant_id = 'demo-designer'
              and constraint_value.id = 'constraint-design-accessibility';
            acted := public.demo_raise_simulation_objection(
              p_room_id, 'demo-designer', active_id, constraint_id,
              'The highly dynamic onboarding flow has not passed accessibility/interaction validation.',
              'blocking', pending_summary
            );
          end if;
        end if;
        if not acted then
          acted := public.demo_raise_simulation_security_finding(
            p_room_id, active_id, 'security_review:' || active_id
          );
        end if;
        if not acted and public.demo_threatens_deadline(active_id) then
          pending_summary := 'marketing_deadline_objection:' || active_id;
          if exists (
            select 1 from public.participants where id = 'demo-marketing' and room_id = p_room_id and kind = 'simulation'
          ) and not exists (
            select 1 from public.demo_reactions reaction
            where reaction.room_id = p_room_id and reaction.reaction_key = pending_summary
          ) then
            select constraint_value.id into constraint_id
            from public.constraints constraint_value
            where constraint_value.room_id = p_room_id
              and constraint_value.participant_id = 'demo-marketing'
              and constraint_value.id = 'constraint-marketing-date';
            acted := public.demo_raise_simulation_objection(
              p_room_id, 'demo-marketing', active_id, constraint_id,
              'The proposal threatens the fixed campaign launch date.',
              'warning', pending_summary
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
        if not acted then
          acted := public.demo_raise_simulation_security_finding(
            p_room_id, active_id, 'security_review:' || active_id
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
          actor_role || ' is aligned with the scoped compromise.',
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
        -- for the human's own alignment before entering decision review.
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
    pending_summary := null;
  end loop;

  select room.version into current_version from public.rooms room where room.id = p_room_id;
  return public.action_success('Demo scenario settled deterministically.', current_version);
end;
$$;

-- --------------------------------------------------------------------------
-- Grants (unchanged callers keep their existing access; nothing new is
-- exposed to anon/authenticated beyond the three expert entry points above).
-- --------------------------------------------------------------------------

revoke all on function public.start_demo_scenario(text, public.demo_mode, text) from public, anon, authenticated;
revoke all on function public.run_solo_demo_orchestration(text) from public;
grant execute on function public.run_solo_demo_orchestration(text) to authenticated, service_role;
