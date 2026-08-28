# Workstream branching agreement

Create both workstream branches from the same verified baseline commit.

Suggested branch names:

- `core-integration` — domain operations, Supabase, auth, API adapters, WebMCP,
  permissions, concurrency, tests, and deployment.
- `3d-experience` — 2D presentation, React Three Fiber scene, participant desks,
  proposal/constraint/conflict visualization, activity trails, and approval
  visualization.

## Shared files

Changes to these files are integration changes and should be reviewed by both
builders before dependent implementation work is merged:

- `src/contracts/room.ts`
- `src/visualization/room-view-model.ts`
- `package.json` and `package-lock.json`
- root TypeScript, lint, and test configuration

When a workstream needs a new shared field or action:

1. Change `src/contracts/room.ts` first.
2. Add or update a contract test.
3. Review the frontend, backend, WebMCP, and migration implications together.
4. Merge the contract change into both branches.
5. Implement each side against that merged contract.

Do not add equivalent local DTOs. Import canonical types and schemas directly.

## Merge checkpoints

Integrate vertically after each milestone instead of waiting for two complete,
separate products:

1. Room load and seat claim.
2. Position, proposal, objection, and realtime flow.
3. WebMCP actions through the same domain operations.
4. Trade-offs and proposal revision.
5. Voting, hashed preview, independent approval, and finalization.
6. Real `RoomState` projected into the 3D scene.

The integration owner resolves contract changes and keeps `npm run check` and
`npm run build` green on the shared branch.
