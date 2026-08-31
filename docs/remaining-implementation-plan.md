# Remaining implementation plan

Audited: 2026-09-01

Scope: every unchecked implementation requirement in
`3d-office-final-sprint-implementation-checklist.md` and
`current-agent-native-final-sprint-checklist.md`, deduplicated and checked
against the current `main` branch. Branch/merge instructions, human sign-off
lines, hosted-environment configuration, and manual test gates are listed
separately because they are not missing application features.

## Verification baseline

- `npm run check`: passed (13 files, 208 tests).
- `npm run test:unit`: passed (38 files, 416 tests).
- `npm run build`: passed with Next.js 16.3.3.
- `npm run test:domain`: not run; the required local Supabase stack is stopped.
  The privileged retry reached the CLI and failed with
  `LegacyResetLocalDbNotRunningError`, before Vitest started.
- Full Playwright, two-agent, hosted-incognito, and adversarial gates remain
  unverified in this audit.

## P0 — Finish the merged agent-native experience

### 1. Wire the finalized UI to canonical `MeetingReport`

Current gap: A8 and A9 are implemented, but
`src/components/room/final-report.tsx` still calls `getDecisionRecord()` and
reconstructs constraints/resolved concerns from `RoomState`. This is the one
explicit B7 integration item still missing.

Plan:

1. Add an authenticated JSON report read path backed by
   `computeMeetingReport` (or an equivalent shared server operation), rather
   than rebuilding the report in a route or component.
2. Add `getMeetingReport` to canonical `RoomClient`, `ApiRoomClient`,
   `MockRoomClient`, and `RoomProvider`.
3. Render `MeetingReport` directly in `FinalReport`; remove all local report
   lookups/reconstruction while keeping detailed raw provenance available via
   `DecisionRecord` only where explicitly requested.
4. Add component/client/route tests proving the UI, WebMCP
   `get_final_report`, and PDF expose the same decision hash and sections.

### 2. Complete `get_room_updates` event coverage

Current gaps:

- `participant.configured` is emitted after A6 role/authority changes but maps
  to the generic `other` update.
- A revision supersedes its parent in the database, but the update stream only
  labels the new row `proposal_submitted`; it does not explicitly describe a
  revision/supersession.

Plan:

1. Add a role/configuration update type and map `participant.configured`,
   preserving whether role, decision authority, or both changed.
2. Detect proposal revisions from the audit event's parent proposal metadata
   and return a distinct `proposal_revised` update with both proposal IDs.
3. Add unit tests for combined role changes and proposal supersession, including
   bounded untrusted text and version ordering.

### 3. Finish prompt-first simplification in Deliberation

Current gap: Input and Proposal are simplified, but the primary Deliberation UI
still exposes low-level fields such as conflict severity, trade-off expected
effect, revised rationale, expected outcomes, and constraint references.

Plan:

1. Make “raise a concern” one concise natural-language field; place severity
   behind an optional disclosure with a safe default.
2. Make “respond/revise” one concise response field; place expected effect,
   rationale, outcomes, and constraint references behind an advanced section.
3. Preserve the complete canonical DTOs and WebMCP schemas.
4. Add component tests matching the existing Input/Proposal simplification
   tests and manually verify keyboard/accessibility behavior.

### 4. Close security and reliability gaps

Current gaps:

- No rate limiting/abuse mitigation exists for passcode/invite join attempts.
- Tool output size is not consistently bounded (the checklist calls this out
  even though source reads are already chunked).
- API coverage is not exhaustive for route schemas, missing/invalid bearer
  tokens, missing `If-Match`, and stale `If-Match`.
- Multi-room isolation is covered for several domain IDs but not by the full
  two-room browser/realtime matrix.
- The “all successful mutations bump exactly once” checklist statement is not
  formally audited; idempotent no-op successes intentionally keep the version,
  so the invariant should be rewritten as “every material mutation bumps once.”

Plan:

1. Add per-IP plus per-room/session throttling for join credentials with a
   generic failure surface, retry metadata, and tests that do not leak room
   existence.
2. Define per-tool maximum collection/text sizes; paginate or truncate with an
   explicit continuation/recovery signal.
3. Add a route-table-driven API conformance suite for authentication, schemas,
   optimistic concurrency, and error mapping.
