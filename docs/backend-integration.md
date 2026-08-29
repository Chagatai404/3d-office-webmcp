# Backend integration

## Canonical boundary

`src/contracts/room.ts` is the only public room DTO/action boundary. Database
rows are mapped to `RoomState` in `src/lib/supabase/room-state.ts`; `user_id`
is used to derive `selfParticipantId` and `isClaimed`, then discarded.

The browser implementation is `ApiRoomClient` in
`src/clients/api-room-client.ts`. It implements the canonical `RoomClient`
interface. The implemented flow covers room loading, seat claiming,
position and constraint creation, proposal submission, deliberation, voting,
exact-decision preview, human approval, finalization, and snapshot
subscriptions.

## Room creation and organizer authority

`POST /api/rooms` creates a private, non-demo room. `CreateRoomInput` is a
strict schema, so a request body cannot carry `organizerUserId`, `actorId`,
`participantId`, `userId` or `origin`; the organizer is always
`auth.uid()` inside the `public.create_room` transaction, stored on
`rooms.organizer_user_id`, and checked later through
`public.is_room_organizer(room_id)`.

Room ids are opaque and collision-retried (`rm_7P3KQ8M2`). The room id is not a
security boundary — the invitation token is.

Organizer lifecycle semantics: the organizer takes the **first** listed seat.
That keeps room membership (and therefore `can_read_room`) true for the creator
without weakening any read policy, and gives the `room.created` audit event a
real participant actor: `actor_type = participant`, `actor_id` = the organizer's
seat, `origin = manual_ui` for UI creation. The room is created at version 0, so
the event records `previousRoomVersion = resultingRoomVersion = 0`.

Every other listed seat gets one invitation capability in `room_invitations`,
which stores only `public.hash_invite_token(raw)` — a SHA-256 hex digest that
creation, preview and claim all share. The raw token is returned exactly once,
inside the `CreatedRoom.participantInvites[].inviteUrl` values
(`<base>/room/<roomId>/join?invite=<token>`), and never enters `RoomState`. The
table has RLS enabled with no policy and no role grants: it is reachable only
through `SECURITY DEFINER` functions.

`RoomOnboardingClient` (`ApiRoomOnboardingClient`) is the browser surface for
this pre-membership step; it is deliberately separate from `RoomClient`, carries
no room version, and never touches room-runtime state.

Seats render in the order the organizer listed them.
`participants.seat_order` defaults from a monotonic sequence, because rows
inserted in one transaction share `created_at` and claiming a seat rewrites its
row.

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
write. Once finalized, every room mutation returns `ALREADY_FINALIZED`.

Participant votes are upserted by participant and proposal. Only the required
human participants count toward approval readiness. The demo transition into
approval requires one active proposal, no open blocking conflict, a vote from
every required participant, no `request_changes` vote, and a strict majority of
required participants supporting the proposal.

The approval candidate is stored as canonical JSON and hashed with SHA-256.
Approvals are participant-scoped and bound to that exact hash. A changed hash
returns `DECISION_CHANGED`; the final required approval atomically stores the
last approval, immutable decision record, final audit event, and finalized room
state.

## HTTP adapter

- `POST /api/rooms`
- `GET /api/rooms/:roomId`
- `POST /api/rooms/:roomId/claim-seat`
- `POST /api/rooms/:roomId/positions`
- `POST /api/rooms/:roomId/proposals`
- `POST /api/rooms/:roomId/objections`
- `POST /api/rooms/:roomId/resolve-objection`
- `POST /api/rooms/:roomId/votes`
- `GET /api/rooms/:roomId/final-decision`
- `POST /api/rooms/:roomId/approval`
- `GET /api/rooms/:roomId/decision-record`

Mutation routes require `Authorization: Bearer <access-token>` and
`If-Match: <room-version>`. `POST /api/rooms` is the exception: it requires the
bearer token only, because the room does not exist yet. Bodies use the canonical contract schemas.

The isolated `POST /api/dev/rooms/:roomId/phase` route exists only for the demo
flow. It requires `ALLOW_DEMO_PHASE_TRANSITIONS=true`, a claimed participant,
the current version, the literal `demo` room, and the next deliberate phase in
the sequence.

WebMCP exposes phase-scoped voting, preview, approval-request, and finalized
record tools. `approve_final_decision` never records an approval directly: it
returns `HUMAN_CONFIRMATION_REQUIRED`. The visible room UI displays the exact
candidate and hash, requires an explicit confirmation checkbox, and then sends
the approval through `ApiRoomClient`.

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
