# Backend integration

## Canonical boundary

`src/contracts/room.ts` is the only public room DTO/action boundary. Database
rows are mapped to `RoomState` in `src/lib/supabase/room-state.ts`; `user_id`
is used to derive `selfParticipantId` and `isClaimed`, then discarded.

The browser implementation is `ApiRoomClient` in
`src/clients/api-room-client.ts`. It implements the canonical `RoomClient`
interface. The implemented flow covers room loading, legacy demo seat claiming,
position and constraint creation, proposal submission, deliberation, voting,
exact-decision preview, human approval, finalization, and snapshot
subscriptions.

## Room creation and canonical authority

`POST /api/rooms` creates a private, non-demo room. `CreateRoomInput` is a
strict `{ title, brief, creatorName, creatorRole, decisionPolicy? }` schema. It
cannot carry owner/participant/user IDs, meeting or decision roles, action
origin, or a participant array. Missing policy defaults to `owner_decides` in
trusted domain logic.

`public.create_room` derives identity from `auth.uid()` and atomically creates
the room plus exactly one claimed human participant. That participant receives
`meeting_role = owner` and `decision_role = decision_maker`; its ID is stored as
`rooms.owner_participant_id`. The room stores `decision_policy` as either
`owner_decides` or `equal_authority_consensus` and returns only `roomId` plus
`ownerParticipantId`. Normal production creation creates no placeholder seats
and no invitation capabilities.

Room ids are opaque and collision-retried (`rm_7P3KQ8M2`). The room id is not a
security boundary. The bound owner participant makes `can_read_room` true for
the creator without weakening RLS. `room.created` identifies that participant
as the actor and records version 0 → 0.

The database protects owner integrity with a non-null room owner pointer, a
deferrable foreign key, a partial unique index allowing at most one `owner`
meeting role per room, and deferred cross-table triggers that require exactly
one matching owner at transaction commit. Browser roles have no write grant on
these tables.

## Deprecated seat invitations

The pre-Slice-1 invitation preview, claim, regenerate, and revoke contracts and
routes remain temporarily isolated for backward compatibility and demo-era
fixtures. Normal creation no longer calls them and cannot produce a
predetermined seat. Slice 2 will replace them with general room admission and
passcode capability behavior; do not extend the legacy seat model.

Invitation preview and claim are pre-membership boundaries. They accept the raw
capability in the POST body, not the URL path, and return only
`RoomInvitePreview` or `ClaimInvitationResult`. A valid preview shows the room
title, brief, and predetermined seat; invalid, expired, revoked, or
foreign-claimed tokens use the `inviteValid: false` branch with no room details.
Claiming is atomic, consumes the capability for other sessions, assigns
`participants.user_id = auth.uid()`, bumps the room version, and audits
`participant.seat_claimed`.

Organizers can manage unclaimed invitations while the room is still in `input`.
`regenerate_room_invitation` rotates the stored hash, clears expiry/revocation
state, bumps the room version, audits `invitation.regenerated`, and returns a
fresh invite URL. `revoke_room_invitation` marks the unclaimed capability
revoked, bumps once, audits `invitation.revoked`, and is idempotent if repeated.
Both operations derive organizer authority from `rooms.organizer_user_id`; the
request body can only name the target participant seat.

`RoomOnboardingClient` (`ApiRoomOnboardingClient`) remains the browser surface
for creation and the deprecated preview/claim endpoints. It is separate from
`RoomClient` and carries no room version.

## Authentication

`ApiRoomClient` calls Supabase anonymous sign-in once per browser storage
context. API calls carry the access token as a bearer token. Route handlers
validate that token with Supabase Auth and create a request-scoped authenticated
Supabase client. They never accept an auth user ID or participant ID as actor
authority.

Postgres resolves `auth.uid()` to the bound participant inside each mutation
transaction. Legacy `claimSeat` remains demo/backward-compatibility behavior;
its `seatId` never becomes trusted actor evidence.

## Concurrency and mutations

`ApiRoomClient` caches the latest observed room version and sends it through
`If-Match`. The HTTP adapter converts that to domain command context. TypeScript
domain operations validate input, phase, and the observed version. Transactional
Postgres RPC functions lock the room row and repeat identity, phase, version,
and cross-room checks before writing.

