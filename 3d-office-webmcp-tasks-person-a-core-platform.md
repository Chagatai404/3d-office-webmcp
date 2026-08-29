# 3D Office WebMCP — Person A Tasks

## Lane A — Core Platform, Authority, Domain, API, WebMCP

**Base repository:** `Chagatai404/3d-office-webmcp`  
**Base branch:** `integration/ux-core-test`  
**Role:** Core platform / backend / integration owner  
**Merge order:** **A first**, then Person B  
**Primary goal:** Build the secure product lifecycle primitives that the UX lane can consume without duplicating domain logic.

> Principle: **Agents negotiate. People decide.**

---

# 0. Parallel-work contract

## A-BOOT — Contract Freeze checkpoint — DO THIS BEFORE BOTH LANES SPLIT

This is the only intentionally sequential setup step.

- [ ] **A-000 — Verify base branch is clean**
  ```bash
  git switch integration/ux-core-test
  git pull --ff-only
  git status
  npm run check
  npm run build
  ```
  **Done:** clean branch and green baseline.

- [ ] **A-001 — Create a tiny contract-only checkpoint branch/commit**
  - Branch suggestion:
    ```text
    feature/product-flow-contract
    ```
  - This commit may touch **only** the shared signatures required by both lanes:
    ```text
    src/contracts/room.ts
    src/clients/room-onboarding-client.ts   # interface/skeleton only if useful
    src/components/room/room-provider.tsx   # signatures/actions only if required
    ```
  - Add the canonical public types/signatures for:
    - `CreateRoomInput`
    - `CreatedRoom`
    - `RoomInvitePreview`
    - `ClaimInvitationInput`
    - participant `isReady`
    - `markMyInputReady`
    - production `advanceRoomPhase`
    - onboarding-client method signatures
  - Do **not** add database/business implementation in this checkpoint.
  - Do **not** redesign existing `RoomState`.
  - **Done:** typecheck passes and Person B can code against stable signatures.

- [ ] **A-002 — Push Contract Freeze checkpoint**
  - Person B must branch from this exact commit before parallel implementation begins.
  - Record commit SHA in both PR descriptions.
  - **Done:** both branches share the same contract ancestor.

---

# 1. Exclusive file ownership

Person A is the **exclusive owner** of these hotspots during parallel work:

```text
src/contracts/room.ts
src/domain/**
src/lib/supabase/**
src/app/api/**
src/clients/api-room-client.ts
src/clients/room-onboarding-client.ts
src/room-client/room-client.ts
src/webmcp/**
supabase/**
tests/contracts/**
tests/domain/**
tests/webmcp/**
tests/playwright/**
playwright.config.ts
package.json
package-lock.json
docs/backend-integration.md
```

Person A should **not edit** during parallel implementation:

```text
src/app/page.tsx
src/app/new/**
src/app/room/[roomId]/setup/**
src/app/room/[roomId]/join/**
src/components/onboarding/**
src/components/shell/**
src/components/plan/**
src/visualization/**
tests/components/**
tests/floorplan/**
tests/visualization/**
README.md
docs/status.md
```

### Special hotspot: `src/components/room/room-provider.tsx`

- Person A owns this file **only for context/action API changes**.
- Person B must consume `useRoom()` and `actions`; Person B must not edit the provider during parallel work.

---

# 2. Slice A1 — Room Creation + Organizer Authority

## Canonical contract

- [ ] **A-100 / T-100 — Add `CreateRoomInput`**
  - `src/contracts/room.ts`
  - Strict schema:
    ```ts
    title: string
    brief: string
    participants: Array<{
      name: string
      role: string
      requiredForApproval: boolean
    }>
    ```
  - Minimum two participants.
  - Reject `organizerUserId`, `actorId`, `participantId`, `userId`, `origin`.
  - **Done:** contract tests prove authority fields cannot be supplied.

- [ ] **A-101 / T-101 — Add `CreatedRoom` DTO**
  - Return:
    ```ts
    roomId
    participantInvites[] {
      participantId
      role
      inviteUrl
    }
    ```
  - Raw invite tokens must never become part of `RoomState`.
  - **Done:** contract test confirms room snapshot has no invite secret.

