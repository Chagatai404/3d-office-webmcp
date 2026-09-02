# Remote Env Setup

Use your `quorum` Supabase project.

```text
Project: quorum
Project ref: PASTE_YOUR_PROJECT_REF
URL: https://PASTE_YOUR_PROJECT_REF.supabase.co
```

## Env Vars

Add these to Vercel, or to `.env.local` for local testing:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://PASTE_YOUR_PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=PASTE_FROM_SUPABASE
SUPABASE_SERVICE_ROLE_KEY=PASTE_FROM_SUPABASE
NEXT_PUBLIC_APP_URL=PASTE_YOUR_APP_URL
ALLOW_DEMO_PHASE_TRANSITIONS=false
ALLOW_DEMO_RESET=false
```

For local testing:

```bash
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

## Where To Get Keys

In Supabase:

```text
Project Settings -> API
```

Copy:

- Project URL
- Publishable key, or anon public key
- Service role key
- Project ref, from the project URL or dashboard settings

Never share the service role key.

## Auth Setting

In Supabase:

```text
Authentication -> Sign In / Providers
```

Turn on:

```text
Anonymous sign-ins
```

Then go to:

```text
Authentication -> URL Configuration
```

Set:

```text
Site URL: your app URL
Redirect URL: your app URL
```

For local testing, also add:

```text
http://localhost:3000
http://localhost:3000/**
```

## Database Password

Use the database password only for Supabase CLI setup.

Do not put it in Vercel, `.env.local`, or this repo.

CLI setup:

```bash
npx supabase login
npx supabase link --project-ref PASTE_YOUR_PROJECT_REF
npx supabase db push
```

## Production demo bootstrap

`supabase db push` only applies schema migrations. It never runs
`supabase/seed.sql` against a hosted project -- only `supabase db reset` does
that, and only against your local stack. So after `db push`, a hosted
project has the current schema but no `/room/demo` fixture yet: the room
simply does not exist until something inserts it.

`supabase/seed.sql` itself must **never** be run against the hosted project:
alongside the canonical demo fixture it also creates test-only cross-room
fixtures (`authorization-fixture`, `authorization-participant`,
`authorization-proposal`) that exist only for `tests/domain/*.test.ts` and
have no place in a real deployment.

Instead, apply the dedicated, demo-only, production-safe script:

```bash
psql "$REMOTE_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/production-demo-bootstrap.sql
```

`REMOTE_DATABASE_URL` is the project's direct/session Postgres connection
string, from Supabase: `Project Settings -> Database -> Connection string`
(the `postgres` role). Export it in your own shell only for the duration of
this command -- never commit it, never put it in Vercel env vars, and never
add it to `.env.local`.

What that script does, and why it is safe:

- It is hard-scoped to the literal room id `'demo'`. It never accepts a room
  id parameter and never loops over rooms, so there is no arbitrary-room-id
  surface to misuse.
- If (and only if) no `demo` room exists yet, it inserts the one minimal
  `rooms` row needed to make it addressable -- the same row shape
  `supabase/seed.sql` uses.
- It then delegates everything else (participants, constraints, the seed
  proposal, phase, decision policy) to the exact same
  `start_demo_scenario('demo', 'solo_judge', 'product')` database function
  the judge-facing **Reset demo** button already calls
  (`POST /api/demo/reset`). There is no second demo implementation.
- It creates no test-only fixture and never touches any other room.
- It is idempotent: safe to run whether `demo` is missing, already seeded,
  mid-run, or finalized. Rerunning always restores the same canonical
  initial solo-judge state.

This step is separate from, and does not replace:

- `supabase db push` (schema migrations only)
- the Vercel deployment itself
- a local `supabase db reset` (which already runs `supabase/seed.sql`, so
  local `/room/demo` needs no separate bootstrap step)

### Production checklist

1. Hosted anonymous auth enabled (`Authentication -> Sign In / Providers ->
   Anonymous sign-ins`, see "Auth Setting" above).
2. Migrations current (`npx supabase db push`).
3. Vercel env vars set (see "Env Vars" above).
4. Demo bootstrap applied (`psql "$REMOTE_DATABASE_URL" -v ON_ERROR_STOP=1
   -f supabase/production-demo-bootstrap.sql`).
5. `/room/demo` opened and tested in a fresh incognito window.
6. **Reset demo** tested from the Help drawer.

## Test

1. Open the app.
2. Create a room.
3. Join from another browser.
4. Check both browsers update.
5. Make a decision.
