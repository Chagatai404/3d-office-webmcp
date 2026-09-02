# Repository status

Last updated: 2026-08-31 (Slice 1 / Reliability Cleanup implementation).

## Current state, in one paragraph

This is an implementation history, kept in the order each slice landed — read
top-to-bottom for chronology, not for "what's true today." As of the state
this file describes: the canonical contract has no `Vote` type; `Alignment` is
the informative, non-binding signal, and `DecisionPolicy` (`owner_decides` /
`equal_authority_consensus`) determines who actually approves. Final approval
is explicit, per required approver, and bound to an exact decision hash. The
3D room ships with authored `.glb` assets, not placeholder geometry. Roughly
40 WebMCP tools register dynamically by route/authority/phase/policy. For a
judge-facing summary of what's shipped, read the root [`README.md`](../README.md)
instead of this file; sections below that mention "voting" as a live mechanic
are describing the superseded model this repository replaced, not current
behavior — see the "Alignment and policy-aware finalization (Slice 4)" section
below for exactly what changed and why.

## Core platform

The backend/core workstream is considered integrated in this snapshot:

- canonical room contract, including `JoinRequest` and its status lifecycle;
- creator-only runtime room creation, now returning a generic invite URL and a
  one-time plaintext passcode display alongside `roomId` / `ownerParticipantId`;
- explicit meeting roles, decision roles, owner pointer, and decision policy;
- anonymous auth with the creator atomically bound as owner and decision-maker;
- dynamic, owner-controlled admission: a room passcode and a reusable generic
  invite token each authorize only a waiting `JoinRequest`, never a
  participant; admission is the only thing that creates one, atomically, with
  `meetingRole = participant` / `decisionRole = contributor`;
- the pre-Slice-2 predetermined-seat invitation endpoints (participant-specific
  preview/claim/regenerate/revoke) are removed from every browser-reachable
  route and from the canonical contract; the underlying database functions are
  retained, `EXECUTE`-revoked from `authenticated`, and reachable only by the
  seeded `multi_user` demo room's internal reset fixture -- see
  [`backend-integration.md`](backend-integration.md);
- phase transitions;
- positions, proposals, objections, trade-offs, voting, and approval;
- exact decision hash and immutable final record;
- realtime invalidation/refetch for admitted participants; bounded polling for
  a waiting outsider's own join-request status (never a widened room-read);
- route-, authority-, policy-, and phase-scoped WebMCP tools;
- solo-judge demo orchestration;
- domain, contract, component, and multi-browser coverage.

Normal room creation still creates only the authenticated creator as the
initial owner/decision-maker with `owner_decides` as the default policy.
Everyone else now reaches a room exclusively through a waiting `JoinRequest`
that the owner admits or rejects from the Participants drawer (or the
`RoomE2EHarness` / `OnboardingE2EHarness` browser-integration surfaces used by
Playwright). The seeded demo remains allowed to create explicit internal
simulation fixtures and does not change production creation or admission
behavior; `claim_participant_seat` remains demo-only in practice because a
normal production room never has an unclaimed seat for it to find.

Co-host promotion, passcode regeneration, and invite-revocation UI remain
explicitly out of scope and are deferred to a later slice.

Slice 3 (Gate 3) adds the complete owner lifecycle on top of Slice 2's join
model:

- persisted meeting lock (`rooms.isLocked`): owner-only lock/unlock; existing
  admitted participants are unaffected; a locked room refuses only *new*
  join requests (by passcode or invite) with a distinct `MEETING_LOCKED`
  code, while an already-waiting request stays visible and manageable by the
  owner;
- canonical participant membership status (`active` | `removed`), backfilled
  to `active` for every existing row. A participant row is never deleted, so
  positions, constraints, proposals, votes, approvals, and audit provenance
  all survive removal unchanged. `can_read_room` -- the single gate behind
  every room-scoped table's read RLS policy -- and every participant-authority-deriving
  mutation function now additionally require `status = 'active'`, so a
  participant row existing is no longer sufficient authority on its own;
  this is the security-critical part of this slice;
- owner-only `removeParticipant`: marks a participant removed, revokes read
  and mutation authority from their session immediately (their next
  `getRoom()` returns not-found the same as an unrelated room), and performs
  a documented, minimal compatibility cleanup (clearing `required_for_approval`
  and, if already in a frozen `approval` phase, recomputing the decision
  candidate and clearing stale approvals) so a removed participant can never
  be left as a required approver the legacy voting engine is still waiting
  on;
