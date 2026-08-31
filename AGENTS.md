# Repository instructions

These rules apply to all implementation work in this repository.

## Shared product/domain boundaries

- Treat `src/contracts/room.ts` as the canonical serialized integration
  boundary.
- Do not duplicate room DTOs, action inputs, result types, or phase names.
- Keep the canonical contract JSON-serializable and independent of React, R3F,
  Supabase implementations, route handlers, Node-only code, and UI components.
- Browser mutations must not accept trusted participant identity; resolve the
  actor from the authenticated session on the server.
- Keep actor authority (`participant`, `expert`, `system`) separate from action
  origin (`manual_ui`, `webmcp`, `simulation`, `expert_service`, `system`).
- Route authoritative mutations from UI, WebMCP, and experts through shared
  server-side domain operations.
- `MockRoomClient` and `ApiRoomClient` must implement the canonical `RoomClient`
  contract.
- Feed 3D components only with presentation projections derived from canonical
  `RoomState`. The 3D layer performs no I/O, authorization, phase transition, or
  consensus decision.
- Preserve the exact vote-vs-approval and hash-bound final approval invariants.

## Current UX direction

- The product is one simple 3D meeting room, not a virtual office campus.
- Do not add new work to the deprecated 2D floor-plan or desktop-window UX.
- Meeting metadata belongs in a compact meeting toolbar/drawers.
- Decision artifacts belong in a separate workspace dock and are shown one at a
  time through camera-focused 3D surfaces plus accessible DOM content.
- Camera/workspace/drawer state is presentation-only and must never enter
  `RoomState`.
- Do not add free-roaming avatars, mini offices, common-area gameplay, or
  god-view navigation to the new experience.
- Do not commit generic third-party office packs. Until Blender MCP assets are
  authored, use small procedural placeholders.
- Do not add fake video-call controls (microphone/camera/screen share) unless the
  feature actually exists.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
