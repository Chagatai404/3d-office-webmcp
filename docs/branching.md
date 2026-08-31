# Workstream branching agreement

Create parallel work from the same verified integration commit.

Recommended lanes:

- `core-integration` — domain, Supabase, auth, API, WebMCP, permissions,
  concurrency, integration tests, deployment.
- `meeting-experience` — product shell, meeting toolbar, workspace dock, R3F
  meeting room, camera choreography, semantic boards, accessibility, and
  Blender asset integration.

## Shared hotspots

Review changes to these files across lanes before dependent work is merged:

- `src/contracts/room.ts`
- `src/components/room/room-provider.tsx`
- `src/visualization/room-view-model.ts`
- `package.json` / `package-lock.json`
- root TypeScript, lint, and test configuration

When a workstream needs new shared room data or a new authoritative action:

1. change `src/contracts/room.ts` first;
2. add/update a contract test;
3. review frontend, backend, WebMCP, and migration implications;
4. merge the contract checkpoint into both lanes;
5. implement against that shared contract.

Do not add equivalent local DTOs.

## Presentation-only freedom

The experience lane may change these concepts without a domain contract change:

- active meeting workspace;
- camera pose and transition state;
- open toolbar/drawer state;
- scene layout/materials;
- temporary procedural geometry;
- DOM panel composition.

None of these belong in `RoomState`.

## Merge checkpoints

Integrate vertically rather than waiting for separate complete products:

1. MeetingShell renders real room state.
2. Meeting toolbar and workspace dock are functional.
3. Camera transitions work with procedural room geometry.
4. Constraints / proposals / issues workspaces use real state/actions.
5. Voting / approval / finalized workspaces use existing authority rules.
6. Legacy DesktopShell/office navigation is removed.
7. Blender assets replace procedural placeholders without state changes.

The integration owner keeps `npm run check` and `npm run build` green and runs
full domain/E2E verification at merge checkpoints.
