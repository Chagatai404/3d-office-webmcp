# Frontend workstream status

Last verified: 2026-08-28 · `npm run check` and `npm run build` green ·
109 tests passing.

The canonical contract in [`src/contracts/room.ts`](../src/contracts/room.ts)
is unchanged by this workstream. Everything below is presentation, the
`RoomClient` boundary, and its local mock.

---

## Part 1 — Done

### Shared contract usage

The frontend imports `RoomState`, `RoomPhase`, `Participant`, `Position`,
`Constraint`, `Proposal`, `Conflict`, `ActivityEvent`, the action inputs, and
`ActionResult` from the canonical contract. No competing frontend DTOs exist.
Presentation-only types (`RoomVisualizationState`, `VisualParticipant`, and the
rest) live in the visualization layer, where derived view models belong.

### RoomClient boundary

| File | What it does |
| --- | --- |
| [`src/room-client/room-client.ts`](../src/room-client/room-client.ts) | `getRoomClient()` — the only module that names a concrete implementation |
| [`src/room-client/mock-room-client.ts`](../src/room-client/mock-room-client.ts) | `MockRoomClient implements RoomClient` |

`MockRoomClient` behaviour:

- Derives the acting participant from its own session state. A caller-supplied
  `participantId` is rejected, not honoured.
- Validates input with the canonical zod schemas.
- Increments `version`, appends exactly one `ActivityEvent`, emits a cloned
  snapshot to subscribers.
- Deterministic clock and ID sequences: two clients given the same input
  produce identical state.
- `subscribe()` delivers the current snapshot on connect, the way a realtime
  client would.
- Fully implemented: `getRoom`, `subscribe`, `claimSeat`, `addMyPosition`.
- Not yet implemented: the remaining methods return a real `WRONG_PHASE` for
  the room's current phase rather than a fabricated error code.

### Room state ownership

[`RoomProvider`](../src/components/room/room-provider.tsx) is the single owner
of the latest snapshot. It loads through `getRoom`, subscribes for updates,
derives the visualization projection once per snapshot, and exposes every
`RoomClient` method pre-bound to the room. No component reads fixtures or mock
state directly.

### Panels

`meeting-brief` · `positions-panel` · `participant-panel` · `activity-ledger` ·
`room-status` · `action-feedback` · `room-labels`, all in
[`src/components/room/`](../src/components/room/).

- Canonical six-phase rail with the current phase marked.
- Positions grouped by owner with their constraints.
- Participant rows carrying office number, human/simulated label, approver
  status, and per-participant vote and approval state.
- Activity ledger with all five origins, each shown as a glyph plus a word so
  origin never depends on colour alone.
- One reusable `ActionResult` treatment covering all eight error codes with
  recovery text.

### Visualization adapter

[`createRoomVisualizationState()`](../src/visualization/room-view-model.ts) is
pure and deterministic. Beyond the baseline it now derives ten office slots
(occupied or reserved), `consensus.voteProgress`, `consensus.approvalProgress`,
`consensus.hasBlockingConflict`, and resolves `actorName` for the ledger.
Approval progress groups by `decisionHash`, so an approval of a superseded plan
never counts towards the current candidate.

### Full-screen shell

[`src/components/shell/`](../src/components/shell/) — the office is the page and
the panels float over it in windows.

| File | What it does |
| --- | --- |
| `window-state.ts` | Pure window layout: open, z-order, frames, clamping. No React. |
| `shell-provider.tsx` | Owns window state, the selected place, and the camera request |
| `desktop-shell.tsx` | Composition: scene layer, HUD, window layer, dock |
| `os-window.tsx` | Draggable, resizable window chrome around one panel |
| `window-registry.tsx` | Which panel is in which window, and the place it belongs to |
| `dock.tsx` · `hud.tsx` · `navigation-guide.tsx` | Navigation, status, and the controls list |
| `zone-windows.ts` | Which panel explains which place in the office |

- A window keeps `frame: null` until someone moves it, so untouched windows
  follow the browser window instead of drifting off a resized screen.
- The dock is the keyboard route to every place the pointer can reach in the
  canvas, which stays `aria-hidden`.
- Window layout, selection, and camera position are presentation state. They
  never reach `RoomClient` and are not part of `RoomState`.

### 3D office

[`src/visualization/scene/`](../src/visualization/scene/) — `office-scene`,
`central-meeting-room`, `central-table`, `mini-office`, `shared-common-area`,
`constraint-wall`, `conflict-visualization`, `office-layout`, `office-models`,
`model-error-boundary`, `scene-label`.