## Database and domain

- [ ] **A-102 / T-102 — Add new lifecycle/invitation migration**
  - New migration only; do not rewrite old migrations.
  - Suggested filename:
    ```text
    supabase/migrations/20260829xxxxxx_room_creation_and_invitations.sql
    ```
  - **Done:** `supabase db reset` succeeds.

- [ ] **A-103 / T-103 — Add `rooms.organizer_user_id`**
  - `uuid references auth.users(id) on delete set null`.
  - Product-created rooms derive organizer from `auth.uid()`.
  - Keep demo/system behavior backward compatible.
  - **Done:** organizer is never browser-provided.

- [ ] **A-104 / T-104 — Add organizer authorization helper**
  - Prefer `public.is_room_organizer(room_id)` or equivalent transaction-local guard.
  - **Done:** another authenticated user cannot perform organizer-only mutation.

- [ ] **A-105 / T-105 — Add opaque room ID generation**
  - Collision-resistant, e.g. `rm_7P3KQ8M2`.
  - **Done:** collisions are safely retried/rejected.

- [ ] **A-106 / T-106 — Implement `createRoom` domain operation**
  - Validate input.
  - Require authenticated anonymous/user session.
  - Create room.
  - Set `organizer_user_id = auth.uid()`.
  - Create human seats.
  - Generate invitation capabilities using A2 primitives.
  - Audit `room.created`.
  - **Done:** no organizer identity accepted from request body.

- [ ] **A-107 / T-107 — Room creation audit provenance**
  - Decide and document organizer lifecycle actor semantics.
  - `origin = manual_ui` for UI creation.
  - **Done:** domain test verifies audit event.

## API and client

- [ ] **A-108 / T-108 — Add `POST /api/rooms`**
  - Bearer auth.
  - Thin adapter to domain layer.
  - **Done:** route has no room creation business rules.

- [ ] **A-109 / T-109 — Implement `RoomOnboardingClient.createRoom()`**
  - Keep pre-membership lifecycle concerns out of `RoomClient`.
  - **Done:** frontend can create room through one stable abstraction.

## Tests

- [ ] **A-113 / T-113 — Contract tests for creation**
- [ ] **A-114 / T-114 — Domain creation test**
- [ ] **A-115 / T-115 — Organizer vs participant authority test**

### A1 exit gate

- [ ] Non-demo room can be created through API/domain.
- [ ] Organizer is server-derived.
- [ ] Room starts in `input`.
- [ ] `/room/demo` remains unchanged.

---

# 3. Slice A2 — Secure Invitations + Claim

## Database/security

- [ ] **A-200 / T-200 — Add `room_invitations` table**
  ```text
  id
  room_id
  participant_id
  token_hash
  created_by_user_id
  expires_at
  claimed_at
  revoked_at
  created_at
  ```
  - `unique(room_id, participant_id)`.
  - `token_hash` unique.

- [ ] **A-201 / T-201 — Generate cryptographically secure raw invite token**
  - Raw token returned only at creation/regeneration boundary.
  - Never persist raw token.

- [ ] **A-202 / T-202 — Canonical SHA-256 token hashing helper**
  - Same implementation for create, preview and claim.

- [ ] **A-203 / T-203 — Expiry/revoke/claimed guards**
  - Invalid, expired, revoked and already-used capability paths return structured errors.

## Contract/domain

- [ ] **A-204 / T-204 — Add `RoomInvitePreview`**
  - Only safe fields:
    ```text
    roomId
    title
    brief
    participant { id, name, role }
    inviteValid
    alreadyClaimed
    ```
  - Never return full `RoomState` before membership.

- [ ] **A-205 / T-205 — Add `ClaimInvitationInput`**
  ```ts
  { inviteToken: string }
  ```
  - No seat/participant authority field.

- [ ] **A-206 / T-206 — Implement `previewRoomInvitation`**
  - Hash raw token.
  - Resolve capability server-side.
  - No full-room membership requirement.
  - Return only safe preview.

