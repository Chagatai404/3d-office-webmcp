# Repository status

Last reorganized: 2026-08-29.

## Core platform

The backend/core workstream is considered integrated in this snapshot:

- canonical room contract;
- runtime room creation;
- anonymous auth + participant seat claiming;
- role-specific invitations;
- organizer authority;
- phase transitions;
- positions, proposals, objections, trade-offs, voting, and approval;
- exact decision hash and immutable final record;
- realtime invalidation/refetch;
- participant-scoped WebMCP tools;
- solo-judge demo orchestration;
- domain, WebMCP, and multi-browser coverage.

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

## Transitional code still present

The current `/room/[roomId]` runtime still uses the legacy `DesktopShell` and
legacy office scene while the new meeting shell is implemented. Those files are
migration code, not a design contract.

Do not add new product behavior to:

- `src/components/shell/**`;
- mini-office/common-area/free-roaming scene patterns;
- god-view navigation.

Delete those paths after the new `meeting-shell` and camera-driven workspace
scene are feature-complete.

## Next implementation slice

1. Create `MeetingShell` as the new `/room/[roomId]` runtime surface.
2. Add the meeting toolbar and workspace dock using semantic DOM controls.
3. Add presentation-only `MeetingWorkspace` state.
4. Replace god-view/free-flight controls with fixed camera poses + transitions.
5. Build the neutral procedural meeting-room shell.
6. Implement board workspaces one at a time, starting with Constraints,
   Proposals, and Issues.
7. Preserve existing domain actions and `RoomProvider`; this overhaul should be
   primarily presentation-layer work.
8. Once the new route is green, remove `src/components/shell/**` and obsolete
   office-layout scene components/tests.

## Verification note

This cleanup snapshot was edited without changing the canonical domain contract
or backend operations. Dependency installation in the sandbox did not complete,
so the full npm test/build suite should be run immediately after applying these
changes in the real repository.
