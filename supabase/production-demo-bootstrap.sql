-- Production-safe bootstrap/restore for the canonical `/room/demo` fixture.
--
-- WHY THIS FILE EXISTS
-- `supabase db push` only applies schema migrations; it never runs
-- `supabase/seed.sql` against a hosted project (only `supabase db reset`
-- does that, and only against the local stack). After migrations are current
-- on a hosted Supabase project, `/room/demo` therefore has no row at all
-- until something inserts one. `supabase/seed.sql` cannot be that something
-- run wholesale: alongside the canonical demo fixture it also creates
-- test-only cross-room fixtures (`authorization-fixture`,
-- `authorization-participant`, `authorization-proposal`, and the associated
-- fixture constraint/conflict) that exist purely to prove authorization
-- boundaries in tests/domain/*.test.ts and must never exist in a real
-- deployment.
--
-- WHAT THIS SCRIPT DOES
-- 1. If (and only if) no room with id = 'demo' exists yet, inserts the
--    minimal `rooms` row needed to make it addressable. This mirrors
--    exactly the shape `supabase/seed.sql` uses for the same row. The
--    `owner_participant_id` foreign key
--    (`rooms_owner_participant_fk`) is `deferrable initially deferred`, so
--    pointing it at `'demo-product'` here -- before that participant row
--    exists -- is safe: the constraint is only checked at COMMIT, by which
--    point step 2 has created that participant.
-- 2. Delegates everything else -- participants, constraints, the seed
--    proposal, phase, decision policy -- to the exact same
--    `start_demo_scenario('demo', 'solo_judge', 'product')` database
--    function already used by the judge-facing `POST /api/demo/reset`
--    route and by `supabase/seed.sql`'s own comment describing that
--    equivalence. There is no second demo implementation here: this file
--    only ever adds the one row that function needs to find before it can
--    run, then calls it.
--
-- SAFETY / SCOPE
-- - Every statement below is hard-scoped to the literal room id 'demo'.
--   Nothing here accepts a parameter, reads an argument, or loops over
--   rooms -- there is no arbitrary-room-id surface to misuse.
-- - No test-only fixture (authorization-fixture and friends) is created,
--   modified, or referenced.
-- - No other room, of any id, is read or written.
-- - Idempotent: safe to run against a database that already has a `demo`
--   room (in any phase, including finalized, and regardless of whether the
--   founder seat has been claimed) -- rerunning always restores the same
--   canonical initial solo-judge state, exactly like clicking "Reset demo"
--   in the app.
--
-- USAGE
-- See docs/remote-env.md's "Production demo bootstrap" section for the
-- exact command and prerequisites. In short:
--
--   psql "$REMOTE_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/production-demo-bootstrap.sql
--
-- using the project's direct/session Postgres connection string (the
-- `postgres` role), never a value committed to this repo.

begin;

-- Step 1: create the minimal 'demo' room row only if it does not exist yet.
-- Every column below is set to the same value `start_demo_scenario` would
-- set it to anyway; the insert exists solely so the function below has a
-- row to find and update instead of failing with "Demo room not found."
do $bootstrap_room$
begin
  if not exists (select 1 from public.rooms where id = 'demo') then
    insert into public.rooms (
      id, title, brief, demo_mode, phase, version, owner_participant_id,
      decision_policy, is_locked, created_at
    ) values (
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
  end if;
end;
$bootstrap_room$;

-- Step 2: delegate to the canonical, already-audited reset function. This
-- is the exact same call the judge-facing "Reset demo" route makes.
do $bootstrap_scenario$
declare
  result jsonb;
begin
  result := public.start_demo_scenario('demo', 'solo_judge', 'product');
  if not coalesce((result ->> 'ok')::boolean, false) then
    raise exception 'production-demo-bootstrap: start_demo_scenario did not succeed: %', result;
  end if;
end;
$bootstrap_scenario$;

commit;
