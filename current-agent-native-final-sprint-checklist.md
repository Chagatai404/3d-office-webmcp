# Current Agent-Native Final Sprint Checklist

> **Execution source of truth for the remaining hackathon work**
>
> This checklist is intentionally based on the current `main` branch and the live two-agent test feedback.
>
> **Do not delete or replace the earlier repository checklist.** Keep updating the earlier checklist/status documents after each merged slice for historical/completeness tracking, but **use this file for day-to-day execution order, ownership, and merge decisions.**

---

## 0. Operating Rules

### Current base

Both developers branch from the latest `origin/main`.

```bash
git switch main
git pull origin main
git status
git rev-parse HEAD
```

Record the shared base SHA here before starting:

- [x] `BASE_SHA = 67972adca6a8c154383a09494b064c19d493a40e` (matches `origin/main` at the time this slice started)

At the time this plan was created, `main` already contained:

- Slice 1 reliability/access-loss cleanup.
- Production-safe `supabase/production-demo-bootstrap.sql`.
- Current room authority / alignment / Security Expert / WebMCP infrastructure.

Do **not** reimplement those pieces.

### Branches

Developer A — protocol/backend:

```bash
git switch main
git pull origin main
git switch -c feature/agent-protocol-core
```

Developer B — UX/3D:

```bash
git switch main
git pull origin main
git switch -c feature/agent-first-ux
```

- [x] Developer A branch created from the recorded `BASE_SHA`. (This slice runs on `final-steps-branch-a`, not `feature/agent-protocol-core` -- it was already checked out at exactly `BASE_SHA` when work started, so it satisfies the same constraint under a different name.)
- [ ] Developer B branch created from the same `BASE_SHA`.
- [ ] Neither feature branch is created from the other feature branch.

---

# 1. Non-Negotiable Ownership Boundaries

These boundaries exist to keep the branches mergeable.

## Developer A — `feature/agent-protocol-core`

Developer A owns protocol, authority, canonical state, backend, WebMCP, deployment/backend integration, and report generation.

### A-exclusive paths

Developer B must not modify these while parallel work is active:

```text
src/contracts/**
src/domain/**
src/webmcp/**
src/clients/**
src/lib/supabase/**
src/app/api/**
supabase/**
src/components/room/room-provider.tsx
tests/contracts/**
tests/domain/**
tests/webmcp/**
tests/room-client/**
package.json
package-lock.json
```

Developer A is the **only** developer who changes:

```text
src/contracts/room.ts
```

No duplicate shared DTOs may be created in UI code.

## Developer B — `feature/agent-first-ux`

Developer B owns the visible meeting experience, layout, drawers, 3D projection, manual interaction simplification, and presentation of canonical room state.

### B-exclusive paths

Developer A should avoid these unless an integration bug absolutely requires a coordinated change:

```text
src/components/shell/**
src/visualization/**
UI-only meeting workspace components
UI-only participant/drawer components
global/component styling
UI animation / camera behavior
UI-specific component tests
```

Developer B may modify non-API room pages/components when needed for presentation, but must not introduce new backend/domain types there.

## Shared-file rule

- [ ] If a file is not clearly owned above, the first developer who needs it announces/records ownership before editing it.
- [ ] Do not both edit the same shared file in parallel.
- [ ] `package.json` and the lock file stay Developer A-owned because PDF generation may require a dependency.
- [ ] `room-provider.tsx` stays Developer A-owned because new RoomClient actions/tool state may flow through it.
- [ ] Developer B consumes canonical state and actions; Developer B does not invent temporary backend types.

## Checklist/documentation rule

To avoid documentation merge conflicts:

- [ ] Do **not** have both branches edit this checklist concurrently.
- [ ] Do **not** have both branches edit the earlier master checklist concurrently.
- [ ] Keep branch-local notes while implementing.
- [ ] After a feature branch is merged to `main`, one designated integrator updates:
  - this checklist;
  - the earlier repository checklist;
  - `docs/status.md` or equivalent status documentation.

Designated checklist/status integrator:

- [ ] `Integrator = ______________________________`

---

# 2. Product Rules We Are Implementing

These rules are the acceptance criteria for architecture decisions.

- [ ] Every legitimate normal meeting action has a discoverable WebMCP capability.
- [ ] Agents should not need DOM inspection or visual wandering to understand meeting state.
- [ ] Phase restrictions should normally govern **execution**, not hide the existence of normal collaboration tools.
- [ ] Role/authority restrictions are used only where the action genuinely requires authority.
- [ ] Administrative authority and decision authority remain separate.
- [ ] Final approval remains intentionally human-confirmed.
- [ ] Agents can determine who is still working, what changed, and what they should do next.
- [ ] Participants receive explicit human-readable roles and explicit decision authority.
- [ ] The judge leads the demo; the demo is not dependent on one memorized prompt script.
- [ ] Finalized meetings produce one canonical report available to every participant.
- [ ] The canonical final report is exportable as PDF.
- [ ] Manual UI remains usable, but agent-first interaction is the preferred path.
- [ ] 3D remains a projection of canonical room state, never a second state system.

---

# 3. P0 — Production Demo Operational Gate

**Owner: Developer A**

The code for the production-safe bootstrap already exists on current `main`.

Do not create another bootstrap implementation.

## Hosted Supabase/Vercel configuration

- [ ] Hosted Supabase anonymous sign-ins are enabled. (No tool available to me confirms this Auth setting directly -- confirm in the Supabase dashboard, or it will show up as a failure in the browser smoke test below.)
- [x] Hosted Supabase migrations are current. (Verified via the Supabase MCP: `list_migrations` on the hosted `quoram` project (`ijujoenmxkrynexbxzcm`) returns exactly the same 13 versions/names as `supabase/migrations/*.sql` on disk, in order, nothing missing or extra.)
- [ ] Vercel `NEXT_PUBLIC_SUPABASE_URL` points to the intended hosted Supabase project. (No Vercel tool available to me lists env var values -- confirm in the Vercel dashboard for project `3d-office-webmcp` / team `ca-tech1`.)
- [ ] Vercel `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` matches that project. (Same limitation.)
- [ ] Vercel `SUPABASE_SERVICE_ROLE_KEY` is present and server-only. (Same limitation for presence; server-only *usage* is independently confirmed by code -- see below.)
- [ ] Vercel `NEXT_PUBLIC_APP_URL` is the deployed application origin. (Same limitation.)
- [x] No service-role/database secret is exposed through `NEXT_PUBLIC_*`. (Confirmed at the code level: `SUPABASE_SERVICE_ROLE_KEY` is read only in `src/lib/supabase/server.ts`, a server-only module never bundled to the browser; grep confirms no `NEXT_PUBLIC_*`-prefixed service-role/secret variable exists anywhere in `src/`. This does not rule out a stray extra env var being set in the Vercel dashboard itself, which only a human with dashboard access can confirm.)

## Apply the existing production demo bootstrap

Use the already-committed file:

```text
supabase/production-demo-bootstrap.sql
```

