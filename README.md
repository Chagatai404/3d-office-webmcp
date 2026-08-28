# 3D Office WebMCP

A structured decision room where people and browser agents negotiate proposals,
surface conflicts, vote, and independently approve an exact final decision.

This repository begins with a deliberately narrow shared baseline. The core and
3D experience branches may evolve independently, but both program against the
canonical contract in [`src/contracts/room.ts`](src/contracts/room.ts).

## Start locally

Requirements: Node.js 20.9 or newer.

```bash
npm install
npm run dev
```

Open `http://localhost:3000/room/demo`.

Run all baseline checks with:

```bash
npm run check
npm run build
```

## Architectural boundary

```text
UI -> ApiRoomClient -> Server/API adapter -> Domain operations -> Supabase
                                              ^
                                              |
                                       Expert service

RoomState -> 2D UI
RoomState -> createRoomVisualizationState() -> 3D scene
```

- The browser never supplies trusted participant identity for mutations.
- Manual UI, WebMCP, and expert actions share server-side domain operations.
- `MockRoomClient` and `ApiRoomClient` must implement the canonical
  `RoomClient` interface.
- Supabase client usage is limited to authentication and realtime invalidation;
  authoritative writes go through server-side domain operations.
- The 3D layer consumes only `RoomVisualizationState` and owns no business state.
- Voting never implies approval. Approval binds to the exact decision hash.

## Frontend layers

```text
src/contracts/room.ts          canonical shared types (both workstreams)
src/room-client/               RoomClient boundary + MockRoomClient
src/components/room/           RoomProvider and the semantic 2D panels
src/components/shell/          the full-screen shell: windows, dock, HUD
src/visualization/             createRoomVisualizationState() + the R3F scene
public/models/office/          low-poly OBJ props
```

## The room is a place, not a page

`/room/demo` opens the 3D office full screen. Every panel — the brief,
positions, participants, the ledger — is a window you open, move, and close
over it, and the camera is a god view you fly around the office:

- drag to move over the floor, right-drag to swing round, wheel to come closer;
- `W A S D` or the arrow keys to walk the view, `Q` and `E` to turn, `+` and `−`
  to zoom, all of which stand down while focus is inside a window;
- click a place — the meeting room, an office, the constraint wall, the common
  area — to fly there and open the panel that explains it;
- the dock along the bottom is the keyboard route to the same places and
  panels, because the canvas is hidden from assistive technology.

Window layout, the selected place, and the camera are presentation state. They
live in `src/components/shell/`, never reach `RoomClient`, and are not part of
`RoomState`.

Integration is a one-file change: `getRoomClient()` in
[`src/room-client/room-client.ts`](src/room-client/room-client.ts) is the only
place that names a concrete implementation. Swapping `MockRoomClient` for
`ApiRoomClient` there requires no change to any panel, the provider, the view
model, or the scene.

See [`docs/branching.md`](docs/branching.md) before creating workstream branches.

## Source documents

- [`3d-office-webmcp-shared-context.md`](3d-office-webmcp-shared-context.md)
- [`webmcp-hackathon-project-brief.md`](webmcp-hackathon-project-brief.md)