- owner-only `transferOwnership`: atomically moves `meeting_role = owner` /
  `rooms.owner_participant_id` to another active human participant, revoking
  the old owner's authority and granting the new owner's in the same
  transaction, provably serialized against concurrent transfer attempts, with
  the one-owner invariant from Gate 1 unchanged and re-verified at commit;
- live authority handoff falls out of the existing realtime/version
  machinery from Gate 2 with no new plumbing: a mutation bumps
  `rooms.version`, every connected session's realtime-gated `ApiRoomClient`
  refetches, and WebMCP tool registration's existing dependency on
  `selfParticipantId` deregisters every participant-mutation tool the moment
  a removed participant's session next observes room state;
- compact owner UI: `Remove` / `Make owner` inline on the participants
  drawer's other active human rows (owner-only, never on the owner's own
  row), each behind an inline confirmation naming the specific participant;
  meeting-access status and the lock toggle live in the settings drawer;
- a required onboarding UX fix, unrelated to the owner lifecycle but bundled
  into this slice: Welcome's "Join Meeting" now flies the camera through the
  same continuous-stage transition Create already had, landing on its own
  unframed interior pose instead of leaving the small welcome-framed 3D card
  hanging over the join form.

See [`backend-integration.md`](backend-integration.md) for the detailed record.

## Product UX reset

The previous frontend explored two presentation directions:

1. a desktop-window / dock / free-camera 3D office;
2. a separate `/room/[roomId]/plan` 2D architectural floor-plan prototype.

Both created too much simultaneous information and are no longer the target UX.

The canonical direction is now:

- one simple 3D meeting room;
- meeting metadata in a compact meeting toolbar/drawers;
- meeting artifacts in a separate workspace dock;
- one focused 3D workspace at a time;
- smooth camera transitions between the table and dedicated planning/evaluation
  boards;
- committed, authored `.glb` room assets (`public/models/meeting-room/`), not
  procedural placeholder geometry — this shipped; see the "3D room" section of
  the root [`README.md`](../README.md).

## Cleanup completed in this reorganization

- removed the obsolete standalone 2D floor-plan route/components/tests;
- removed committed generic office asset packs and their generation scripts;
- removed loose generated/reference image artifacts from the repository root;
- removed the obsolete one-off frontend prompt and duplicated hackathon brief;
- moved the completed core task ledger into `docs/workstreams/`;
- replaced the old product-UX task list with a migration checklist focused on
  the new meeting-room design;
- rewrote the README and canonical shared context around the new UX contract.

## Meeting shell

`/room/[roomId]` now renders `MeetingShell` (`src/components/shell/**`) --
the 3D room, the meeting toolbar, the workspace dock, and one drawer at a
time (`DrawerHost`) -- rather than the legacy `DesktopShell`. `DesktopShell`
and the legacy office scene remain only as `RoomE2EHarness`'s
non-visual counterpart for Playwright coverage
(`E2E_ROOM_HARNESS=true`, set globally in `playwright.config.ts`); they are not
reachable in a normal deployment. The Participants drawer
(`src/components/shell/drawers/participants-drawer.tsx`) is where Gate 2's
owner waiting-room controls live, and where Gate 3's per-participant
`Remove` / `Make owner` controls now live alongside them (rendered by
`src/components/room/participant-panel.tsx`). The Settings drawer
(`src/components/shell/drawers/settings-drawer.tsx`) carries Gate 3's meeting
lock status and owner-only toggle.

## Alignment and policy-aware finalization (Slice 4)

Gate 4 replaces the universal-vote / strict-majority / `required_for_approval`
finalization engine with the product's actual authority model -- "Agents
deliberate. Humans intervene. Leaders decide." -- and is implemented and
verified this pass:

- `Vote` is removed from the canonical contract entirely (`VoteChoice`,
  `CastVoteInput`, `RoomState.votes` no longer exist); `Alignment`
  (`support | concern | strong_objection | needs_clarification`,
  `RoomState.alignments`) replaces it as a purely informative,
  never-mechanically-decisive signal, upserted per participant/proposal
  through `expressMyAlignment`;
- entering the Decision phase (internal enum value `approval`) is now
  policy-neutral: only an active proposal and no unresolved blocking conflict
  are required, for both `DecisionPolicy` values -- alignment completeness,
  majority support, and a `request_changes`-equivalent response are no
  longer gates;
- required-approver authority (`FinalDecisionPreview.requiredApprovalParticipantIds`)
  is computed fresh from the room's current `DecisionPolicy` every time a
  candidate is built: exactly the current owner under `owner_decides`, or
  every active human decision-maker under `equal_authority_consensus`; the
  deprecated `required_for_approval` column is never read by this
  computation or by approval/finalization;