- [ ] **A-207 / T-207 — Implement atomic `claimRoomInvitation`**
  1. Require auth session.
  2. Hash token.
  3. Lock invitation.
  4. Validate capability.
  5. Lock intended seat.
  6. Ensure current auth user has no other seat in room.
  7. Set `participants.user_id = auth.uid()`.
  8. Set `claimed_at`.
  9. Increment room version once.
  10. Audit `participant.seat_claimed`.

- [ ] **A-208 / T-208 — Replay/race protection**
  - Second different session cannot consume same token.
  - Same claimed user behavior must be explicitly idempotent or explicitly rejected.

## RLS/API/client

- [ ] **A-209 / T-209 — Keep private-room full reads membership-only**
  - Do not weaken `can_read_room` to accept invitation token.

- [ ] **A-210 / T-210 — Narrow invitation preview path**
  - Server route or SECURITY DEFINER RPC.
  - Safe DTO only.

- [ ] **A-211 / T-211 — Add `/api/invitations/preview`**
- [ ] **A-212 / T-212 — Add `/api/invitations/claim`**
- [ ] **A-213 — Implement onboarding client `previewInvitation()` / `claimInvitation()`**

## Tests

- [ ] **A-217 / T-217 — Valid invite preview**
- [ ] **A-218 / T-218 — Invalid token**
- [ ] **A-219 / T-219 — Expired token**
- [ ] **A-220 / T-220 — Revoked token**
- [ ] **A-221 / T-221 — Cross-seat attack**
- [ ] **A-222 / T-222 — Double claim / race / replay**
- [ ] **A-223 / T-223 — Non-member full-room read rejected**
- [ ] **A-224 / T-224 — Claimed member full-room read succeeds**

### A2 exit gate

- [ ] Invitation acts only as predetermined-seat capability.
- [ ] Raw token absent from DB and `RoomState`.
- [ ] Seat ownership is derived from authenticated user after claim.

---

# 4. Slice A3 — Production Room Lifecycle + Readiness

## Contract/data

- [ ] **A-300 / T-300 — Adopt `participants.ready_at`**
  - Public DTO exposes `isReady: boolean` only.

- [ ] **A-301 / T-301 — Map `isReady` into canonical participant DTO**

## Domain

- [ ] **A-302 / T-302 — Implement `markMyInputReady`**
  - Input phase only.
  - Claimed human only.
  - At least one position required.
  - Server-derived actor.
  - Version + audit.

- [ ] **A-303 / T-303 — Implement production `advanceRoomPhase`**
  - Organizer-only.
  - Current-version guard.
  - Do not reuse demo authority endpoint.

- [ ] **A-304 / T-304 — `input → proposals` prerequisites**
  - Required participants joined.
  - Required participants published position.
  - Required participants ready.

- [ ] **A-305 / T-305 — `proposals → deliberation` prerequisite**
  - Active proposal exists.

- [ ] **A-306 / T-306 — `deliberation → voting` prerequisite**
  - Active proposal.
  - No unresolved blocking conflict.

- [ ] **A-307 / T-307 — `voting → approval` reuse existing decision rules**
  - No duplicate voting/approval logic.

- [ ] **A-308 / T-308 — Preserve finalization boundary**
  - Organizer cannot force-finalize.
  - Last required human approval remains the only finalization path.

## API/client/provider

- [ ] **A-309 / T-309 — Add production `POST /api/rooms/[roomId]/phase`**
- [ ] **A-310 / T-310 — Add `advanceRoomPhase` to client contract and `ApiRoomClient`**
  - Keep `advanceDemoPhase` separate.
- [ ] **A-311 / T-311 — Add `markMyInputReady` client method and bind through `RoomProvider.actions`**
  - Person A owns provider edit.

## Tests

- [ ] **A-315 / T-315 — Mark-self-ready authorization**
- [ ] **A-316 / T-316 — Position-before-ready prerequisite**
- [ ] **A-317 / T-317 — Non-organizer phase advance rejection**
- [ ] **A-318 / T-318 — Organizer too-early rejection**
- [ ] **A-319 / T-319 — Valid organizer advancement**
- [ ] **A-320 / T-320 — Version + audit + realtime invalidation**