Every successful mutation increments `rooms.version` and inserts its audit event
in the same transaction. A stale version returns `STALE_ROOM_STATE` without a
write. Once finalized, every room mutation returns `ALREADY_FINALIZED`.

Readiness and production phase progression are regular room mutations. A
claimed human can call `mark_my_input_ready` only during `input`, only for their
own seat, and only after publishing a position. The owner-only
`advance_room_phase` route moves through `input → proposals → deliberation →
voting → approval`, enforcing joined/position/ready prerequisites, an active
proposal, no unresolved blocking conflict, and the shared voting rules.

Participant votes are upserted by participant and proposal. Only the required
human participants count toward approval readiness. Entering approval requires
one active proposal, no open blocking conflict, a vote from every required
participant, no `request_changes` vote, and a strict majority of required
participants supporting the proposal. Demo and production phase functions share
that decision logic.

This voting/approval engine is intentionally retained compatibility code. It
still reads the private `participants.required_for_approval` column and does not
yet implement either canonical `decisionPolicy`. `requiredForApproval` is no
longer present in `RoomState`; policy-aware Alignment and finalization are
deferred to a later slice rather than simulated here.

The approval candidate is stored as canonical JSON and hashed with SHA-256.
Approvals are participant-scoped and bound to that exact hash. A changed hash
returns `DECISION_CHANGED`; the final required approval atomically stores the
last approval, immutable decision record, final audit event, and finalized room
state.

## HTTP adapter

- `POST /api/rooms`
- `GET /api/rooms/:roomId`
- `POST /api/rooms/:roomId/claim-seat` (legacy/demo compatibility)
- `POST /api/rooms/:roomId/ready`
- `POST /api/rooms/:roomId/phase`
- `POST /api/rooms/:roomId/invitations/regenerate` (deprecated)
- `POST /api/rooms/:roomId/invitations/revoke` (deprecated)
- `POST /api/rooms/:roomId/positions`
- `POST /api/rooms/:roomId/proposals`
- `POST /api/rooms/:roomId/objections`
- `POST /api/rooms/:roomId/resolve-objection`
- `POST /api/rooms/:roomId/votes`
- `GET /api/rooms/:roomId/final-decision`
- `POST /api/rooms/:roomId/approval`
- `GET /api/rooms/:roomId/decision-record`
- `POST /api/invitations/preview` (deprecated)
- `POST /api/invitations/claim` (deprecated)

Mutation routes require `Authorization: Bearer <access-token>` and
`If-Match: <room-version>`. `POST /api/rooms` and the two `/api/invitations/*`
routes are the exceptions: they require the bearer token only, because either
the room does not exist yet or the caller cannot read its version before
claiming. Bodies use the canonical contract schemas.

The isolated `POST /api/dev/rooms/:roomId/phase` route exists only for the demo
flow. It requires `ALLOW_DEMO_PHASE_TRANSITIONS=true`, a claimed participant,
the current version, the literal `demo` room, and the next deliberate phase in
the sequence.

The isolated `POST /api/dev/rooms/:roomId/scenario` route resets and reseeds the
shared demo room as either `multi_user` or `solo_judge`. It requires an
authenticated browser session, the literal `demo` room, and
`ALLOW_DEMO_RESET=true`. After authenticating the caller, the route alone uses
the server-only `SUPABASE_SERVICE_ROLE_KEY`; the reset RPC is revoked from
browser roles. Solo mode also requires one canonical human role; that
participant is the only human decision-maker, while the other three
participants are visibly marked as simulations. The reset is transactional and
uses a narrowly scoped database trigger bypass so a finalized demo can be
replayed without weakening the normal finalized-room guard.

WebMCP exposes phase-scoped voting, preview, approval-request, and finalized
record tools. `approve_final_decision` never records an approval directly: it
returns `HUMAN_CONFIRMATION_REQUIRED`. The visible room UI displays the exact
candidate and hash, requires an explicit confirmation checkbox, and then sends
the approval through `ApiRoomClient`.