- two new owner-only mutations -- `setDecisionPolicy` and
  `setParticipantDecisionRole` -- are deliberately UI-only (never exposed
  through WebMCP), rejected once a candidate is frozen, and audited;
- ownership transfer and participant removal both safely recompute an
  already-frozen candidate's authority metadata and hash, so a stale
  approval (bound to a hash from before the authority change) can never
  finalize the recomputed candidate;
- the deterministic solo-judge demo continues to work end to end, using
  `demo_express_simulation_alignment` in place of the removed
  `demo_cast_simulation_vote`, and still waits for the human judge's own
  alignment before advancing into decision review;
- the legacy `votes` table and `cast_participant_vote()` function remain in
  the database for migration/history only; `cast_participant_vote`'s
  `EXECUTE` grant was revoked from `authenticated`, so no browser or WebMCP
  session can reach it any more.

See `backend-integration.md`'s "Alignment and policy-aware finalization
(Slice 4)" section for the full design, and the Slice 4 completion report for
exact verification commands and results.

## Goal-oriented WebMCP and attention (Slice 5)

Slice 5 adds the complete browser-agent workflow without adding a background
agent service:

- landing/create/join tools create real rooms and waiting join requests using
  the same onboarding domain operations as the visible forms;
- a centralized capability matrix derives registration from route, active
  membership, meeting role, decision role, phase, decision policy, lock state,
  frozen-candidate state, and required-approver state;
- registration is torn down with an `AbortController` and recomputed live when
  any capability input changes;
- the room catalog uses goal language (`share_my_context`, `suggest_option`,
  `raise_concern`, `respond_to_concern`, `resolve_my_concern`, and alignment /
  decision reads) rather than exposing database terminology;
- owner tools cover waiting-room management, lock state, phase progression,
  decision policy/roles, removal preparation, and ownership-transfer
  preparation;
- final decision confirmation, removal, and ownership transfer cannot be
  completed by WebMCP. The tool validates and focuses the existing visible
  confirmation UI, then returns `HUMAN_CONFIRMATION_REQUIRED`;
- canonical `AttentionItem` values are derived from current room state and the
  owner-authorized waiting list. The meeting toolbar exposes the same list as
  a compact **Needs you** drawer;
- participant-authored strings are returned separately as
  `untrustedRoomContent` where applicable and output annotations mark tools
  that can surface untrusted text;
- deterministic WebMCP tests cover the catalog, schemas, authority,
  registration, attention derivation, prompt injection, confirmation, and
  onboarding. Playwright covers dynamic registration and stale captured tool
  references against the real server boundary.

See [`webmcp-demo.md`](webmcp-demo.md) for the current Chrome flags, inspector
workflow, required natural-language prompts, and two-person demonstration.

## Security Expert and the `/room/demo` rebuild (Slice 6)

Slice 6 adds one real, deterministic, server-side advisory actor and rebuilds
`/room/demo` into the canonical solo-judge demonstration:

- `Participant.kind` gains a third value, `expert`, alongside `human` and
  `simulation`. It is never assignable through any human-authority path
  (join, admission, ownership transfer, decision-role promotion, alignment,
  approval) -- every one of those already required `kind = 'human'`, so
  `expert` is excluded by construction. The one place that needed an explicit
  fix was `derive_owner_participant_authority()`'s trigger, which previously
  had no branch for `kind = 'expert'` and would have fallen through to the
  legacy `required_for_approval`-based decision-maker default;
- a single Security Expert (`expertKey: "security"`) runs a small,
  deterministic, local regex rule set (`security_expert_classify` in the
  Slice 6 migration) against a proposal's title/summary/rationale/expected
  outcomes -- never external model calls, never a background agent. It
  currently flags behavioral tracking/profiling, authentication/profile
  boundary expansion, and unretained data-storage scope;
- findings persist in a new `expert_findings` table, scoped to a room and
  proposal, with a database-enforced `unique (room_id, fingerprint)`
  constraint so reviewing the same proposal twice can never duplicate a
  finding, even under concurrent calls;
- `ExpertFinding` is advisory data, never a human `Conflict`, never a vote,
  and never mechanically decisive: `owner_decides`/`equal_authority_consensus`
  finalization is completely unaffected by it. `record_expert_advice_outcome`
  is the only owner-only, pre-freeze path that classifies an open finding as
  `resolved`/`accepted_risk`/`rejected` with a rationale; a revision whose
  text no longer matches a category is also auto-resolved deterministically
  (`origin: expert_service`, always audited, never silent);
