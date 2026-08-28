# Backend integration

## Canonical boundary

`src/contracts/room.ts` is the only public room DTO/action boundary. Database
rows are mapped to `RoomState` in `src/lib/supabase/room-state.ts`; `user_id`
is used to derive `selfParticipantId` and `isClaimed`, then discarded.

The browser implementation is `ApiRoomClient` in
`src/clients/api-room-client.ts`. It implements the same `RoomClient` interface
as the frontend mock. The current milestone implements room loading, seat
claiming, position/constraint creation, proposal submission, objections, and
snapshot subscriptions. Later methods return a structured not-available result.

## Authentication

`ApiRoomClient` calls Supabase anonymous sign-in once per browser storage
context. API calls carry the access token as a bearer token. Route handlers
validate that token with Supabase Auth and create a request-scoped authenticated
Supabase client. They never accept an auth user ID or participant ID as actor
authority.

Postgres resolves `auth.uid()` to the claimed participant inside each mutation
transaction. The `seatId` in `claimSeat` identifies the requested unclaimed
seat; it does not become trusted actor evidence.

## Concurrency and mutations

`ApiRoomClient` caches the latest observed room version and sends it through
`If-Match`. The HTTP adapter converts that to domain command context. TypeScript
domain operations validate input, phase, and the observed version. Transactional
Postgres RPC functions lock the room row and repeat identity, phase, version,
and cross-room checks before writing.

Every successful mutation increments `rooms.version` and inserts its audit event
in the same transaction. A stale version returns `STALE_ROOM_STATE` without a
write.

## HTTP adapter

- `GET /api/rooms/:roomId`
- `POST /api/rooms/:roomId/claim-seat`
- `POST /api/rooms/:roomId/positions`
- `POST /api/rooms/:roomId/proposals`
- `POST /api/rooms/:roomId/objections`

Mutation routes require `Authorization: Bearer <access-token>` and
`If-Match: <room-version>`. Bodies use the canonical contract schemas.

The isolated `POST /api/dev/rooms/:roomId/phase` route exists only for the early
demo flow. It requires `ALLOW_DEMO_PHASE_TRANSITIONS=true`, a claimed participant,
the current version, the literal `demo` room, and a one-step early transition.

## Realtime

Only the `rooms` table is in the Realtime publication for this milestone. Every
mutation changes its version, so `ApiRoomClient` receives a lightweight room
update notification, invalidates its snapshot, refetches the canonical
`RoomState`, and calls subscribers. Raw change payloads never reach UI or 3D
components.

## Frontend handoff

Instantiate one `ApiRoomClient` per browser application session and provide it
where the frontend currently provides `MockRoomClient`. No component should
import Supabase table types or call Supabase mutation APIs. Continue to feed 3D
only with `createRoomVisualizationState(room)`.

For a hosted project, enable Anonymous Sign-Ins, apply the migration and seed,
set the two public Supabase environment variables, and leave the developer phase
transition flag disabled outside a controlled demo environment.