WebMCP authority is the browser session's claimed participant, not a separate
agent account. Read-only tools may be available before a seat is claimed if the
session can already read the room, but participant mutation tools are hidden and
guarded until `selfParticipantId` is non-null. Tool schemas contain no actor,
participant, user, origin, role, or confirmation fields; the WebMCP context
builds `origin = webmcp` and never forwards `humanConfirmed`.

## Post-hackathon delegation design

WebMCP is interactive browser-session delegation: an agent can prepare or
request actions while the human is present, and the server still resolves the
claimed participant from the browser's authenticated session. A future
server-side delegated runner would be a distinct capability, not a reuse of
WebMCP credentials.

The proposed `participant_delegations` table should store `id`, `room_id`,
`participant_id`, `created_by_user_id`, `delegate_subject`, `allowed_actions`,
`action_budget`, `used_action_count`, `expires_at`, `revoked_at`, `created_at`,
and `last_used_at`. It should have RLS enabled with no browser grants and be
reachable only through narrowly scoped SECURITY DEFINER functions. The
participant must already belong to `created_by_user_id`, and a unique active
delegation constraint per participant/delegate pair should prevent ambiguous
authority.

If unattended delegation ships, add a distinct action origin such as
`delegated_agent` rather than overloading `webmcp`. Domain operations should
receive the same `MutationContext` shape, but a delegate resolver should derive
the participant from an unexpired, unrevoked delegation row, decrement the
budget in the same transaction as the write, and audit both the participant
authority and delegated origin.

Delegates must never be able to record final approval. Final approval should
remain restricted to `origin = manual_ui`, an authenticated required human
participant, `humanConfirmed = true`, and the exact reviewed decision hash. The
delegation security suite should prove expiry, revocation, budget exhaustion,
participant scoping, room scoping, immutable finalization, and final-approval
refusal.

## Solo-judge orchestration

Solo-judge reactions run in Postgres through the shared room repository, after
reads and successful mutations from both the manual UI and WebMCP. There are no
browser or WebMCP simulation mutation tools. Internal simulation functions are
not executable by `anon` or `authenticated`; they record the simulated
participant as actor authority and `simulation` as action origin.

The demo rules are deterministic and intentionally scenario-specific:

- simulated participants contribute their seeded positions;
- ambitious proposals can produce engineering-capacity, accessibility, and
  campaign-deadline reactions;
- a revision that explicitly reduces scope, preserves accessibility, and keeps
  the launch date resolves applicable blockers and advances voting;
- simulated participants cast deterministic votes, but never human approvals;
- only the selected human can approve the exact decision hash and finalize.

An advisory transaction lock serializes orchestration for the room. A private
reaction ledger with unique `(room_id, reaction_key)` entries makes repeated,
concurrent, or replayed settlement calls idempotent. A bounded loop settles all
newly enabled reactions and phase transitions before returning the refreshed
canonical snapshot. These normalized text predicates are demo fixtures, not a
general decision engine.

## Realtime

Only the `rooms` table is in the Realtime publication for this milestone. Every
mutation changes its version, so `ApiRoomClient` receives a lightweight room
update notification, invalidates its snapshot, refetches the canonical
`RoomState`, and calls subscribers. Raw change payloads never reach UI or 3D
components.

## Frontend handoff

Instantiate one `ApiRoomClient` per browser application session. `RoomProvider`
exposes the canonical room snapshot and actions, including
`startDemoScenario`. No component should import Supabase table types or call
Supabase mutation APIs. Render mode and participant labels from
`RoomState.demoMode`, `participant.kind`, `participant.meetingRole`, and
`participant.decisionRole`. Continue to feed 3D only with
`createRoomVisualizationState(room)`; the projection includes participant kind
and activity origin without giving the 3D layer any orchestration authority.

For a hosted project, enable Anonymous Sign-Ins, apply the migration and seed,
set the two public Supabase environment variables, and leave both
`ALLOW_DEMO_PHASE_TRANSITIONS` and `ALLOW_DEMO_RESET` disabled outside a
controlled demo environment. The shared `demo` room is a single global fixture,
so starting a scenario intentionally replaces its current state for every
connected demo browser.
