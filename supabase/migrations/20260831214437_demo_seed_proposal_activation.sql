-- The seeded judge-demo proposal ('seed-proposal-onboarding-v1') was inserted
-- with status 'draft' and rooms.active_proposal_id left null. Nothing in
-- demo_advance_solo_phase, run_solo_demo_orchestration, or the generic
-- advance_room_phase ever promotes a 'draft' proposal to active, so the
-- Proposals phase was permanently stuck on "no active proposal" until a human
-- submitted a brand-new one -- contradicting docs/judge-demo.md's documented
-- "the seeded over-scoped proposal becomes active automatically."
--
-- Fix: give the seed proposal the same status a normally-submitted proposal
-- gets ('candidate'), and set active_proposal_id to it once the row exists
-- (the FK on rooms.active_proposal_id requires the proposal to already exist,
-- so this update runs after the insert, not folded into the earlier room
-- update in this same function).

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
    null, 'candidate', '2026-08-28T12:03:00Z'
  );

  -- Activate the seed proposal now that the row exists (the FK on
  -- active_proposal_id requires this to run after the insert above). This is
  -- the one line that makes the seeded scenario actually reachable without a
  -- human/agent submitting a brand-new proposal first.
  update public.rooms set active_proposal_id = 'seed-proposal-onboarding-v1' where id = p_room_id;

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

revoke all on function public.start_demo_scenario(text, public.demo_mode, text) from public, anon, authenticated;
grant execute on function public.start_demo_scenario(text, public.demo_mode, text) to service_role;