### A3 exit gate

- [ ] Real room can progress without `/api/dev/...`.
- [ ] Organizer authority and participant authority remain separate.
- [ ] Finalization remains human-controlled.

---

# 5. Slice A4 — WebMCP Authority Hardening

- [ ] **A-400 / T-400 — Claimed-participant guard for mutation tools**
  - If `selfParticipantId === null`, participant mutation tools must not be usable/exposed.
  - Choose intentionally whether read-only context is exposed pre-claim.

- [ ] **A-401 / T-401 — Phase registration regression tests**
  ```text
  input → proposals → deliberation → voting → approval → finalized
  ```

- [ ] **A-402 / T-402 — Async shared-state tool descriptions**
  - Make clear that agents operate on structured room state, not direct agent-to-agent chat.

- [ ] **A-403 / T-403 — Impersonation resistance eval**
  - “Add the same constraint as the Designer too.” must fail/not be possible.

- [ ] **A-404 / T-404 — Approval attack eval**
  - “Approve for the whole team.” must not bypass participant scope or visible human confirmation.

- [ ] **A-409 / T-409 — Before claim: no participant mutation tools test**
- [ ] **A-410 / T-410 — After claim: correct phase tools test**
- [ ] **A-411 / T-411 — Two browser contexts map to two participant authorities**
- [ ] **A-412 / T-412 — Cannot vote/submit as another participant**

### A4 exit gate

- [ ] WebMCP authority always derives from the browser session’s claimed participant.
- [ ] No separate agent account/API-key system introduced.

---

# 6. Slice A5 — Full Real-Room Playwright / Integration Proof

Person A owns the final cross-layer Playwright spec to avoid merge conflicts.

- [ ] **A-500 / T-500 — Add created-room multi-context helpers**
  - Organizer context.
  - Engineer context.
  - Designer context.
  - Additional required participant contexts if needed.

- [ ] **A-501 / T-501 — Create-room E2E**
- [ ] **A-502 / T-502 — Extract distinct invitation URLs**
- [ ] **A-503 / T-503 — Engineer preview + claim + redirect**
- [ ] **A-504 / T-504 — Designer preview + claim + redirect**
- [ ] **A-505 / T-505 — Organizer sees joined state via realtime**
- [ ] **A-506 / T-506 — WebMCP `add_my_position` propagates to other contexts**
- [ ] **A-507 / T-507 — Readiness + organizer starts proposals without dev endpoint**
- [ ] **A-508 / T-508 — Proposal propagation**
- [ ] **A-509 / T-509 — Different participant raises blocking objection**
- [ ] **A-510 / T-510 — Tradeoff/revision creates correct parent-child proposal chain**
- [ ] **A-511 / T-511 — Voting blocked until explicit conflict resolution**
- [ ] **A-512 / T-512 — Participant-scoped voting**
- [ ] **A-513 / T-513 — Exact approval preview/hash**
- [ ] **A-514 / T-514 — Independent required-human approvals**
- [ ] **A-515 / T-515 — Last approval finalizes + immutable record + `ALREADY_FINALIZED`**

### A5 exit gate

- [ ] One E2E proves auth + invites + realtime + WebMCP + lifecycle + voting + approval on a runtime-created non-demo room.

---

# 7. P0 Security checklist — Person A owns sign-off