- `build_final_decision_candidate` now embeds deterministic `expertAdvice`
  (expert key, finding id, proposal id, category, title, status, resolution
  rationale) in the frozen candidate, so a material change to expert-advice
  disposition before freeze changes the decision hash;
- four new WebMCP tools -- `enable_security_expert` (owner-only),
  `request_security_review` (any claimed participant), `get_expert_advice`
  (read, untrusted-content-separated), `record_expert_advice_outcome`
  (owner-only) -- extend the goal-oriented catalog from Slice 5, gated the
  same centralized way every other tool is;
- `/room/demo` is rebuilt to the canonical scenario from the final-sprint
  checklist: **Founder / Product Lead** (the real judge, `owner` +
  `decision_maker`), **Engineer** / **Product Designer** / **Growth Lead**
  (deterministic `simulation`), and the **Security Expert** (`expert`,
  advisory), deciding a deliberately over-scoped "Highly personalized AI
  onboarding" proposal. The deterministic reaction engine
  (`run_solo_demo_orchestration`) now also raises Security Expert findings
  during Deliberation and auto-resolves them once an acceptable revision
  exists, alongside the existing Engineer/Designer blocking-conflict and
  alignment settlement it already performed;
- a first-time judge becomes the Founder automatically (an ordinary
  `claim_participant_seat` call on the always-unclaimed seeded `demo-product`
  seat, triggered client-side on `/room/demo` load -- no new privileged
  endpoint), and a visible **Reset demo** control (Help drawer) calls a new,
  always-available `POST /api/demo/reset` route that is hard-scoped to the
  literal `"demo"` room id and cannot reach any other room;
- `supabase/seed.sql` now seeds the demo room directly in this solo-judge
  shape, so a fresh `supabase db reset` already has `/room/demo` ready
  without any additional server call.

See [`judge-demo.md`](judge-demo.md) for the exact judge-facing scenario,
prompt script, and reset/limitation notes, and `backend-integration.md`'s
Slice 6 section for the full architecture writeup.

## Slice 1 / Reliability Cleanup

The reliability cleanup is implemented without changing the database schema,
Supabase migrations, room authority rules, or product scope:

- non-2xx room reads now carry an internal typed status while keeping the
  browser-facing message generic;
- realtime refreshes treat 401/403/404 as terminal access loss: the cached
  version and channel are cleared, subscribers are notified, and the expected
  transition is not logged as `Room refresh failed`;
- network, 5xx, and malformed-room failures still use the real refresh-error
  path, with focused unit coverage for each case;
- `RoomProvider` now performs the initial read before subscribing, and the
  realtime client performs one reconciliation read only after `SUBSCRIBED`;
- confirmed participant removal sends a data-free realtime invalidation so a
  removed browser re-checks the protected room API even though RLS correctly
  withholds the room-row change itself. The removed browser clears its room
  snapshot, loses its WebMCP registrations, and shows the existing generic
  unavailable-room surface without a reload;
- both R3F canvases explicitly select `PCFShadowMap`; the dependency-owned
  `THREE.Clock` warning remains intentionally untouched.

Verification on 2026-08-31:

- `npm run check`: passed (9 files, 151 tests);
- `npm run test:unit`: passed (26 files, 273 tests, including 7 focused API
  room-client reliability tests);
- `npm run test:domain`: passed (7 files, 80 tests);
- focused Playwright removal regression: passed (live unavailable transition,
  stale captured tool fails `NOT_AUTHORIZED`, owner history/session preserved);
- `npm run build`: passed (Next.js 16.3.3 production build);
- no Supabase migration diff was introduced.

The full Playwright gate is not self-certified in this run. An isolated full
pass reached 10/13 tests; its three failures were cold-server/test-setup
timeouts, not assertion regressions. The removal test then passed in isolation
after the final change. A final clean full rerun was blocked when the local
Supabase Docker stack lost its project network and failed to recreate its
Realtime/REST containers. A backup-preserving stop/restart did not repair the
stack, and destructive no-backup removal was not authorized. Re-run
`npm run test:e2e` after repairing the local Supabase stack before marking the
Gate 8 automated-suite item complete.

## Verification note

Run `npm run check`, `npm run test:domain`, `npm run test:e2e`, and
`npm run build` after applying any change in this area; `test:domain` and
`test:e2e` require a local Supabase instance (`npm run supabase:start`, or let
the scripts' own `supabase db reset` provision one) and will fail fast with a
connection error if Docker/Supabase is unavailable in the current environment.
