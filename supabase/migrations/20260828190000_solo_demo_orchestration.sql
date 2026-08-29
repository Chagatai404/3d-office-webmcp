create type public.demo_mode as enum ('multi_user', 'solo_judge');

alter table public.rooms add column demo_mode public.demo_mode;
update public.rooms set demo_mode = 'multi_user' where id = 'demo';

create table public.demo_reactions (
  id bigint generated always as identity primary key,
  room_id text not null references public.rooms(id) on delete cascade,
  reaction_key text not null check (length(trim(reaction_key)) > 0),
  status text not null default 'completed' check (status = 'completed'),
  created_at timestamptz not null default now(),
  completed_at timestamptz not null default now(),
  unique (room_id, reaction_key)
);

alter table public.demo_reactions enable row level security;
revoke all on table public.demo_reactions from anon, authenticated;

create or replace function public.prevent_finalized_entity_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_room_id text;
begin
  if current_setting('app.demo_reset', true) = 'true' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  target_room_id := case when tg_op = 'DELETE' then old.room_id else new.room_id end;
  if exists (select 1 from public.rooms where id = target_room_id and phase = 'finalized') then
    raise exception 'ALREADY_FINALIZED: the finalized room is immutable';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace function public.prevent_finalized_room_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_setting('app.demo_reset', true) = 'true' then return new; end if;
  if old.phase = 'finalized' and new is distinct from old then
    raise exception 'ALREADY_FINALIZED: the finalized room is immutable';
  end if;
  return new;
end;
$$;