- Three semantic zones: central meeting room, ten mini offices, common area.
- Constraint wall grouping cards by owner colour.
- God-view camera (`god-view-controls`): drag to pan, right-drag to orbit,
  wheel to zoom, `WASD`/arrows to walk, `Q`/`E` to turn, bounded to the floor
  and standing down while focus is inside a window. No realtime shadow maps.
- Every zone is pickable (`scene-interaction`): hovering highlights it, clicking
  flies the camera to the pose in `scene-focus` and opens the panel that
  explains it. Camera flights are instant under `prefers-reduced-motion`.
- Six low-poly OBJ props in `public/models/office/`, normalized to a target
  height and seated on the floor. Geometry loads without the source MTLs, which
  ship fully transparent materials and absolute Windows texture paths.
- Degrades to a text summary of the same projection if WebGL or an asset fails.
- The scene receives `RoomVisualizationState` and nothing else.

### 2D floor plan (`/room/[roomId]/plan`)

A second presentation surface beside the 3D office, in the light drafting
style of the reference design. Same `RoomProvider`, same `RoomClient`, same
snapshot; its own projection, layout, components, and stylesheet.

| File | What it does |
| --- | --- |
| [`src/floorplan/floorplan-layout.ts`](../src/floorplan/floorplan-layout.ts) | Pure SVG geometry: building, wings, corridors, offices, table seats, doors |
| [`src/floorplan/floorplan-view-model.ts`](../src/floorplan/floorplan-view-model.ts) | `createFloorPlanState()` — the plan's own pure projection of `RoomState` |
| [`src/components/plan/`](../src/components/plan/) | sidebar · topbar · canvas · furniture · avatars · detail rail · ledger · position dialog |
| [`src/app/room/[roomId]/plan/plan.css`](../src/app/room/[roomId]/plan/plan.css) | Light palette, every selector scoped under `.plan-root` |

- Three columns: navigation rail, the plan, and a detail rail that follows the
  selection — meeting room, any of the ten offices, the constraint wall, or the
  common area.
- The plan is drawn as an architectural blueprint: thick structural walls,
  thin line-art furniture, door openings with swing arcs, a hatched stair run.
- Participants are initial pucks on their office colour, seated at their desk,
  out on the floor, or at the table depending on the phase and what they have
  published. Simulated participants carry a dashed ring and a triangle glyph
  as well as the word, never colour alone.
- The constraint board pins one card per published constraint, coloured by its
  author and overflowing to a count rather than off the drawing.
- The common area's notice board carries the room-wide signals; the meeting
  table shows the candidate, or an honest empty state when there is none.
- Every room in the SVG is a real `role="button"` with a label, and the sidebar
  lists all of them again as ordinary buttons, so the drawing is never the only
  route to anything.
- Zoom (50–200%) and drag-to-pan on the plan; both are presentation state and
  never reach `RoomClient`.
- `addMyPosition` is wired through the same client. Later-milestone panels show
  phase-appropriate empty states rather than pretending to work.
- Class names are namespaced and the stylesheet is scoped, so the two surfaces
  cannot restyle each other. Only `ActionFeedback` is deliberately shared: one
  `ActionResult` treatment, restyled for the light surface.

### Verified in a real browser

Clicking **Publish position to the room** from the plan:

| | before | after |
| --- | --- | --- |
| Room version | 4 | 5 |
| Constraint cards on the wall | 6 | 8 |
| Engineer's constraints in the rail | 0 | 2 |
| Notice board "published" | 3/4 | 4/4 |
| Engineer's puck | at their desk | out on the floor |
| Activity rows | 4 | 5 |

Zero console errors on both routes.

### Seeded scenario

[`src/fixtures/demo-room.ts`](../src/fixtures/demo-room.ts) — the onboarding
decision, four participants (Product Manager, Engineer, Designer as a simulated
participant, Marketing Lead), three positions, six constraints, four activity
events across the `system`, `manual_ui`, `simulation`, and `webmcp` origins.
The Engineer seat is deliberately left without a position so the demo mutation
has somewhere to land.

### Verified mutation path

Driven in a real browser, clicking **Publish position to the room**:

| | before | after |
| --- | --- | --- |
| Room version | 4 | 5 |
| Constraint wall label in 3D | 6 published | 8 published |
| Engineer constraints | 0 | 2 |
| Activity rows | 4 | 5 |

Zero console errors. Both surfaces move from one `RoomState` snapshot.

### Tests

