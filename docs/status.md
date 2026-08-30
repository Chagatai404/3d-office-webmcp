# Repository status

Last updated: 2026-08-30 (Slice 4 / Gate 4).

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
- participant-scoped WebMCP tools;
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

See [`backend-integration.md`](backend-integration.md) and
[`workstreams/core-platform-completed.md`](workstreams/core-platform-completed.md)
for the detailed record.

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
- procedural placeholder geometry until Blender MCP assets are ready.

See [`product-ux.md`](product-ux.md).

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

## Next implementation slice

Slice 5 (the broader goal-oriented WebMCP tool catalog, the Security Expert
advisory actor, and the full `/room/demo` scenario redesign) has not been
started.

## Verification note

Run `npm run check`, `npm run test:domain`, `npm run test:e2e`, and
`npm run build` after applying any change in this area; `test:domain` and
`test:e2e` require a local Supabase instance (`npm run supabase:start`, or let
the scripts' own `supabase db reset` provision one) and will fail fast with a
connection error if Docker/Supabase is unavailable in the current environment.