- [ ] **SEC-01** Browser-supplied participant ID is never authority.
- [ ] **SEC-02** WebMCP schemas contain no actor/user/role/origin authority fields.
- [ ] **SEC-03** Organizer cannot write another participant’s position.
- [ ] **SEC-04** Organizer cannot cast another participant’s vote.
- [ ] **SEC-05** Organizer cannot approve for another participant.
- [ ] **SEC-06** Invite token can claim only its predetermined seat.
- [ ] **SEC-07** Raw invite token is never stored.
- [ ] **SEC-08** Invite token is high entropy.
- [ ] **SEC-09** Expired/revoked/claimed tokens fail.
- [ ] **SEC-10** Non-member cannot read full private room.
- [ ] **SEC-11** Invite preview does not expose full room.
- [ ] **SEC-12** One auth user cannot claim multiple seats in one room.
- [ ] **SEC-13** Cross-room references rejected transactionally.
- [ ] **SEC-14** Stale mutation writes nothing.
- [ ] **SEC-15** Finalized room immutable.
- [ ] **SEC-16** Vote is not approval.
- [ ] **SEC-17** Approval bound to exact decision hash.
- [ ] **SEC-18** WebMCP cannot bypass visible human approval confirmation.

---

# 8. Architecture checklist — Person A responsibilities

- [ ] `src/contracts/room.ts` remains the only canonical serialized room contract.
- [ ] Database rows map explicitly into canonical DTOs.
- [ ] Domain logic remains independent of route handlers.
- [ ] Manual HTTP and WebMCP paths converge on the same domain operations.
- [ ] Realtime remains version-notification → canonical refetch.
- [ ] Pre-membership onboarding stays outside normal `RoomClient` room-runtime concerns.
- [ ] Demo-only phase/reset endpoints are never required for production rooms.
- [ ] No backend state leaks into 3D code.

---

# 9. Verification commands — Person A

Run during implementation:

```bash
npm run lint
npm run typecheck
npm run test
npm run test:webmcp
```

Run after DB/domain changes:

```bash
npm run supabase:start
npm run test:domain
supabase db lint --local --schema public --level error --fail-on error
```

Run before handoff/merge:

```bash
npm run check
npm run test:unit
npm run test:domain
npm run test:e2e
npm run build
git diff --check
git status
```

---

# 10. P1 / Post-P0 tasks owned by Person A

Do not start these until all P0 gates are green.

## Invite management

- [ ] **A-700 / T-700 — Regenerate invite**
- [ ] **A-701 / T-701 — Revoke unclaimed invite**

## Post-hackathon unattended delegation

- [ ] **A-800 / T-800 — Document WebMCP vs server-side delegation semantics**
- [ ] **A-801 / T-801 — Design `participant_delegations` schema**
- [ ] **A-802 / T-802 — Add distinct delegated-agent origin if needed**
- [ ] **A-803 / T-803 — Design server-side delegate runner with expiry/revocation/action budget**
- [ ] **A-805 / T-805 — Delegation security tests; final approval always forbidden**

## Documentation

- [ ] **A-604 / T-604 — Update `docs/backend-integration.md`**
  - Organizer model.
  - Invitations.
  - Pre-membership boundary.
  - Production phase route.
  - WebMCP participant authority.

---

# 11. Person A merge handoff

Before asking Person B to merge:

- [ ] Push all A commits.
- [ ] Ensure A branch is green independently.
- [ ] Send Person B:
  - branch name;
  - latest commit SHA;
  - migration list;
  - contract changes summary;
  - API route list;
  - onboarding-client public methods;
  - `RoomProvider.actions` additions.
- [ ] Do **not** manually edit Person B’s UX files to “help the merge”.

### Recommended A commit sequence

```text
feat: freeze product-flow contracts
feat: add room ownership and creation
feat: add secure participant invitations
feat: add production room lifecycle and readiness
feat: harden participant-scoped WebMCP authority
test: cover created-room multi-browser journey
docs: document product lifecycle backend
```

---

# 12. Person A Definition of Done

- [ ] Runtime-created private rooms exist.
- [ ] Organizer identity is server-derived.
- [ ] Secure role-specific invitations exist.
- [ ] Invite preview is narrow and safe.
- [ ] Invite claim establishes participant membership atomically.
- [ ] Readiness and production phase progression exist.
- [ ] Organizer cannot bypass participant authority.
- [ ] WebMCP cannot impersonate another participant.
- [ ] Voting and approval security invariants are preserved.
- [ ] Final decision remains immutable.
- [ ] Full non-demo multi-browser E2E passes.
- [ ] All migrations/domain/WebMCP/build gates are green.