create or replace function public.demo_claim_reaction(
  p_room_id text,
  p_reaction_key text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  inserted_count integer;
begin
  insert into public.demo_reactions (room_id, reaction_key)
  values (p_room_id, p_reaction_key)
  on conflict (room_id, reaction_key) do nothing;
  get diagnostics inserted_count = row_count;
  return inserted_count = 1;
end;
$$;

create or replace function public.demo_normalize_text(input_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select trim(regexp_replace(lower(coalesce(input_value, '')), '[^a-z0-9]+', ' ', 'g'));
$$;

create or replace function public.demo_proposal_text(p_proposal_id text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select public.demo_normalize_text(
    concat_ws(' ', proposal.title, proposal.summary, proposal.rationale,
      array_to_string(proposal.expected_outcomes, ' '))
  )
  from public.proposals proposal
  where proposal.id = p_proposal_id;
$$;

create or replace function public.demo_is_ambitious_proposal(p_proposal_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.demo_proposal_text(p_proposal_id) ~
    '(rebuild|rewrite|custom|multi step|new event tracking|expanded personalization)', false);
$$;

create or replace function public.demo_needs_accessibility_objection(p_proposal_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    public.demo_proposal_text(p_proposal_id) ~ '(custom|multi step|new onboarding|rebuild)'
    and public.demo_proposal_text(p_proposal_id) !~
      '(accessib|screen reader|keyboard|wcag)',
    false
  );
$$;

create or replace function public.demo_threatens_deadline(p_proposal_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.demo_proposal_text(p_proposal_id) ~
    '((delay|move|postpone).*(campaign|launch)|(after|past).*(campaign|launch))', false);
$$;

create or replace function public.demo_revision_is_acceptable(p_proposal_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    public.demo_proposal_text(p_proposal_id) ~
      '(existing auth|existing authentication|preserve auth|keep auth|without.*auth rewrite|no auth rewrite)'
    and public.demo_proposal_text(p_proposal_id) ~
      '(reduce.*scope|reduced.*scope|limit.*scope|thin slice|reuse|existing flow|incremental|progressive)'
    and public.demo_proposal_text(p_proposal_id) ~
      '(two week|two-week|campaign deadline|campaign launch|launch date|without moving.*launch)'
    and public.demo_proposal_text(p_proposal_id) ~
      '(accessib|screen reader|keyboard|wcag)'
    and public.demo_proposal_text(p_proposal_id) ~
      '(onboarding|first value|completion)',
    false
  );
$$;

create or replace function public.demo_add_simulation_position(
  p_room_id text,
  p_participant_id text,
  p_summary text,
  p_category text,
  p_priority text,
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
    and room.demo_mode = 'solo_judge' and room.phase = 'input'
  for update;
  if current_version is null then return false; end if;
  if not exists (
    select 1 from public.participants participant
    where participant.id = p_participant_id and participant.room_id = p_room_id
      and participant.kind = 'simulation'
  ) or exists (
    select 1 from public.positions position
    where position.room_id = p_room_id and position.participant_id = p_participant_id
  ) then return false; end if;
  if not public.demo_claim_reaction(p_room_id, p_reaction_key) then return false; end if;

  insert into public.positions (
    id, room_id, participant_id, summary, category, priority
  ) values (
    'demo-position-' || p_participant_id, p_room_id, p_participant_id,
    p_summary, p_category, p_priority
  );
  update public.rooms set version = current_version + 1 where id = p_room_id;
  insert into public.audit_events (
    room_id, actor_type, actor_id, origin, action, entity_type, entity_id,
    sanitized_input, result, previous_room_version, resulting_room_version,
    confirmation_required
  ) values (
    p_room_id, 'participant', p_participant_id, 'simulation', 'position.added',
    'position', 'demo-position-' || p_participant_id,
    jsonb_build_object('summary', p_summary, 'category', p_category, 'priority', p_priority),
    jsonb_build_object('ok', true), current_version, current_version + 1, false
  );
  return true;
end;
$$;

create or replace function public.demo_raise_simulation_objection(
  p_room_id text,
  p_participant_id text,
  p_proposal_id text,
  p_constraint_id text,
  p_reason text,
  p_severity public.conflict_severity,
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
  conflict_id text := 'demo-conflict-' || md5(p_reaction_key);
begin
  select room.version into current_version
  from public.rooms room
  where room.id = p_room_id and room.id = 'demo'
    and room.demo_mode = 'solo_judge' and room.phase = 'deliberation'
    and room.active_proposal_id = p_proposal_id
  for update;
  if current_version is null then return false; end if;
  if not exists (
    select 1 from public.participants participant
    where participant.id = p_participant_id and participant.room_id = p_room_id
      and participant.kind = 'simulation'
  ) or not exists (
    select 1 from public.constraints constraint_value
    where constraint_value.id = p_constraint_id and constraint_value.room_id = p_room_id
      and constraint_value.participant_id = p_participant_id
  ) then return false; end if;
  if not public.demo_claim_reaction(p_room_id, p_reaction_key) then return false; end if;

  insert into public.conflicts (
    id, room_id, proposal_id, constraint_id, raised_by_actor_type,
    raised_by_actor_id, severity, reason, status
  ) values (
    conflict_id, p_room_id, p_proposal_id, p_constraint_id, 'participant',
    p_participant_id, p_severity, p_reason, 'open'
  );
  update public.rooms set version = current_version + 1 where id = p_room_id;
  insert into public.audit_events (
    room_id, actor_type, actor_id, origin, action, entity_type, entity_id,
    sanitized_input, result, previous_room_version, resulting_room_version,
    confirmation_required
  ) values (
    p_room_id, 'participant', p_participant_id, 'simulation', 'objection.raised',
    'conflict', conflict_id,
    jsonb_build_object('proposalId', p_proposal_id, 'constraintId', p_constraint_id,
      'reason', p_reason, 'severity', p_severity),
    jsonb_build_object('ok', true), current_version, current_version + 1, false
  );
  return true;
end;
$$;

create or replace function public.demo_resolve_simulation_objection(
  p_room_id text,
  p_participant_id text,
  p_conflict_id text,
  p_resolution_note text,
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
    and room.demo_mode = 'solo_judge' and room.phase = 'deliberation'
  for update;
  if current_version is null then return false; end if;
  if not exists (
    select 1 from public.participants participant
    where participant.id = p_participant_id and participant.room_id = p_room_id
      and participant.kind = 'simulation'
  ) or not exists (
    select 1 from public.conflicts conflict_value
    where conflict_value.id = p_conflict_id and conflict_value.room_id = p_room_id
      and conflict_value.status = 'open'
      and conflict_value.raised_by_actor_type = 'participant'
      and conflict_value.raised_by_actor_id = p_participant_id
  ) then return false; end if;
  if not public.demo_claim_reaction(p_room_id, p_reaction_key) then return false; end if;

  update public.conflicts
  set status = 'resolved', resolved_at = now(),
      resolved_by_actor_type = 'participant', resolved_by_actor_id = p_participant_id,
      resolution_note = p_resolution_note
  where id = p_conflict_id and room_id = p_room_id;
  update public.rooms set version = current_version + 1 where id = p_room_id;
  insert into public.audit_events (
    room_id, actor_type, actor_id, origin, action, entity_type, entity_id,
    sanitized_input, result, previous_room_version, resulting_room_version,
    confirmation_required
  ) values (
    p_room_id, 'participant', p_participant_id, 'simulation', 'conflict.resolved',
    'conflict', p_conflict_id,
    jsonb_build_object('resolutionNote', p_resolution_note),
    jsonb_build_object('ok', true), current_version, current_version + 1, false
  );
  return true;
end;
$$;

create or replace function public.demo_cast_simulation_vote(
  p_room_id text,
  p_participant_id text,
  p_proposal_id text,
  p_choice public.vote_choice,
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

  insert into public.votes (room_id, proposal_id, participant_id, choice, comment)
  values (p_room_id, p_proposal_id, p_participant_id, p_choice, p_comment)
  on conflict (room_id, proposal_id, participant_id)
  do update set choice = excluded.choice, comment = excluded.comment, updated_at = now();
  update public.rooms set version = current_version + 1 where id = p_room_id;
  insert into public.audit_events (
    room_id, actor_type, actor_id, origin, action, entity_type, entity_id,
    sanitized_input, result, previous_room_version, resulting_room_version,
    confirmation_required
  ) values (
    p_room_id, 'participant', p_participant_id, 'simulation', 'vote.cast',
    'vote', p_proposal_id,
    jsonb_build_object('proposalId', p_proposal_id, 'choice', p_choice, 'comment', p_comment),
    jsonb_build_object('ok', true), current_version, current_version + 1, false
  );
  return true;
end;
$$;

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
  required_count integer;
  recorded_count integer;
  support_count integer;
  candidate_value jsonb;
  candidate_hash text;
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
  if p_next_phase = 'voting' then
    if active_id is null or exists (
      select 1 from public.conflicts conflict_value
      where conflict_value.room_id = p_room_id and conflict_value.status = 'open'
        and conflict_value.severity = 'blocking'
    ) then return false; end if;
  end if;
  if p_next_phase = 'approval' then
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
    if required_count = 0 or recorded_count <> required_count
      or support_count <= required_count / 2
      or exists (
        select 1 from public.votes vote
        join public.participants participant on participant.id = vote.participant_id
        where vote.room_id = p_room_id and vote.proposal_id = active_id
          and participant.kind = 'human' and participant.required_for_approval = true
          and vote.choice = 'request_changes'
      ) or exists (
        select 1 from public.conflicts conflict_value
        where conflict_value.room_id = p_room_id and conflict_value.status = 'open'
          and conflict_value.severity = 'blocking'
      ) then return false; end if;
  end if;
  if not public.demo_claim_reaction(p_room_id, p_reaction_key) then return false; end if;

  if p_next_phase = 'voting' then
    delete from public.votes where room_id = p_room_id;
    delete from public.approvals where room_id = p_room_id;
    update public.rooms
    set decision_candidate = null, decision_hash = null, final_record = null
    where id = p_room_id;
  elsif p_next_phase = 'approval' then
    candidate_value := public.build_final_decision_candidate(p_room_id);
    candidate_hash := public.hash_decision_candidate(candidate_value);
    delete from public.approvals where room_id = p_room_id;
    update public.rooms
    set decision_candidate = candidate_value, decision_hash = candidate_hash
    where id = p_room_id;
  end if;

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
    jsonb_build_object('ok', true, 'decisionHash', candidate_hash),
    current_version, current_version + 1, false
  );
  return true;
end;
$$;

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
          select 1 from public.votes vote
          where vote.room_id = p_room_id and vote.proposal_id = active_id
            and vote.participant_id = participant.id
        )
      order by participant.id limit 1;
      if actor_id is not null then
        acted := public.demo_cast_simulation_vote(
          p_room_id, actor_id, active_id, 'support',
          actor_role || ' simulation supports the scoped two-week compromise.',
          'vote:' || actor_id || ':' || active_id
        );
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
  delete from public.votes where room_id = p_room_id;
  delete from public.tradeoffs where room_id = p_room_id;
  delete from public.conflicts where room_id = p_room_id;
  delete from public.proposals where room_id = p_room_id;
  delete from public.positions where room_id = p_room_id;
  delete from public.constraints where room_id = p_room_id;
  delete from public.participants where room_id = p_room_id;
  delete from public.audit_events where room_id = p_room_id;
  delete from public.demo_reactions where room_id = p_room_id;

  update public.rooms
  set title = 'Two-Week Onboarding Launch',
      brief = 'Should the startup ship an onboarding feature update within two weeks, and what scope should it have?',
      demo_mode = p_mode, phase = 'input', version = 0,
      active_proposal_id = null, finalized_at = null,
      decision_candidate = null, decision_hash = null, final_record = null,
      created_at = '2026-08-28T12:00:00Z'
  where id = p_room_id;

  insert into public.participants (
    id, room_id, name, role, kind, required_for_approval, created_at
  ) values
    ('demo-product', p_room_id, 'Maya', 'Product Manager',
      (case when p_mode = 'multi_user' or human_participant_id = 'demo-product'
        then 'human' else 'simulation' end)::public.participant_kind,
      case when p_mode = 'solo_judge' then human_participant_id = 'demo-product' else false end,
      '2026-08-28T12:00:00Z'),
    ('demo-engineer', p_room_id, 'Emre', 'Engineer',
      (case when p_mode = 'multi_user' or human_participant_id = 'demo-engineer'
        then 'human' else 'simulation' end)::public.participant_kind,
      case when p_mode = 'solo_judge' then human_participant_id = 'demo-engineer' else true end,
      '2026-08-28T12:00:00Z'),
    ('demo-designer', p_room_id, 'Lina', 'Designer',
      (case when p_mode = 'multi_user' or human_participant_id = 'demo-designer'
        then 'human' else 'simulation' end)::public.participant_kind,
      case when p_mode = 'solo_judge' then human_participant_id = 'demo-designer' else true end,
      '2026-08-28T12:00:00Z'),
    ('demo-marketing', p_room_id, 'Ari', 'Marketing Lead',
      (case when p_mode = 'multi_user' or human_participant_id = 'demo-marketing'
        then 'human' else 'simulation' end)::public.participant_kind,
      case when p_mode = 'solo_judge' then human_participant_id = 'demo-marketing' else false end,
      '2026-08-28T12:00:00Z');

  if p_mode = 'multi_user' then
    insert into public.positions (
      id, room_id, participant_id, summary, category, priority, created_at
    ) values
      ('seed-position-product', p_room_id, 'demo-product', 'Improve onboarding completion and help users reach first value faster.', 'outcome', 'high', '2026-08-28T12:01:00Z'),
      ('seed-position-engineering', p_room_id, 'demo-engineer', 'Keep the two-week scope within existing architecture and team capacity.', 'feasibility', 'critical', '2026-08-28T12:01:00Z'),
      ('seed-position-design', p_room_id, 'demo-designer', 'Preserve accessibility and interaction consistency.', 'quality', 'critical', '2026-08-28T12:01:00Z'),
      ('seed-position-marketing', p_room_id, 'demo-marketing', 'Stabilize the product surface before the fixed campaign cutoff.', 'timing', 'high', '2026-08-28T12:01:00Z');
  end if;

  insert into public.constraints (
    id, room_id, participant_id, category, text, priority, created_at
  ) values
    ('constraint-product-completion', p_room_id, 'demo-product', 'outcome', 'Improve onboarding completion.', 'high', '2026-08-28T12:02:00Z'),
    ('constraint-product-value', p_room_id, 'demo-product', 'outcome', 'Help users reach first value faster.', 'high', '2026-08-28T12:02:01Z'),
    ('constraint-engineering-capacity', p_room_id, 'demo-engineer', 'capacity', 'Implementation capacity is limited to two weeks.', 'critical', '2026-08-28T12:02:02Z'),
    ('constraint-engineering-auth', p_room_id, 'demo-engineer', 'architecture', 'Do not rewrite authentication.', 'critical', '2026-08-28T12:02:03Z'),
    ('constraint-engineering-dependencies', p_room_id, 'demo-engineer', 'reliability', 'Avoid fragile new dependencies.', 'high', '2026-08-28T12:02:04Z'),
    ('constraint-design-accessibility', p_room_id, 'demo-designer', 'accessibility', 'Meet accessibility requirements.', 'critical', '2026-08-28T12:02:05Z'),
    ('constraint-design-consistency', p_room_id, 'demo-designer', 'consistency', 'Preserve visual and interaction consistency.', 'high', '2026-08-28T12:02:06Z'),
    ('constraint-marketing-date', p_room_id, 'demo-marketing', 'timing', 'The campaign date cannot move.', 'critical', '2026-08-28T12:02:07Z'),
    ('constraint-marketing-cutoff', p_room_id, 'demo-marketing', 'timing', 'The product surface must stabilize before campaign cutoff.', 'critical', '2026-08-28T12:02:08Z');

  insert into public.proposals (
    id, room_id, participant_id, title, summary, rationale, expected_outcomes,
    referenced_constraint_ids, parent_proposal_id, status, created_at
  ) values (
    'seed-proposal-full-rebuild', p_room_id, 'demo-product',
    'Full personalized onboarding rebuild',
    'Rebuild onboarding as a custom multi-step flow with new event tracking and expanded personalization before the scheduled campaign launch.',
    'A broad redesign could maximize short-term onboarding gains, but has not yet been reconciled with delivery and accessibility constraints.',
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

revoke all on function public.demo_claim_reaction(text, text) from public;
revoke all on function public.demo_normalize_text(text) from public;
revoke all on function public.demo_proposal_text(text) from public;
revoke all on function public.demo_is_ambitious_proposal(text) from public;
revoke all on function public.demo_needs_accessibility_objection(text) from public;
revoke all on function public.demo_threatens_deadline(text) from public;
revoke all on function public.demo_revision_is_acceptable(text) from public;
revoke all on function public.demo_add_simulation_position(text, text, text, text, text, text) from public;
revoke all on function public.demo_raise_simulation_objection(text, text, text, text, text, public.conflict_severity, text) from public;
revoke all on function public.demo_resolve_simulation_objection(text, text, text, text, text) from public;
revoke all on function public.demo_cast_simulation_vote(text, text, text, public.vote_choice, text, text) from public;
revoke all on function public.demo_advance_solo_phase(text, public.room_phase, text) from public;
revoke all on function public.run_solo_demo_orchestration(text) from public;
revoke all on function public.start_demo_scenario(text, public.demo_mode, text) from public;

revoke all on function public.demo_claim_reaction(text, text) from anon, authenticated;
revoke all on function public.demo_normalize_text(text) from anon, authenticated;
revoke all on function public.demo_proposal_text(text) from anon, authenticated;
revoke all on function public.demo_is_ambitious_proposal(text) from anon, authenticated;
revoke all on function public.demo_needs_accessibility_objection(text) from anon, authenticated;
revoke all on function public.demo_threatens_deadline(text) from anon, authenticated;
revoke all on function public.demo_revision_is_acceptable(text) from anon, authenticated;
revoke all on function public.demo_add_simulation_position(text, text, text, text, text, text) from anon, authenticated;
revoke all on function public.demo_raise_simulation_objection(text, text, text, text, text, public.conflict_severity, text) from anon, authenticated;
revoke all on function public.demo_resolve_simulation_objection(text, text, text, text, text) from anon, authenticated;
revoke all on function public.demo_cast_simulation_vote(text, text, text, public.vote_choice, text, text) from anon, authenticated;
revoke all on function public.demo_advance_solo_phase(text, public.room_phase, text) from anon, authenticated;
revoke all on function public.start_demo_scenario(text, public.demo_mode, text) from anon, authenticated;

grant execute on function public.run_solo_demo_orchestration(text) to authenticated, service_role;
grant execute on function public.start_demo_scenario(text, public.demo_mode, text) to service_role;