4. Add a two-room domain and Playwright scenario proving no read, mutation, ID,
   realtime, or demo-reset cross-contamination.
5. Repair/start local Supabase, then run `test:domain` and `test:e2e`; do not
   mark those gates from source inspection alone.

## P1 — Deferred owner and lifecycle features

These are real unchecked features, but the checklists explicitly deferred them
from the submission-critical slices.

### 5. Credential lifecycle management

- Regenerate room passcode.
- Revoke the active generic invite.
- Regenerate/rotate the generic invite.
- Show expired/revoked/locked/finalized waiting-room outcomes without leaking
  private room data.

Plan: add owner-only transactional operations, store only hashes, invalidate old
capabilities atomically, audit rotations/revocations, expose visible-confirmation
UI and owner WebMCP preparation tools, and test replay/concurrency.

### 6. End meeting

Current gap: there is no owner-controlled end-meeting operation distinct from
normal decision finalization.

Plan: first decide whether ending without a decision is permitted and define
the canonical terminal state; then implement an owner-only, visibly confirmed,
audited operation with join/mutation/realtime behavior and immutable history.

### 7. Decide or remove co-host support

Current gap: `cohost` exists in the enum, but there are no promote/demote flows,
permission definition, or removal semantics.

Plan: make a product decision. Recommended for the current single-owner product:
remove/hide the unused public value until permissions are specified. If it
ships, define an explicit permission matrix, keep final decision authority
separate, add atomic promote/demote operations, and cover transfer/removal races.

### 8. Optional long-poll update capability

Current gap: `wait_for_room_change` was explicitly deferred and is first on the
cut list.

Plan: add only after the live two-agent gate demonstrates that polling
`get_room_updates` is inadequate. Use an injectable clock/timeout, cancellation,
strict upper bounds, and no second event store.

## P1/P2 — Model and experience enhancements

### 9. Resolve the `AttentionItem` checklist mismatch

The old checklist asks for `roomId`, target, reason, status, `createdAt`, and
`resolvedAt`. The implemented design is deliberately a pure, ephemeral
projection with deterministic IDs; adding lifecycle timestamps would require
persistence or invented times and would conflict with that design.

Plan: record an architecture decision and update the old checklist to the
derived model (recommended). Only add persisted lifecycle fields if product
requirements need attention history, in which case create one canonical event
source and avoid duplicating room workflow state.

### 10. Remaining UX/QoL items

- Reconnect/offline state and real participant online/offline presence.
- Optional chair entrance animation after admission.
- Optional subtle owner distinction in the 3D scene.
- Distinct 3D advisory treatment for expert avatars (the DOM labels are already
  correct; the current 3D avatar only marks simulations).
- Shareable read-only final-report URL.
- Participant editing of already-published context, if the product wants it;
  currently participants can publish additional context but not edit a prior
  position in place.

Implement reconnect state first because it affects reliability; keep the 3D
items presentation-only. A shareable report needs a separate, revocable
read-only capability and must never weaken normal room RLS.

### 11. Expert enhancements explicitly not in the shipped scope

- Add an expert advisory “position.”
- Let the Security Expert suggest proposal revisions.

The current finding/recommendation model already satisfies advisory behavior.
Implement these only if user research shows the extra artifact/action is useful;
experts must remain advisors and must never align, approve, own, or finalize.

### 12. Post-core expansion items

- Workspace/workstream context and tools.
- Organizational decision memory and retrieval.
- Meeting templates and persistent organization profiles.
- Slack/Teams notifications and calendar integration.
- Additional specialists and extra 3D polish.

These stay blocked until the final regression, live two-agent, report/PDF, and
hosted demo gates are green.

## Operational and manual gates (not code features)

1. Confirm hosted Supabase anonymous auth and Vercel environment variables.
2. Run fresh-incognito `/room/demo`, reset, create/join/admit, and realtime
   smoke tests against the deployed app.
3. Run the canonical two-human/two-agent WebMCP test without DOM inspection.
4. Run the full adversarial identity/owner/join/decision/cross-room checklist.
5. Run the final local suite after starting Supabase, including full Playwright.
6. Verify public deployment, README/demo instructions, architecture diagram,
   judge prompts, video, and submission copy; obtain human sign-offs.