| File | Covers |
| --- | --- |
| [`tests/contracts/room.test.ts`](../tests/contracts/room.test.ts) | contract shape, no auth identifiers, no browser-supplied authority |
| [`tests/room-client/mock-room-client.test.ts`](../tests/room-client/mock-room-client.test.ts) | 12 tests: mutation, version, activity, subscription, determinism, failure paths |
| [`tests/visualization/room-view-model.test.ts`](../tests/visualization/room-view-model.test.ts) | 8 tests: deterministic mapping, office slots, consensus, decision-hash grouping |
| [`tests/components/room-flow.test.tsx`](../tests/components/room-flow.test.tsx) | 3 browser-level tests: form submit to DOM and visualization change |
| [`tests/components/window-state.test.ts`](../tests/components/window-state.test.ts) | 13 tests: opening layout, anchoring, stacking, dragging, clamping, reset |
| [`tests/components/shell-windows.test.tsx`](../tests/components/shell-windows.test.tsx) | 6 browser-level tests: dock opens and closes panels, visiting a place opens the panel that explains it |
| [`tests/visualization/scene-focus.test.ts`](../tests/visualization/scene-focus.test.ts) | 9 tests: zone ids, deterministic camera poses, offices approached from outside |
| [`tests/floorplan/floorplan-layout.test.ts`](../tests/floorplan/floorplan-layout.test.ts) | 18 tests: rooms inside the walls, no overlaps, corridor access, door arcs on all four walls, seat and card grids |
| [`tests/floorplan/floorplan-view-model.test.ts`](../tests/floorplan/floorplan-view-model.test.ts) | 17 tests: deterministic mapping, office slots, presence, card ownership, overflow, consensus, decision-hash grouping |
| [`tests/components/plan-flow.test.tsx`](../tests/components/plan-flow.test.tsx) | 6 browser-level tests: plan renders from the client, every place has a button, selection drives the rail, publish updates DOM and projection |

---

## Part 2 — Remaining

### Frontend milestones, in order

**A — Proposal visualization.** Mock `submitProposal`, seed the intentionally
flawed onboarding proposal, add a `ProposalPanel`, animate the document onto
the central table. `CentralTable` already renders `activeProposal`.
*Start here: B through F all need a proposal on the table first.*

**B — Objection and conflict visualization.** Mock `raiseObjection`, seed the
Engineer capacity and Designer accessibility objections, add a `ConflictBoard`
panel, draw the `constraint ↔ proposal` link lines.
`ConflictVisualization` already renders open objections with severity carried
by shape and height as well as colour; the link lines do not exist yet.

**C — Trade-off and revision.** Mock `proposeTradeoff`, revised-proposal chains
via `parentProposalId` (present in the contract, unused so far), conflicts
visibly weakening or resolving.

**D — Voting UX.** Mock `castMyVote`, a `VotePanel`, own-vote action only.
`VoteMarker` in the mini office and `consensus.voteProgress` are already built
and currently always read zero.

**E — Final preview and approval UX.** The largest remaining piece.
`previewFinalDecision` returning a `decisionHash`, a deliberately heavier
review screen, `approveFinalDecision` bound to that exact hash, and the
`DECISION_CHANGED` invalidation loop that returns the participant to review.
`ActionFeedback` already carries the recovery copy for `DECISION_CHANGED` and
`HUMAN_CONFIRMATION_REQUIRED`.

**F — Finalized decision record.** `getDecisionRecord`, the immutable record
view, rationale, owners, deadlines, dissent, approvals, audit history.

**G — Demo and simulation controls.** The visually separated panel from the
brief: next mock phase, trigger seeded objection, resolve seeded conflict,
simulate a participant vote, simulate approval, reset demo. Nothing exists yet.
Must never be mistakable for a participant-facing action.

**H — Semantic 3D animation.** `activity-trail.tsx` was never built. The scene
has no motion at all right now: no card movement, pulses, trails, or
conflict-link animation.

**I — Replace `MockRoomClient` with `ApiRoomClient`.** One line in
[`src/room-client/room-client.ts`](../src/room-client/room-client.ts). No panel,
provider, view model, or scene component should need to change.

### Loose ends in what is already built

- No `claimSeat` UI. The demo hard-seats the browser session as the Engineer.
- Scene text uses `drei/Html` DOM overlays. Fine at ten offices, worth
  revisiting beyond that.
- Window layout is not persisted: reloading returns to the opening layout.
- On screens under 48rem the windows stop floating and become one sheet above
  the dock, which is workable but not a designed mobile experience.
- The FBX character packs are unused, so the offices have no avatars. Would
  need a GLB conversion step.
- Initial paint is a client-side load, so `/room/demo` briefly shows a loading
  state before hydration.
- Reserved offices five through ten read as dim empty rooms. Deliberate, but
  they could carry a clearer "future participant slot" treatment.

### Not this workstream

Owned by core integration, per the brief: Supabase schema and migrations,
authentication, server-side authorization, domain operations, WebMCP tool
handlers, expert-service orchestration, production finalization logic, and
realtime invalidation.
