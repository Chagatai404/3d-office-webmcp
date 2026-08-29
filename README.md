# 3D Office WebMCP

A WebMCP-native shared decision room where each human keeps an independent
identity, browser agent, vote, and final approval authority.

**Agents negotiate. People decide.**

## Product direction

The room experience is being simplified around one clear spatial metaphor:

- one bright, minimal 3D meeting room is the default view;
- meeting metadata such as participants, roles, invitations, activity, and
  settings lives in a compact meeting toolbar/drawer system;
- decision artifacts such as the brief, constraints, proposals, issues,
  whiteboard notes, voting, and the final decision live in a separate workspace
  dock;
- selecting a workspace moves the 3D camera to one dedicated board/surface;
- only the active workspace is visually foregrounded — the UI must not render
  every board, panel, and participant list at once;
- production 3D assets will be authored later with Blender MCP. Until then,
  scene props should remain lightweight procedural placeholders.

The previous desktop-window / 2D-floor-plan direction is deprecated. Do not add
new product work to it.

## Start locally

Requirements: Node.js 20.9 or newer and Docker for local Supabase.

```bash
npm install
npm run supabase:start
npx supabase status -o env
```

Copy the reported `API_URL` and `PUBLISHABLE_KEY` into `.env.local` using
[`.env.example`](.env.example), then run:

```bash
npm run dev
```

Open `http://localhost:3000/room/demo` for the seeded judge room.

Core checks:

```bash
npm run check
npm run build
```

Database and browser integration checks:

```bash
npm run test:domain
npx playwright install chromium
npm run test:e2e
```

## Architecture boundary

```text
Manual UI ────────┐
Browser WebMCP ───┼──> Domain operations -> authorization -> Supabase
Expert service ───┘

RoomState -> semantic DOM UI
RoomState -> createRoomVisualizationState() -> 3D presentation
```

Important invariants:

- `src/contracts/room.ts` is the canonical shared integration contract.
- The browser never supplies trusted participant identity for mutations.
- Manual UI, WebMCP, and expert actions converge on the same domain operations.
- `RoomProvider` owns the latest canonical room snapshot in the browser.
- The 3D layer is presentation-only and performs no authorization or business
  transitions.
- Voting never implies approval; final approval is explicit and hash-bound.

## Repository guide

- [`3d-office-webmcp-shared-context.md`](3d-office-webmcp-shared-context.md) —
  canonical product + architecture decisions.
- [`docs/product-ux.md`](docs/product-ux.md) — the new meeting-room UX contract.
- [`docs/status.md`](docs/status.md) — current implementation and migration status.
- [`docs/hackathon.md`](docs/hackathon.md) — concise demo/submission checklist.
- [`docs/backend-integration.md`](docs/backend-integration.md) — API, identity,
  realtime, WebMCP, and backend handoff details.
- [`docs/branching.md`](docs/branching.md) — integration rules for parallel work.
- [`docs/workstreams/product-ux.md`](docs/workstreams/product-ux.md) — current
  frontend/3D overhaul checklist.
- [`docs/workstreams/core-platform-completed.md`](docs/workstreams/core-platform-completed.md)
  — completed backend/core workstream record.

## 3D asset policy

Do not commit third-party office asset packs or generated low-poly prop dumps.
The temporary scene should use procedural geometry only. Final authored assets
should be small, intentional `.glb` files produced for this product and placed
under `public/models/meeting-room/` only when they are actually wired into the
runtime.
