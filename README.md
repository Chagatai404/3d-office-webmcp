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

See [`docs/branching.md`](docs/branching.md) before creating workstream branches.

## Source documents

- [`3d-office-webmcp-shared-context.md`](3d-office-webmcp-shared-context.md)
- [`webmcp-hackathon-project-brief.md`](webmcp-hackathon-project-brief.md)