**Applied 2026-08-31, via the Supabase MCP's `execute_sql` against the hosted `quoram` project (`ijujoenmxkrynexbxzcm`) rather than `psql`/`REMOTE_DATABASE_URL`** -- an already-authenticated equivalent path to the same file content, run verbatim (the `begin`/`do $$...$$`/`commit` body unchanged), scoped to the same literal room id `'demo'`, with no schema/migration side effects. `REMOTE_DATABASE_URL` was never needed or handled.

- [x] `REMOTE_DATABASE_URL` was supplied only in the operator shell. (N/A this run -- not used; see above.)
- [x] `REMOTE_DATABASE_URL` was not committed. (N/A this run -- not used.)
- [x] Full `supabase/seed.sql` was **not** run against hosted production. (Only the bootstrap file's own content was executed.)
- [x] Production demo bootstrap completed successfully. (Verified immediately after: `select * from rooms where id = 'demo'` and the participants query both return the expected seeded state -- see next section.)

## Hosted smoke test

Use a fresh/incognito browser. **Everything below needs an actual browser and could not be verified through the tools available to me; the two items marked `[x]` were instead confirmed by direct read-only SQL against the hosted project immediately after applying the bootstrap, as the closest available proxy.**

- [ ] `/room/demo` loads.
- [ ] Anonymous session succeeds.
- [ ] Founder/Product Lead seat is claimed.
- [x] Engineer simulation is present. (DB: `demo-engineer`, `kind: simulation`, active.)
- [x] Product Designer simulation is present. (DB: `demo-designer`, `kind: simulation`, active.)
- [x] Growth simulation is present. (DB: `demo-marketing` / "Growth Lead", `kind: simulation`, active.)
- [x] Security Expert is present as advisory/expert. (DB: `demo-security`, `kind: expert`, `decision_role: advisor`, active.)
- [ ] WebMCP meeting tools register.
- [ ] Reset Demo works.
- [ ] Reset returns the demo to a clean initial state.
- [ ] Normal room creation still works.
- [ ] A second fresh browser can request admission.
- [ ] Owner can admit the second browser.
- [ ] Realtime updates are observed by both browsers.

### If `/room/demo` still fails

Inspect the request to:

```text
GET /api/rooms/demo
```

Record:

- [ ] HTTP status: `________`
- [ ] Server log/error: `____________________________________________`

Interpret before modifying more code:

```text
401       -> auth/session/config issue
403/404   -> room fixture/read/claim/RLS issue
500       -> server env/repository/runtime issue
200       -> frontend parsing/client/render issue
```

### P0 exit gate

- [ ] Hosted demo works from fresh incognito. (Blocking gap fixed -- the demo room now exists and is correctly seeded -- but the actual page load/WebMCP-registration/realtime behavior still needs a human with a real browser.)
- [ ] Reset works. (Needs the browser pass above; the underlying `start_demo_scenario` function this reuses was exercised successfully by the bootstrap itself.)
- [ ] Normal create/join/realtime works. (Unaffected by this change -- not independently re-verified this session.)
- [x] No new production bootstrap implementation was created. (Ran the existing `supabase/production-demo-bootstrap.sql` verbatim; nothing new was written.)

---

# 4. Developer A — Agent Protocol/Core Checklist

---

## A1 — Complete and Stable WebMCP Capability Coverage

### Goal

A participant's agent should discover the meeting protocol through WebMCP immediately, without inspecting the website.

### Tool-discovery behavior

- [x] Audit every legitimate meeting action and map it to a WebMCP tool. (Every `RoomProvider` action now has a registered tool; `mark_my_input_ready` was the one gap -- see below.)
- [x] Normal collaboration tools are not unnecessarily hidden merely because the current phase is different. (Unchanged from existing design -- each participant tool is gated only by its own phase, not by an unrelated one.)
- [x] Calling a normal tool in the wrong phase returns a structured refusal explaining the current phase and next requirement. (Pre-existing `WRONG_PHASE`/`STALE_ROOM_STATE` refusals via `prepareMutation`; unchanged.)
- [x] Truly privileged tools remain authority-gated. (Unchanged.)
- [x] Tool descriptions clearly tell the agent when/why to use each capability. (Verified against the existing catalog; `mark_my_input_ready`'s new description follows the same pattern.)
- [x] Tool descriptions do not require the agent to inspect DOM/UI state. (Unchanged.)

### Missing readiness tool

Implement:

```text
mark_my_input_ready
```

- [x] Tool is discoverable to active claimed human participants. (`asClaimedInPhase("input")` in `src/webmcp/capability-context.ts`.)
- [x] Tool calls the same canonical operation as the existing visible readiness UI. (Calls `markMyInputReady` from `src/domain/rooms/operations.ts`, the same operation the manual "Ready" control and `POST /api/rooms/:roomId/ready` use.)
- [x] Tool cannot mark another participant ready. (No input schema at all -- the acting seat is derived server-side from `auth.uid()`.)
- [x] Server-side actor identity still derives from authenticated session. (Unchanged SQL function.)
- [x] Tool returns the resulting room version. (Via the shared `executeToolSafely`/`ActionResult` wrapper, same as every other tool.)

### Final approval tool naming

Expose the participant-facing capability as:

```text
approve_final_decision
```

The tool must **not** autonomously approve.

Required flow:

```text
agent calls approve_final_decision
        ↓
validate caller is required decision approver
validate exact decision hash
        ↓
open/prepare Decision confirmation surface
        ↓
return HUMAN_CONFIRMATION_REQUIRED
        ↓
human reviews and confirms visibly
```

- [x] Existing autonomous approval bypass does not exist. (Unchanged: the tool still only ever returns `HUMAN_CONFIRMATION_REQUIRED`.)
- [x] Human confirmation remains required. (Unchanged.)
- [x] Tool is available only to a legitimate required approver. (Unchanged `isRequiredApprover` gate, just renamed.)
- [x] Old overlapping WebMCP name is removed/aliased in a way that does not create duplicate confusing tools. (`request_final_decision_confirmation` renamed in place to `approve_final_decision` everywhere -- tool definition, capability table, tests, evals, Playwright spec, docs. No alias, no duplicate.)
- [x] Tests explicitly prove the agent cannot complete human confirmation itself. (Pre-existing `participant-authority.test.ts` coverage -- "never asks the domain to treat a WebMCP call as human-confirmed", "opens the Decision workspace when requesting final decision confirmation" -- carried over under the new name.)

### A1 tests

- [x] Capability-matrix unit tests updated. (`tests/webmcp/registration.test.ts`.)
- [x] Tool-catalog tests updated. (`tests/webmcp/registration.test.ts`, `tests/webmcp/prompt-injection.test.ts`, `tests/webmcp/tool-selection-evals.test.ts`, `tests/webmcp-evals/tool-selection.json`.)
- [x] `mark_my_input_ready` WebMCP test added. (Registration/lifecycle coverage in `registration.test.ts`; authority/wiring coverage in `participant-authority.test.ts`; a discovery eval in `tool-selection.json`.)
- [x] `approve_final_decision` human-gate test added. (Existing human-gate tests preserved under the new name; no behavior change.)
- [x] Stale captured tool references still fail server-side after authority/phase changes. (Generic `participant-authority.test.ts` proof -- "forwards a domain refusal unchanged" -- covers every tool including the two touched here; unchanged mechanism.)

### A1 exit gate

- [ ] A real browser agent can discover how to share input, mark ready, propose, deliberate, align, review, and request final approval from WebMCP alone. (Structurally true; requires the manual Chrome WebMCP inspector pass in `docs/webmcp-demo.md` to confirm.)
- [ ] No DOM inspection is necessary to discover those actions. (Same -- pending the manual pass above.)

---

## A2 — Canonical Coordination Status

Implement a universal read tool:

```text
get_coordination_status
```

### Required response semantics

Every response should contain enough information for an agent to answer:

```text
Where are we?
What is this phase trying to accomplish?
What have I completed?
Who/what are we waiting for?
Can the meeting advance?
What should I do next?
```

### Input phase

- [x] Phase goal included. (`phaseGoal`.)
- [x] Each active human's readiness included. (`input.readiness[]`.)
- [x] Whether each participant has shared input is included. (`readiness[].hasSharedInput`.)
- [x] `waitingFor` identifies participants not ready.
- [x] `canAdvance` is derived canonically. (Mirrors `advance_room_phase`'s exact joined/positioned/ready prerequisites for the `input -> proposals` transition -- see `supabase/migrations/20260830120000_owner_lifecycle_and_meeting_lock.sql`.)
- [x] Recommended next action is explicit.

### Proposals phase

- [x] Active/candidate proposal status included. (`proposals.hasActiveProposal`, `activeProposalId`, `activeProposalTitle`.)
- [x] Who proposed the current option is included. (`proposals.proposedByParticipantId`.)
- [x] Whether the phase has enough state to advance is included. (`canAdvance` = `hasActiveProposal`, matching the DB's only real gate for this transition.)

### Deliberation phase

- [x] Blocking concern count included. (`deliberation.blockingCount`.)
- [x] Warning count included. (`deliberation.warningCount`.)
- [x] Concern ownership/raiser included. (`deliberation.openConflicts[].raisedByName`/`raisedByActorId`/`raisedByActorType`.)
- [x] `canAdvance` reflects unresolved blockers. (`blockingCount === 0`.)

### Alignment phase

- [x] Every active human is represented. (`alignment.alignment[]`, one entry per active human.)
- [x] Shared/not-shared alignment status is explicit. (`alignment[].shared`.)
- [x] Current alignment choice is included when shared. (`alignment[].choice`.)
- [x] Missing alignments are explicit. (`alignment.missingParticipantIds`, also surfaced in `waitingFor`.) Note: per the product rule that alignment is informative and never mechanically gates a transition, `canAdvance` here is **not** false just because alignment is missing -- it mirrors `apply_room_phase_entry`'s real `voting -> approval` gate (active proposal, no open blocking conflict). `waitingFor` still names who hasn't shared, and `recommendedNextAction` says explicitly that this is a recommendation, not a hard block.

### Approval phase

- [x] Frozen decision hash included. (`approval.decisionHash`.)
- [x] Required approvers included. (`approval.requiredApproverIds`.)
- [x] Completed approvers included. (`approval.completedApproverIds`.)
- [x] Missing approvers included. (`approval.missingApproverIds`, also in `waitingFor` by name.)
- [x] Human-confirmation requirement is explicit. (`approval.humanConfirmationRequired: true`, always.)

### A2 tests

- [x] Coordination status tests for every phase. (`tests/webmcp/coordination.test.ts`.)
- [x] Multi-participant readiness test.
- [x] Missing alignment test.
- [x] Missing approval test.
- [x] Removed participants do not count as pending work. (Explicit test; `activeHumans()` filters `status === "active"`.)

### A2 exit gate

- [x] An agent can always answer "what are we waiting for?" using one WebMCP read. (`get_coordination_status`, available in every phase incl. before a seat is claimed.)
- [ ] An agent never needs to navigate the 3D scene to determine whether the meeting advanced. (Structurally true; pending the same manual Chrome WebMCP inspector pass noted under A1.)

---

## A3 — Incremental Shared Awareness

Implement:

```text
get_room_updates
```

Input:

```json
{
  "sinceVersion": 27
}
```

### Required change coverage

Return relevant canonical changes after the supplied observed room version:

- [x] participant joined/admitted; (`participant_joined` from `participant.seat_claimed`, `participant_admitted` from `join.admitted`.)
- [x] participant removed; (`participant_removed` from `participant.removed`.)
- [ ] role changed; (No such mutation exists in the codebase yet -- there is no operation that changes a human-readable `role` like "CTO" after admission. Nothing to map today; `ACTION_TYPE` in `src/domain/rooms/room-updates.ts` will need one row added once A6 introduces that operation. `decisionRole` changes, the other half of "role," are fully covered below.)
- [x] decision authority changed; (`decision_role_changed` from `participant.decision_role_changed`; ownership transfer also covered as `ownership_transferred`.)
- [x] input/position shared; (`input_shared` from `position.added`.)
- [x] readiness changed; (`readiness_changed` from `participant.input_ready`.)
- [x] proposal created; (`proposal_submitted` from `proposal.submitted`.)
- [ ] proposal revised/superseded; (A revised proposal from `respond_to_concern` is created as a new `proposal.submitted` row referencing the original via `parentProposalId` -- it surfaces as another `proposal_submitted` update, and `tradeoff_proposed` covers the trade-off half of the same action. There is no distinct "superseded" audit action in the schema to project separately; left open rather than claiming coverage that does not exist.)
- [x] concern raised; (`concern_raised` from `objection.raised`.)
- [x] concern resolved; (`concern_resolved` from `conflict.resolved`.)
- [x] trade-off created; (`tradeoff_proposed` from `tradeoff.proposed`.)
- [x] alignment changed; (`alignment_changed` from `alignment.expressed`/`alignment.updated`.)
- [x] phase changed; (`phase_changed` from `room.phase_advanced`/`demo.phase_advanced`.)
- [x] Security Expert finding raised/resolved/dispositioned; (`expert_finding_raised`/`expert_finding_resolved`/`expert_finding_dispositioned`.)
- [x] decision candidate frozen; (Carried on the same `phase_changed` update that enters `approval` -- `decisionHash` is populated from that event's own `result.decisionHash`, matching exactly what `apply_room_phase_entry` froze; not a separate audit action, so not a separate update type.)
- [x] approval recorded; (`approval_recorded` from `approval.recorded`.)
- [x] meeting finalized. (`meeting_finalized` from `decision.finalized`.)

### Implementation constraints

- [x] Use existing canonical room version/audit history. (`RoomState.activity`, already backed by `public.audit_events` -- no new table or column.)
- [x] Do not create a second event store. (Confirmed: `computeRoomUpdates` only filters/labels `room.activity`.)
- [x] Returned participant-authored text remains identified as untrusted room content. (Whole tool marked `untrustedContentHint: true`, same convention as `get_alignment`/`get_current_decision`/`get_waiting_participants`.)
- [x] Tool returns current room version. (`data.currentRoomVersion` and the wrapper's own `roomVersion`.)
- [x] Tool clearly indicates when no new updates exist. (`updateCount: 0`, `updates: []`, and an explicit "No new updates since version N." message.)

### Optional if time permits

Implement a bounded:

```text
wait_for_room_change
```

- [ ] **Deferred.** Not implemented in this slice. The checklist's own cut list (§14) lists this as the first thing to cut if time is short, and it needs either an injectable clock/poll interval or a live Supabase stack to test correctly (a real multi-second `sleep` loop is not something to leave un-unit-tested) -- both are a reasonable follow-up, not a blocker for A3's exit gate below, which does not depend on it.

### A3 exit gate

- [x] Agent A acts and records room version. (Demonstrated in `tests/webmcp/room-updates.test.ts`'s "returns Agent B's relevant change to Agent A" test.)
- [x] Agent B acts.
- [x] Agent A requests updates since its previous version. (`get_room_updates` with `sinceVersion`.)
- [x] Agent A receives Agent B's relevant changes without DOM inspection. (Verified in the same test; broader manual two-agent verification still pending the live gate in §10.)

---

## A4 — Correct Authority Gating

### Product distinction

```text
Meeting administration != meeting progression != decision authority
```

### Any active claimed human may initiate procedural progression

Review and update server/domain authorization for:

```text
advance_discussion
request_team_alignment
```

- [x] These actions are not owner-only merely because they progress the workflow. (`advance_room_phase` now derives the caller's own participant row and only requires `decision_role = decision_maker` for the `voting -> approval` transition; every other transition just requires an active claimed human. `supabase/migrations/20260831120000_procedural_progression_authority.sql`.)
- [x] Canonical prerequisites still determine success. (The joined/positioned/ready count checks before `proposals`, the active-proposal check before `deliberation`, and `apply_room_phase_entry`'s active-proposal/no-blocking-conflict checks before `voting`/`approval` are byte-for-byte unchanged -- only the authorization gate above them changed.)
- [x] No participant can bypass missing readiness/blockers/alignment. (Same prerequisite checks; proven in `tests/domain/procedural-progression-authority.test.ts`'s "refuses Proposals -> Deliberation without an active proposal even for a legitimate caller.")
- [x] Actor identity remains authenticated and auditable. (`room.phase_advanced` audit events are still attributed to the real caller's own participant id, not the owner's -- proven in "attributes the phase-advance audit event to the calling contributor, not the owner.")

### Decision-maker actions

`decisionRole = decision_maker` should control legitimate decision-review authority.

- [x] `review_final_decision` is allowed to an active legitimate decision maker when prerequisites are satisfied. (Both at the DB layer -- `actor_decision_role <> 'decision_maker'` refusal -- and the WebMCP capability layer -- `capability-context.ts`'s `review_final_decision` predicate now checks `decisionRole === "decision_maker"` instead of `isOwner`.)
- [x] `approve_final_decision` is available only when caller is a required approver for the frozen candidate. (Unchanged from A1 -- `isRequiredApprover` gate.)
- [x] Final approval still requires visible human confirmation. (Unchanged -- `HUMAN_CONFIRMATION_REQUIRED` flow untouched by this slice.)

### Keep genuine owner administration owner-only

- [x] `get_waiting_participants`
- [x] `admit_participant`
- [x] `reject_participant`
- [x] `lock_meeting`
- [x] `unlock_meeting`
- [x] `remove_participant`
- [x] `transfer_ownership`
- [x] decision-policy mutation (`set_decision_policy`)
- [x] participant authority/role assignment (`set_participant_decision_role`)
- [x] enabling the organizational specialist/Security Expert (`enable_security_expert`)

(All ten still use `is_room_organizer` / `asOwnerNotFinalized`, completely untouched by this migration -- proven in `registration.test.ts`'s "withholds genuinely owner-only administration from a non-owner claimed participant" and "still withholds true owner administration from a non-owner decision-maker.")

### A4 tests

- [x] Contributor cannot perform true owner administration. (`registration.test.ts`.)
- [x] Non-owner active human can initiate allowed procedural advancement. (`procedural-progression-authority.test.ts` against real Postgres, plus `registration.test.ts` at the WebMCP capability layer.)
- [x] Advancement fails when prerequisites are missing. (Same file, "refuses Proposals -> Deliberation without an active proposal.")
- [x] Decision maker can enter final decision review when valid. ("allows the same participant to enter Decision review once promoted to decision-maker.")
- [x] Contributor cannot freeze/approve a decision when not authorized. ("refuses a contributor (no decision authority) entering Decision review.")
- [x] Stale tools remain safely rejected after authority changes. (Structural, not newly tested this slice: registration only gates discovery, and every mutation still independently re-derives authority server-side on every call -- the same architecture A1's "stale captured tool references still fail server-side" already covers generically for every tool, this one included.)

### A4 exit gate

- [x] Being a contributor no longer blocks normal collaboration/progression unnecessarily. (Verified end to end against real Postgres.)
- [x] Owner status remains meaningful for administration. (The ten owner-only actions above are completely untouched.)
- [x] Decision-maker status remains meaningful for consequential decision actions. (Entering decision review now requires it, for anyone including the owner.)

---

## A5 — Explicit Waiting and Recovery Semantics

Add/standardize structured failure states where appropriate.

Required semantics:

```text
WAITING_FOR_PARTICIPANTS   -- [x] added; see below
WAITING_FOR_ALIGNMENT      -- [ ] deliberately not added; see below
UNRESOLVED_BLOCKING_CONFLICT  -- already existed
HUMAN_CONFIRMATION_REQUIRED   -- already existed
```

Use existing codes where equivalent; add new canonical codes only when they materially improve agent understanding.

`WAITING_FOR_PARTICIPANTS` replaces the generic `VALIDATION_ERROR` the three
`input -> proposals` readiness prerequisites (joined / positioned / ready)
previously returned -- a genuine, frequently-hit "waiting for people" state
distinct from a malformed request. `WAITING_FOR_ALIGNMENT` is **not**
wired to anything: alignment never mechanically gates any phase transition
anywhere in this schema (confirmed by rereading `apply_room_phase_entry` --
`voting -> approval` only checks for an active proposal and no open
blocking conflict). Inventing a call site for `WAITING_FOR_ALIGNMENT` would
misrepresent that invariant rather than clarify it, so this code was not
added to `actionErrorCodeSchema` at all. `supabase/migrations/20260831130000_waiting_for_participants_semantics.sql`.

### Every refusal should explain

- [x] Why the action cannot happen. (Already true of every existing refusal; unchanged.)
- [x] What/who is still pending. (New for the readiness prerequisites: `error.details.waitingParticipantIds` names exactly which required participants are still pending, instead of only a prose count.)
- [x] What the agent/user should do next. (`recovery` text; unchanged pattern, still present on every `WAITING_FOR_PARTICIPANTS` refusal.)
- [x] Current room version. (Every `ActionResult` failure already carries `roomVersion`; unchanged.)

Example:

```json
{
  "code": "WAITING_FOR_PARTICIPANTS",
  "message": "Input cannot advance yet.",
  "recovery": "Wait for the CTO to mark their input ready.",
  "details": {
    "waitingParticipantIds": ["..."]
  }
}
```

If `ActionResult.error` needs JSON-safe `details`:

- [x] Developer A updates the canonical contract. (`ActionResult.error.details?: JsonValue` and the matching `actionResultSchema` field, `src/contracts/room.ts`.)
- [x] All parsers/tests updated. (The repository's Zod parse is the single chokepoint -- `SupabaseRoomRepository`'s `actionResultSchema(...).parse(data)` -- so no separate parser needed updating. `action-feedback.tsx`'s exhaustive `Record<ActionErrorCode, string>` maps got the required new entries, caught by `tsc --noEmit`. New tests: `tests/contracts/room.test.ts`'s "A5: ActionResult.error.details", `tests/domain/waiting-for-participants.test.ts` proving the field survives a real Postgres round trip end to end.)
- [x] Developer B does not duplicate the type. (Nothing UI-side redefines `ActionResult` or `ActionErrorCode`; `action-feedback.tsx` imports both from `@/contracts/room`.)

### A5 exit gate

- [x] A natural-language agent can correctly distinguish "I am not authorized" from "the team is not ready yet." (`NOT_AUTHORIZED` and `WAITING_FOR_PARTICIPANTS` are now genuinely distinct codes for genuinely distinct situations, proven side by side in `tests/domain/procedural-progression-authority.test.ts`.)
- [x] Failed phase progression never leaves the agent guessing. (Every readiness refusal now names exactly who is still pending, not just a count.)

---

## A6 — Explicit Role and Decision Authority Assignment

### Scope rule

Do **not** build a full RBAC system.

For this sprint:

```text
role         = human-readable/domain identity (CEO, CTO, Designer, etc.)
meetingRole  = administrative authority (owner/cohost/participant)
decisionRole = meeting decision authority (decision_maker/contributor/advisor)
```

### Admission

Extend owner admission/configuration so the admitted participant receives an explicit assigned role and decision role.

Target owner intent:

```text
"Admit Deniz as CTO and give him decision authority."
```

- [x] Joiner's requested role is treated as requested metadata, not unquestioned authority. (`admit_join_request`'s new `p_role`/`p_decision_role` overrides, when supplied, always win over `request_row.role`/the previous hardcoded `contributor`. `supabase/migrations/20260831140000_explicit_role_and_decision_authority.sql`.)
- [x] Owner can assign/confirm the participant's human-readable role. (At admission via `admit_participant`'s `role` field, or after admission via `configure_participant`'s `role` field.)
- [x] Owner can assign `decision_maker` or `contributor` where allowed. (Same two paths; both reuse `assignableDecisionRoleSchema`, so `advisor` is never reachable through either.)
- [x] Ownership is not implicitly transferred. (Proven explicitly: "does not implicitly transfer ownership when admitting a decision-maker" in `tests/domain/explicit-role-and-decision-authority.test.ts`.)
- [x] Expert/simulation actors cannot be promoted into human authority. (`configure_participant` rejects any target with `kind <> 'human'` with `NOT_AUTHORIZED`; proven against a real enabled Security Expert participant in "refuses to configure the Security Expert.")
- [x] Changes are audited. (`join.admitted`'s `sanitizedInput` now includes `role`/`decisionRole` when admitting; `configure_participant` writes its own `participant.configured` audit event with `role`/`decisionRole` from/to values.)

### WebMCP owner tool

Prefer one clear configuration capability rather than many ambiguous controls, if it fits the existing architecture.

Possible tool:

```text
configure_participant   -- [x] implemented, exactly this name and these fields
```

Possible fields:

```text
participantId
role
decisionRole
```

- [x] No arbitrary acting participant ID is accepted. (`participantId` is always the *target*; the owner's own identity is always derived from `auth.uid()`, exactly like every other owner-only mutation in this codebase -- proven by the `forbidden` identity-field scan in `tests/webmcp/participant-authority.test.ts` covering the whole catalog, `configure_participant` included.)
- [x] Caller authority is always derived server-side. (`is_room_organizer`-equivalent inline owner lookup in `configure_participant`, matching `set_participant_decision_role`'s exact pattern.)
- [x] Ownership transfer remains a separate sensitive operation. (`transfer_ownership` untouched; `configure_participant` never writes `meeting_role` or `rooms.owner_participant_id`.)

`set_participant_decision_role` was kept alongside `configure_participant` rather than removed: it already existed, is well-tested and documented, and `configure_participant` is a strict superset (decision role + role) rather than a competing, ambiguous alternative -- removing it would have been unnecessary churn for no discoverability cost (`configure_participant`'s description makes clear when to reach for it instead).

### A6 tests

- [x] Owner admits participant as CTO contributor. ("admits with the owner's explicit role and contributor decision role by default.")
- [x] Owner admits/configures participant as CTO decision maker. (Both admission-time and post-admission-via-`configure_participant` paths tested.)
- [x] Decision-maker status changes tool availability/authority correctly. (Already proven in A4's `procedural-progression-authority.test.ts`; A6 additionally proves a participant can be admitted *directly* as decision-maker in one call, without a separate promotion step.)
- [x] Non-owner cannot assign roles/decision authority. ("refuses a non-owner caller" for `configure_participant`; admission's owner check is the same `ownerRoomForJoinRequestManagement` gate every join-request action already used.)
- [x] Expert/simulation cannot become human decision maker through this path. ("refuses to configure the Security Expert.")

### A6 exit gate

- [x] Every human participant has an explicit visible role. (Was already true structurally -- `role` is a required, non-null column set at admission; A6 makes it the *owner's* explicit choice rather than only the joiner's self-report.)
- [x] Every human participant has explicit decision authority. (Was already true structurally -- `decisionRole` defaults to `contributor`; A6 lets the owner set it explicitly, including at admission time.)
- [x] Owner's agent can understand and perform legitimate authority delegation. ("Admit Deniz as CTO and give him decision authority" now maps to exactly one tool call.)

---

## A7 — Judge-Led Demo Behavior

### Goal

Keep deterministic participant constraints/reactions, but remove dependence on one fixed meeting script.

Keep stable demo actors:

- [ ] Founder / CEO or Product Lead human judge.
- [ ] Engineer simulation.
- [ ] Product Designer simulation.
- [ ] Growth simulation.
- [ ] Security Expert advisory actor.

Keep stable constraint domains:

- [ ] engineering capacity;
- [ ] reuse/existing auth boundaries;
- [ ] accessibility/interaction consistency;
- [ ] launch timing;
- [ ] privacy/security.

### Remove rigid meeting path

- [ ] Judge can introduce a new proposal through normal WebMCP.
- [ ] Simulations react to the actual active proposal/current state.
- [ ] Security review analyzes the actual active proposal.
- [ ] Demo does not require the original seeded proposal to be the only viable path.
- [ ] Demo does not silently auto-finalize.
- [ ] Human decision gate remains intact.

### Keep reliability

- [ ] Simulation reactions remain deterministic/rule-based enough for a judge demo.
- [ ] Demo remains resettable.
- [ ] Reset produces a clean judge-ready state.
- [ ] No hidden fake UI state is introduced.

### A7 exit gate

- [ ] Two materially different judge-created proposals can both run through the protocol.
- [ ] The demo no longer depends on memorizing the old exact prompt sequence.

---

## A8 — Canonical Final Meeting Report

Create one canonical final report projection:

```text
MeetingReport
```

It must derive from canonical finalized decision state.

### Required report content

- [ ] meeting title;
- [ ] meeting brief;
- [ ] executive summary;
- [ ] final decision;
- [ ] rationale;
- [ ] participant names;
- [ ] participant human-readable roles;
- [ ] meeting/decision authority;
- [ ] key inputs;
- [ ] constraints;
- [ ] proposals considered;
- [ ] concerns raised;
- [ ] resolved concerns;
- [ ] accepted trade-offs;
- [ ] alignment;
- [ ] dissent/warnings;
- [ ] Security Expert advice/dispositions;
- [ ] action items;
- [ ] owners;
- [ ] deadlines;
- [ ] decision hash;
- [ ] finalized timestamp;
- [ ] concise provenance/audit summary.

### WebMCP

Expose:

```text
get_final_report
```

- [ ] Available to every active participant after finalization.
- [ ] Report returned to different participants is semantically identical.
- [ ] Decision hash is identical for every participant.
- [ ] Participant-authored content remains correctly marked/untrusted where appropriate.

### A8 tests

- [ ] Report cannot be read before finalization.
- [ ] Final report includes dissent.
- [ ] Final report includes expert advice.
- [ ] Final report includes approvals/authority.
- [ ] Two participants receive the same final decision hash/report basis.

### A8 exit gate

- [ ] Agents no longer reconstruct the final meeting outcome by combining many separate reads.

---

## A9 — PDF Export

Generate the PDF from `MeetingReport`, not from a second independent reconstruction.

Canonical flow:

```text
DecisionRecord
      ↓
MeetingReport
   /     |     \
WebMCP   UI     PDF
```

### Endpoint

Target:

```text
GET /api/rooms/:roomId/report.pdf
```

- [ ] Authenticated access required.
- [ ] Caller must have legitimate room access.
- [ ] Finalized room required.
- [ ] Response content type is `application/pdf`.
- [ ] Suggested filename is stable and human-readable.
- [ ] PDF contains the important report sections.
- [ ] Decision hash appears in PDF.
- [ ] No service credentials leak into browser code.
- [ ] PDF generation dependency, if required, is added only by Developer A.

### A9 tests

- [ ] Unauthorized caller cannot download.
- [ ] Non-finalized room cannot download final report.
- [ ] Finalized participant can download.
- [ ] PDF is non-empty/valid.
- [ ] PDF report decision hash matches `get_final_report`.

### A9 exit gate

- [ ] Every participant can obtain the same finalized report as an exportable PDF.

---

# 5. Developer B — Agent-First UX / 3D Checklist

Developer B can work on B1/B2/B3/B5/B6 in parallel immediately.

B4 authority wiring and B7 canonical report wiring must wait until Developer A's relevant contract/backend changes are merged to `main` and Developer B rebases.

---

## B1 — Simplify Manual Input

### Input phase

Default UI should emphasize one concise human input surface.

Target:

```text
What should the team know from you?

[ text ]

Share with meeting
```

- [ ] Remove the default wall of summary/category/priority/constraint fields.
- [ ] Preserve structured manual controls only as an advanced/fallback path when needed.
- [ ] Primary UI does not expose database/DTO structure to judges.
- [ ] Agent-first guidance is visible.
- [ ] Manual users can still complete the meeting without an agent.

### Proposal phase

Target:

```text
Describe your proposed option

[ text ]

Propose
```

- [ ] Default proposal experience is concise.
- [ ] Advanced structured fields are secondary/hidden.
- [ ] The interface still surfaces enough context for deliberate human review.

### B1 exit gate

- [ ] A first-time judge can understand Input and Proposal screens without explanation.
- [ ] No primary workspace looks like a database form.

---

## B2 — Visible Coordination State

Use existing canonical `RoomState` wherever possible during parallel work.

### Input

Show something like:

```text
INPUT
3 / 4 ready

✓ CEO
✓ Designer
✓ Growth
○ CTO
```

- [ ] Current phase is unmistakable.
- [ ] Phase goal is visible in concise language.
- [ ] Ready count is visible.
- [ ] Pending participants are visible.

### Deliberation

- [ ] Blocking concern count is obvious.
- [ ] Warnings are visually distinct from blockers.
- [ ] Raiser/owner of concern is understandable.

### Alignment

- [ ] Every human participant is represented.
- [ ] Missing alignment is visibly "Waiting", not mistaken for neutrality/support.
- [ ] Alignment remains presented as informative, not a mechanical vote.

### Approval

- [ ] Missing required approvals are obvious.
- [ ] Frozen decision status is obvious.

### B2 exit gate

- [ ] The visible UI tells the same coordination story as the agent protocol.
- [ ] No manual wandering between workspaces is required to answer "who are we waiting for?"

---

## B3 — Explicit Participant Role Presentation

Participant cards/drawer should show human language.

Example:

```text
ATA
CEO

Owner
Decision maker
```

```text
ÇAĞATAY
CTO

Participant
Decision maker
```

- [ ] Human-readable role is prominent.
- [ ] Administrative authority is understandable.
- [ ] Decision authority is understandable.
- [ ] Simulated participants are clearly labeled simulated.
- [ ] Security Expert is clearly advisory/expert.
- [ ] UI does not imply Security Expert can vote/approve/own.
- [ ] Internal enum names are not the primary copy.

### B3 exit gate

- [ ] A judge can tell who the CEO/CTO/etc. is and who may decide without opening technical settings.

---

## B4 — Admission and Authority UX

**Do visual scaffolding in parallel. Wire to canonical actions only after Developer A's A6 changes are merged and Developer B rebases.**

Target:

```text
Deniz wants to join

Requested role
CTO

Assign role
[ CTO ]

Decision authority
○ Contributor
● Decision maker

[ Admit participant ]
```

- [ ] Requested role is shown.
- [ ] Owner explicitly confirms/assigns actual role.
- [ ] Decision authority is explicit.
- [ ] Ownership transfer is not conflated with decision authority.
- [ ] No temporary duplicate contract type is created.
- [ ] After rebase, component uses canonical A6 input/action.

### B4 exit gate

- [ ] Owner can understand and assign participant authority without knowing internal enums.

---

## B5 — Agent-First Guidance, Not Scripted Demo Instructions

Replace rigid prompt scripts with contextual examples.

### Input examples

- [ ] `"What has everyone shared so far?"`
- [ ] `"Share my constraints and mark me ready."`

### Waiting examples

- [ ] `"Are we ready to move on?"`
- [ ] `"Who are we still waiting for?"`

### Deliberation examples

- [ ] `"What changed since my last action?"`
- [ ] `"What is still blocking us?"`

### Alignment examples

- [ ] `"Show me where everyone stands."`

### Decision examples

- [ ] `"Prepare the final decision for my review."`

Rules:

- [ ] Suggestions are optional examples, not required commands.
- [ ] Demo copy does not imply only one exact prompt sequence works.
- [ ] Agent guidance does not instruct DOM inspection.

### B5 exit gate

- [ ] Judge can freely prompt their agent rather than following a tutorial script.

---

## B6 — Intentional Human Final Approval

When the agent requests final approval and receives `HUMAN_CONFIRMATION_REQUIRED`, the UI should make this feel intentional.

Target:

```text
Your agent prepared the final decision.

Review this exact decision before approving.

☐ I reviewed this decision

[ Approve decision ]
```

- [ ] Camera/workspace moves to the Decision review surface when appropriate.
- [ ] Exact frozen decision is visible.
- [ ] Decision hash/identity is available in a non-intrusive way.
- [ ] Human confirmation control is explicit.
- [ ] Copy explains that human confirmation is deliberate.
- [ ] UI does not imply the agent/WebMCP failed.

### B6 exit gate

- [ ] Judge understands why one human click remains after agent-driven meeting progression.

---

## B7 — Final Decision Report UI

**Layout can be prepared in parallel. Final canonical wiring occurs after A8 is merged and Developer B rebases.**

Target top-level report:

```text
DECISION REPORT

Decision
Why we chose it

Key constraints
Concerns addressed
Trade-offs
Team alignment
Owners & actions
Security advice

[ Download PDF ]

View detailed provenance
```

- [ ] Finalized room automatically exposes the report experience.
- [ ] Every participant sees the same decision outcome.
- [ ] Report uses canonical `MeetingReport` after rebase.
- [ ] No second frontend-only report model is introduced.
- [ ] Download PDF action points to the authenticated A9 endpoint.
- [ ] Provenance is available but not allowed to overwhelm the primary report.

### B7 exit gate

- [ ] Finalized meeting ends in a clear shared artifact, not a technical state dump.

---

## B8 — 3D State and Navigation Polish

3D should reinforce meeting state, not become navigation work for the agent.

Suggested semantic mapping:

```text
Input         -> participant/readiness area
Proposals     -> proposal surface
Deliberation  -> issues/evaluation board
Alignment     -> alignment surface
Decision      -> decision review surface
Finalized     -> report / memory surface
```

- [ ] No manual free-fly requirement.
- [ ] Stable camera pose per workspace.
- [ ] Camera transitions remain eased.
- [ ] Reduced-motion behavior preserved.
- [ ] Agent activity may be represented visually but is not authoritative.
- [ ] Pending participants/readiness can be understood without tiny 3D text.
- [ ] DOM remains the readable/control layer.

### B8 exit gate

- [ ] 3D makes the meeting easier to understand without becoming necessary for protocol comprehension.

---

# 6. First Integration Checkpoint

Do not wait until both branches are huge.

Developer A should finish and verify at least:

```text
A1 WebMCP coverage
A2 Coordination
A3 Updates
A4 Authority
A5 Waiting semantics
A6 Role/authority assignment
```

Before the first core merge.

## Developer A verification before PR/merge

Run against the **local Supabase test stack**, not hosted production:

```bash
npm run check
npm run test:unit
npm run test:domain
npm run test:e2e
npm run build
```

- [ ] `npm run check` passed.
- [ ] `npm run test:unit` passed.
- [ ] `npm run test:domain` passed.
- [ ] `npm run test:e2e` passed.
- [ ] `npm run build` passed.
- [ ] No automated test command reset/mutated hosted production Supabase.
- [ ] Existing Security Expert authority guarantees still pass.
- [ ] Existing ownership/removal/realtime tests still pass.

### Merge A core

- [ ] `feature/agent-protocol-core` reviewed.
- [ ] A1–A6 merged into `main`.
- [ ] Earlier repository checklist/status updated by integrator.

---

# 7. Developer B Rebase Checkpoint

After A core reaches `main`:

```bash
git switch feature/agent-first-ux
git fetch origin
git rebase origin/main
```

- [ ] Rebase completed.
- [ ] No canonical backend type was overwritten by UI branch.
- [ ] No old capability matrix was restored.
- [ ] No old authority behavior was accidentally reintroduced.
- [ ] B4 wired to canonical role/decision-authority actions.
- [ ] B2 updated if coordination data shape requires it.
- [ ] B6 wired to canonical `approve_final_decision` flow.

Developer B then continues/finishes B1–B6.

---

# 8. Report Integration Checkpoint

Developer A completes:

```text
A7 judge-led demo
A8 MeetingReport
A9 PDF export
```

Verify:

```bash
npm run check
npm run test:unit
npm run test:domain
npm run test:e2e
npm run build
```

- [ ] A7 passed.
- [ ] A8 passed.
- [ ] A9 passed.
- [ ] Report API/WebMCP/PDF share one canonical report basis.
- [ ] A7–A9 merged into `main`.
- [ ] Earlier repository checklist/status updated.

Developer B rebases again:

```bash
git switch feature/agent-first-ux
git fetch origin
git rebase origin/main
```

Then:

- [ ] B7 wired to canonical `MeetingReport`.
- [ ] B7 Download PDF wired to canonical A9 endpoint.
- [ ] B8 final 3D/report transitions completed.

---

# 9. Developer B Final Verification and Merge

Run:

```bash
npm run check
npm run test:unit
npm run build
```

Then targeted Playwright tests for the modified user journeys.

- [ ] `npm run check` passed.
- [ ] `npm run test:unit` passed.
- [ ] `npm run build` passed.
- [ ] Input simplification manually verified.
- [ ] Role/authority assignment UI manually verified.
- [ ] Coordination UI manually verified.
- [ ] Human confirmation UX manually verified.
- [ ] Final report UI manually verified.
- [ ] PDF download manually verified.
- [ ] `feature/agent-first-ux` merged into `main`.
- [ ] Earlier repository checklist/status updated.

---

# 10. Canonical Two-Human / Two-Agent Live Test

This is a **required manual gate**.

Use two real browser sessions and two real agents.

## Setup

### Human/Agent A

- [ ] Creates room through WebMCP.
- [ ] Is clearly identified as CEO/owner/decision maker.

### Human/Agent B

- [ ] Requests join.
- [ ] Is admitted as CTO.
- [ ] Has explicit decision authority assigned as intended.

## Shared context

- [ ] Agent A uses WebMCP discovery rather than DOM inspection.
- [ ] Agent B uses WebMCP discovery rather than DOM inspection.
- [ ] Agent A reads meeting/participant roles.
- [ ] Agent B reads meeting/participant roles.
- [ ] Both agents understand who has administrative authority.
- [ ] Both agents understand who has decision authority.

## Input

- [ ] Agent A shares input through WebMCP.
- [ ] Agent B shares input through WebMCP.
- [ ] Agent A marks input ready through WebMCP.
- [ ] Agent B marks input ready through WebMCP.
- [ ] Neither human clicks readiness manually.
- [ ] Coordination status says all required humans are ready.

## Proposals

- [ ] Meeting advances through WebMCP/state-machine action.
- [ ] One agent proposes an option.
- [ ] Other agent learns about it through `get_room_updates` / coordination reads.
- [ ] No DOM inspection is needed to discover the new proposal.

## Deliberation

- [ ] One agent raises a concern.
- [ ] Other agent sees the concern through WebMCP.
- [ ] Other agent responds/revises.
- [ ] Concern resolves through canonical operations.
- [ ] Agents understand when the room is still blocked vs ready.

## Alignment

- [ ] Alignment requested through WebMCP.
- [ ] Agent A expresses its human's alignment.
- [ ] Agent B expresses its human's alignment.
- [ ] Both agents can see missing/current alignments.
- [ ] Alignment is not presented as an automatic vote outcome.

## Decision

- [ ] Legitimate decision maker freezes/reviews candidate.
- [ ] Agent calls `approve_final_decision`.
- [ ] Tool returns `HUMAN_CONFIRMATION_REQUIRED`.
- [ ] Agent cannot autonomously bypass confirmation.
- [ ] Human reviews exact decision.
- [ ] Human manually confirms approval.
- [ ] Finalization updates both browsers via realtime.

## Final report

- [ ] Agent A calls `get_final_report`.
- [ ] Agent B calls `get_final_report`.
- [ ] Decision hash matches.
- [ ] Final decision matches.
- [ ] Dissent/warnings match.
- [ ] Security advice matches.
- [ ] PDF can be downloaded.
- [ ] PDF decision hash matches canonical report.

### Two-agent live gate

- [ ] **PASS: neither agent needed DOM inspection/wandering for meeting protocol.**
- [ ] **PASS: normal collaboration was not unnecessarily owner-gated.**
- [ ] **PASS: genuine administrative/decision authority remained enforced.**
- [ ] **PASS: final human confirmation remained mandatory.**

---

# 11. Judge-Led Hosted Demo Gate

Run on the actual deployed application after `main` is deployed.

Use a fresh/incognito browser.

- [ ] `/room/demo` opens.
- [ ] Judge becomes the intended human participant.
- [ ] WebMCP tools are discovered immediately.
- [ ] Judge can ask an arbitrary reasonable meeting question.
- [ ] Judge can introduce a proposal that differs from the old scripted proposal.
- [ ] Simulated teammates respond to current state/proposal.
- [ ] Security Expert reviews relevant actual proposal content.
- [ ] Agent knows when it is waiting for another participant/state condition.
- [ ] Agent knows when the meeting advances.
- [ ] Human approval gate works.
- [ ] Final report appears.
- [ ] PDF downloads.
- [ ] Reset Demo works after the run.

### Hosted demo gate

- [ ] PASS in fresh incognito.
- [ ] PASS after Reset Demo.
- [ ] PASS after one full judge-led meeting.

---

# 12. Final Regression Gate

From latest merged `main`:

```bash
git switch main
git pull origin main
```

Run:

```bash
npm run check
npm run test:unit
npm run test:domain
npm run test:e2e
npm run build
```

- [ ] `npm run check`
- [ ] `npm run test:unit`
- [ ] `npm run test:domain`
- [ ] `npm run test:e2e`
- [ ] `npm run build`

Manual:

- [ ] normal room creation;
- [ ] passcode join;
- [ ] invite join;
- [ ] waiting-room admission;
- [ ] participant removal;
- [ ] ownership transfer;
- [ ] meeting lock/unlock;
- [ ] readiness;
- [ ] proposals;
- [ ] concerns/trade-offs;
- [ ] alignment;
- [ ] decision review;
- [ ] human final approval;
- [ ] Security Expert;
- [ ] realtime convergence;
- [ ] final report;
- [ ] PDF;
- [ ] deployed `/room/demo`;
- [ ] Reset Demo.

Security/authority:

- [ ] removed participant cannot regain room access;
- [ ] stale WebMCP tool references fail closed;
- [ ] contributor cannot perform owner administration;
- [ ] unauthorized participant cannot approve;
- [ ] expert/simulation cannot gain human decision authority;
- [ ] service-role credentials are server-only;
- [ ] finalized record remains immutable.

---

# 13. P2 — Only If Core Agent-Native Loop Is Green

Do **not** start these while any P0/P1 gate above is red.

## Workspace context

Possible canonical additions:

```text
WorkspaceContext
Workstreams
```

Possible tools:

```text
get_workspace_context
list_workstreams
```

- [ ] Start only after final regression/live-agent gate is healthy.

## Organizational decision memory

Possible canonical addition:

```text
OrganizationalDecision
```

Possible tools:

```text
get_relevant_context
list_organizational_decisions
```

- [ ] Start only after final report/PDF is healthy.

## Additional 3D polish

- [ ] Only after protocol, report, and hosted demo are green.

---

# 14. Cut List If Time Runs Short

Cut from the bottom upward.

### Never cut

- [ ] hosted `/room/demo` operational;
- [ ] complete WebMCP discovery/coverage;
- [ ] `mark_my_input_ready`;
- [ ] correct authority gating;
- [ ] coordination status;
- [ ] multi-agent updates/awareness;
- [ ] explicit participant roles/decision authority;
- [ ] human final approval gate;
- [ ] final shared report.

### Cut later if necessary

1. [ ] optional `wait_for_room_change`;
2. [ ] extra PDF visual polish;
3. [ ] extra 3D transitions;
4. [ ] workspace/workstreams;
5. [ ] organizational decision memory;
6. [ ] additional specialists;
7. [ ] marketplace/recruitment expansion.

---

# 15. Definition of Done

The sprint is complete only when this statement is true:

> Two humans can join one meeting with their own agents. The agents immediately discover the meeting protocol through WebMCP, understand all participants' roles and authority, share and observe canonical meeting inputs, know when they must wait, know when the room advances, deliberate without inspecting the DOM, respect administrative and decision authority, prepare the exact final decision for deliberate human confirmation, and leave every participant with the same canonical final report and downloadable PDF.

Final sign-off:

- [ ] Developer A sign-off: __________________
- [ ] Developer B sign-off: __________________
- [ ] Two-agent live test sign-off: __________________
- [ ] Hosted demo sign-off: __________________
- [ ] Earlier repository checklist/status updated to reflect final merged state.
