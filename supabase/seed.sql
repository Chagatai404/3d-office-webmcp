insert into public.rooms (id, title, brief, demo_mode, phase, version, created_at)
values (
  'demo',
  'Two-Week Onboarding Launch',
  'Should the startup ship an onboarding feature update within two weeks, and what scope should it have?',
  'multi_user',
  'input',
  0,
  '2026-08-28T12:00:00Z'
);

insert into public.participants (
  id, room_id, name, role, kind, required_for_approval, created_at
) values
  ('demo-product', 'demo', 'Maya', 'Product Manager', 'human', false, '2026-08-28T12:00:00Z'),
  ('demo-engineer', 'demo', 'Emre', 'Engineer', 'human', true, '2026-08-28T12:00:00Z'),
  ('demo-designer', 'demo', 'Lina', 'Designer', 'human', true, '2026-08-28T12:00:00Z'),
  ('demo-marketing', 'demo', 'Ari', 'Marketing Lead', 'human', false, '2026-08-28T12:00:00Z');

insert into public.positions (
  id, room_id, participant_id, summary, category, priority, created_at
) values
  ('seed-position-product', 'demo', 'demo-product', 'Improve onboarding completion and help users reach first value faster.', 'outcome', 'high', '2026-08-28T12:01:00Z'),
  ('seed-position-engineering', 'demo', 'demo-engineer', 'Keep the two-week scope within existing architecture and team capacity.', 'feasibility', 'critical', '2026-08-28T12:01:00Z'),
  ('seed-position-design', 'demo', 'demo-designer', 'Preserve accessibility and interaction consistency.', 'quality', 'critical', '2026-08-28T12:01:00Z'),
  ('seed-position-marketing', 'demo', 'demo-marketing', 'Stabilize the product surface before the fixed campaign cutoff.', 'timing', 'high', '2026-08-28T12:01:00Z');

insert into public.constraints (
  id, room_id, participant_id, category, text, priority, created_at
) values
  ('constraint-product-completion', 'demo', 'demo-product', 'outcome', 'Improve onboarding completion.', 'high', '2026-08-28T12:02:00Z'),
  ('constraint-product-value', 'demo', 'demo-product', 'outcome', 'Help users reach first value faster.', 'high', '2026-08-28T12:02:01Z'),
  ('constraint-engineering-capacity', 'demo', 'demo-engineer', 'capacity', 'Implementation capacity is limited to two weeks.', 'critical', '2026-08-28T12:02:02Z'),
  ('constraint-engineering-auth', 'demo', 'demo-engineer', 'architecture', 'Do not rewrite authentication.', 'critical', '2026-08-28T12:02:03Z'),
  ('constraint-engineering-dependencies', 'demo', 'demo-engineer', 'reliability', 'Avoid fragile new dependencies.', 'high', '2026-08-28T12:02:04Z'),
  ('constraint-design-accessibility', 'demo', 'demo-designer', 'accessibility', 'Meet accessibility requirements.', 'critical', '2026-08-28T12:02:05Z'),
  ('constraint-design-consistency', 'demo', 'demo-designer', 'consistency', 'Preserve visual and interaction consistency.', 'high', '2026-08-28T12:02:06Z'),
  ('constraint-marketing-date', 'demo', 'demo-marketing', 'timing', 'The campaign date cannot move.', 'critical', '2026-08-28T12:02:07Z'),
  ('constraint-marketing-cutoff', 'demo', 'demo-marketing', 'timing', 'The product surface must stabilize before campaign cutoff.', 'critical', '2026-08-28T12:02:08Z');

insert into public.proposals (
  id, room_id, participant_id, title, summary, rationale, expected_outcomes,
  referenced_constraint_ids, parent_proposal_id, status, created_at
) values (
  'seed-proposal-full-rebuild',
  'demo',
  'demo-product',
  'Full personalized onboarding rebuild',
  'Rebuild onboarding as a custom multi-step flow with new event tracking and expanded personalization before the scheduled campaign launch.',
  'A broad redesign could maximize short-term onboarding gains, but has not yet been reconciled with delivery and accessibility constraints.',
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
insert into public.rooms (id, title, brief, demo_mode, phase, version, created_at)
values ('authorization-fixture', 'Authorization fixture', 'Cross-room test data.', null, 'proposals', 0, '2026-08-28T12:00:00Z');

insert into public.participants (
  id, room_id, name, role, kind, required_for_approval, created_at
) values ('authorization-participant', 'authorization-fixture', 'Fixture', 'Fixture', 'simulation', false, '2026-08-28T12:00:00Z');

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
    'seed-conflict-resolved', 'demo', 'seed-proposal-full-rebuild',
    'constraint-design-consistency', 'system', null, 'warning',
    'Resolved fixture that must not appear in open issues.', 'resolved',
    '2026-08-28T12:04:00Z', '2026-08-28T12:05:00Z'
  ),
  (
    'authorization-conflict', 'authorization-fixture', 'authorization-proposal',
    'authorization-constraint', 'system', null, 'blocking',
    'Cross-room conflict.', 'open', '2026-08-28T12:04:00Z', null
  );
