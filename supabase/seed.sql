begin;

-- Canonical Gate 6 solo-judge demo baseline. This mirrors exactly what
-- `start_demo_scenario('demo', 'solo_judge', 'product')` produces, so a
-- fresh `supabase db reset` already has `/room/demo` ready for a first-time
-- judge without any additional server call. The visible "Reset demo" action
-- (`POST /api/demo/reset`) re-runs that same function transactionally.

insert into public.rooms (
  id, title, brief, demo_mode, phase, version, owner_participant_id,
  decision_policy, is_locked, created_at
)
values (
  'demo',
  'AI Onboarding Release Decision',
  'Decide whether to ship AI-assisted onboarding in the upcoming release while respecting engineering capacity, accessibility, campaign timing, privacy, and existing authentication boundaries.',
  'solo_judge',
  'input',
  0,
  'demo-product',
  'owner_decides',
  false,
  '2026-08-28T12:00:00Z'
);

insert into public.participants (
  id, room_id, name, role, kind, meeting_role, decision_role,
  required_for_approval, created_at
) values
  ('demo-product', 'demo', 'Founder / Product Lead', 'Decision owner', 'human', 'owner', 'decision_maker', true, '2026-08-28T12:00:00Z'),
  ('demo-engineer', 'demo', 'Engineer', 'Engineering', 'simulation', 'participant', 'advisor', false, '2026-08-28T12:00:00Z'),
  ('demo-designer', 'demo', 'Product Designer', 'Design', 'simulation', 'participant', 'advisor', false, '2026-08-28T12:00:00Z'),
  ('demo-marketing', 'demo', 'Growth Lead', 'Growth / Marketing', 'simulation', 'participant', 'advisor', false, '2026-08-28T12:00:00Z'),
  ('demo-security', 'demo', 'Security Expert', 'Security Expert · Advisory', 'expert', 'participant', 'advisor', false, '2026-08-28T12:00:00Z');

insert into public.constraints (
  id, room_id, participant_id, category, text, priority, created_at
) values
  ('constraint-product-completion', 'demo', 'demo-product', 'outcome', 'Improve onboarding completion.', 'high', '2026-08-28T12:02:00Z'),
  ('constraint-product-value', 'demo', 'demo-product', 'outcome', 'Help users reach first value faster.', 'high', '2026-08-28T12:02:01Z'),
  ('constraint-engineering-capacity', 'demo', 'demo-engineer', 'capacity', 'Only about two engineering days are available for this release.', 'critical', '2026-08-28T12:02:02Z'),
  ('constraint-engineering-auth', 'demo', 'demo-engineer', 'architecture', 'Do not rewrite authentication.', 'critical', '2026-08-28T12:02:03Z'),
  ('constraint-engineering-dependencies', 'demo', 'demo-engineer', 'reliability', 'Reuse existing infrastructure; avoid fragile new dependencies.', 'high', '2026-08-28T12:02:04Z'),
  ('constraint-design-accessibility', 'demo', 'demo-designer', 'accessibility', 'Accessibility cannot regress.', 'critical', '2026-08-28T12:02:05Z'),
  ('constraint-design-consistency', 'demo', 'demo-designer', 'consistency', 'Interaction patterns must remain consistent; avoid untested onboarding patterns.', 'high', '2026-08-28T12:02:06Z'),
  ('constraint-marketing-date', 'demo', 'demo-marketing', 'timing', 'The campaign launch date cannot move.', 'critical', '2026-08-28T12:02:07Z'),
  ('constraint-marketing-cutoff', 'demo', 'demo-marketing', 'timing', 'The onboarding surface must stabilize before the campaign cutoff; the launch needs a measurable but simple experiment.', 'critical', '2026-08-28T12:02:08Z'),
  ('constraint-security-minimal-data', 'demo', 'demo-security', 'privacy', 'Collect only the data needed; avoid unnecessary auth/security boundary expansion.', 'critical', '2026-08-28T12:02:09Z');

insert into public.proposals (
  id, room_id, participant_id, title, summary, rationale, expected_outcomes,
  referenced_constraint_ids, parent_proposal_id, status, created_at
) values (
  'seed-proposal-onboarding-v1',
  'demo',
  'demo-product',
  'Highly personalized AI onboarding',
  'Roll out AI-assisted onboarding with behavioral event tracking, a persistent per-user profile, dynamic onboarding paths, new auth-linked profile fields, broad analytics instrumentation, and a custom interactive onboarding UI, in the upcoming release.',
  'Maximizes short-term onboarding personalization, but has not yet been reconciled with engineering capacity, accessibility, or data-handling constraints.',
  array['Higher onboarding completion', 'Faster time to first value'],
  array['constraint-product-completion', 'constraint-product-value'],
  null,
  'draft',
  '2026-08-28T12:03:00Z'
);

insert into public.audit_events (
  id, room_id, actor_type, actor_id, origin, action, entity_type, entity_id,
  sanitized_input, result, previous_room_version, resulting_room_version,
  confirmation_required, created_at
) values (
  'seed-event-room-created', 'demo', 'system', null, 'system', 'room.created',
  'room', 'demo', '{}', '{"ok": true}', 0, 0, false, '2026-08-28T12:00:00Z'
);

-- A non-public room used only to prove cross-room IDs cannot be smuggled into
-- demo mutations. It is intentionally invisible to unaffiliated sessions.
insert into public.rooms (
  id, title, brief, demo_mode, phase, version, owner_participant_id,
  decision_policy, created_at
)
values (
  'authorization-fixture', 'Authorization fixture', 'Cross-room test data.',
  null, 'proposals', 0, 'authorization-participant', 'owner_decides',
  '2026-08-28T12:00:00Z'
);

insert into public.participants (
  id, room_id, name, role, kind, meeting_role, decision_role,
  required_for_approval, created_at
) values (
  'authorization-participant', 'authorization-fixture', 'Fixture', 'Fixture',
  'simulation', 'owner', 'decision_maker', false, '2026-08-28T12:00:00Z'
);

insert into public.constraints (
  id, room_id, participant_id, category, text, priority, created_at
) values ('authorization-constraint', 'authorization-fixture', 'authorization-participant', 'private', 'Cross-room constraint.', 'critical', '2026-08-28T12:00:00Z');

insert into public.proposals (
  id, room_id, participant_id, title, summary, rationale, status, created_at
) values ('authorization-proposal', 'authorization-fixture', 'authorization-participant', 'Private proposal', 'Cross-room proposal.', 'Test fixture.', 'candidate', '2026-08-28T12:00:00Z');

insert into public.conflicts (
  id, room_id, proposal_id, constraint_id, raised_by_actor_type,
  raised_by_actor_id, severity, reason, status, created_at, resolved_at
) values
  (
    'seed-conflict-resolved', 'demo', 'seed-proposal-onboarding-v1',
    'constraint-design-consistency', 'system', null, 'warning',
    'Resolved fixture that must not appear in open issues.', 'resolved',
    '2026-08-28T12:04:00Z', '2026-08-28T12:05:00Z'
  ),
  (
    'authorization-conflict', 'authorization-fixture', 'authorization-proposal',
    'authorization-constraint', 'system', null, 'blocking',
    'Cross-room conflict.', 'open', '2026-08-28T12:04:00Z', null
  );

commit;
