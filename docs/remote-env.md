# Remote Env Setup

Use your `3d-office-webmcp` Supabase project.

```text
Project: 3d-office-webmcp
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

## Test

1. Open the app.
2. Create a room.
3. Join from another browser.
4. Check both browsers update.
5. Make a decision.
