# Repository instructions

The integration rules in this file apply to all work in this repository.

- Treat `src/contracts/room.ts` as the canonical public integration boundary.
- Do not duplicate room DTOs, action inputs, result types, or phase names.
- Keep the canonical contract JSON-serializable and independent of React,
  React Three Fiber, Supabase implementations, route handlers, Node-only code,
  and UI components.
- Browser mutations must not accept trusted participant identity. Resolve the
  actor from the authenticated session on the server.
- Keep actor authority (`participant`, `expert`, `system`) separate from action
  origin (`manual_ui`, `webmcp`, `simulation`, `expert_service`, `system`).
- Route authoritative mutations from UI, WebMCP, and experts through shared
  server-side domain operations.
- `MockRoomClient` and `ApiRoomClient` must implement `RoomClient` from the
  canonical contract.
- Feed 3D components only with the output of
  `createRoomVisualizationState(room)`. The 3D layer performs no I/O,
  authorization, phase transition, or consensus decision.
- Update the shared contract and its tests before implementing a new shared
  field or action in either workstream.
- Preserve the exact room phases and `ActionResult` error codes already defined.
