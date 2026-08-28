You are building the **frontend, UX, and 3D visualization layer** for a hackathon project currently called **3D Office WebMCP App**.

Another engineer is developing the backend, domain operations, Supabase integration, authorization, WebMCP adapters, concurrency rules, and server-side decision logic in parallel.

Your highest architectural priority is:

> **The frontend must integrate with the real backend later by replacing `MockRoomClient` with `ApiRoomClient`, without redesigning any 2D or 3D component.**

Core product principle:

> **Agents negotiate. People decide.**

Do not invent backend business logic inside React or React Three Fiber components.

---

# 1. Shared Integration Contract — Mandatory

Both frontend and backend workstreams use one canonical integration contract:

```text
src/contracts/room.ts
```

This file is the source of truth for shared:

* DTOs;
* enums;
* action inputs;
* action results;
* `RoomState`;
* activity event types;
* final-decision types.

Do not independently redefine equivalent shared types elsewhere in the frontend.

If `src/contracts/room.ts` already exists:

* inspect it first;
* import from it;
* do not create competing definitions;
* do not casually rewrite it.

If a shared type must change:

1. change the canonical contract;
2. keep it serializable and presentation-independent;
3. then update the frontend implementation.

The contract must not import:

* React;
* React Three Fiber;
* Drei;
* Supabase implementation details;
* route handlers;
* Node-only infrastructure;
* visual components.

It should contain only shared serializable application types.

---

# 2. Ownership Boundary

The frontend workstream owns:

```text
MockRoomClient
      ↓
frontend room snapshot
      ↓
 ┌──────────────┬──────────────────────────────┐
 ↓              ↓                              ↓
2D UI       Activity UI       createRoomVisualizationState()
                                         ↓
                                      3D Scene
```

The backend workstream owns the future real implementation:

```text
ApiRoomClient
      ↓
Server/API Adapter
      ↓
Domain Operations
      ↓
Authorization
      ↓
Supabase
```

The integration goal is:

```text
MockRoomClient
      ↓ replace with
ApiRoomClient
```

without redesigning:

* participant UI;
* proposal UI;
* conflict UI;
* voting UI;
* approval UI;
* activity ledger;
* visualization view model;
* 3D scene.

---

# 3. Canonical Dependency Direction

Use this architecture:

```text
                               WebMCP Adapter
                                     │
                                     ▼
Browser UI → ApiRoomClient → Server/API Adapter → Domain Operations
                                                     │
                                                     ▼
                                                Authorization
                                                     │
                                                     ▼
                                                 Supabase DB
                                                     │
                                              Supabase Realtime
                                                     │
                                                     ▼
                                                ApiRoomClient
                                                     │
                                                     ▼
                                                  RoomState
                                                   /     \
                                                  /       \
                                               2D UI   View Model
                                                          │
                                                          ▼
                                                         3D
```

Manual UI, WebMCP, and future expert services must ultimately use the same backend domain operations.

The frontend must never create a competing business-logic path.

---

# 4. Frontend Boundary Rules

UI and 3D components must never:

* write directly to Supabase tables;
* query database tables directly;
* implement server authorization;
* implement authoritative participant identity;
* perform authoritative room-phase transitions;
* calculate authoritative approval validity;
* calculate authoritative finalization;
* trust a client-supplied participant identity;
* consume raw Supabase realtime payloads;
* own canonical decision state.

All mutations must go through `RoomClient`.

Correct:

```text
Component
→ RoomClient.castMyVote(...)
→ ActionResult
→ updated RoomState
```

Incorrect:

```text
Component
→ supabase.from("votes").insert(...)
```

Do not create a production `SupabaseRoomClient`.

The real production adapter is:

```text
ApiRoomClient
```

Supabase may eventually be used client-side for authentication and realtime notifications where appropriate, but authoritative writes must pass through the backend/domain layer.

---

# 5. Product Concept

3D Office WebMCP App is a shared decision room where multiple human participants retain separate identities and each may have their own browser agent.

Agents can help participants:

* add structured positions;
* publish constraints;
* submit proposals;
* raise objections;
* suggest trade-offs;
* revise proposals;
* vote within participant authority;
* prepare a candidate final decision.

Humans retain final approval authority.

The application is NOT a generic AI chat room.

The canonical application state consists of structured objects:

```text
Room
├── Participants
├── Decision Brief
├── Positions
├── Constraints
├── Proposals
├── Conflicts / Objections
├── Trade-offs
├── Votes
├── Approvals
└── Activity / Audit Events
```

Conversation-style rendering may be used for presentation, but chat messages must never become the canonical application state.

---

# 6. Tech Stack

Use:

* Next.js App Router
* TypeScript
* React
* React Three Fiber
* Drei
* Tailwind CSS if useful

Do not add a global state framework unless there is a concrete architectural need.

Prefer normal React state/context around the room snapshot.

Do not add unnecessary:

* agent frameworks;
* CRDT frameworks;
* game engines;
* physics engines;
* complex state machines;
* heavyweight animation systems.

---

# 7. Canonical Room Phase

Use exactly:

```ts
export type RoomPhase =
  | "input"
  | "proposals"
  | "deliberation"
  | "voting"
  | "approval"
  | "finalized";
```

Do not invent alternative phase names.

The frontend may visually group these phases into a simpler product journey if useful, but the semantic state uses the canonical values above.

---

# 8. Canonical Room State

Use the shared contract from:

```text
src/contracts/room.ts
```

The public room state should follow this conceptual shape:

```ts
export interface RoomState {
  id: string;
  title: string;
  brief: string;

  phase: RoomPhase;
  version: number;

  selfParticipantId: string | null;
  activeProposalId: string | null;

  participants: Participant[];
  positions: Position[];
  constraints: Constraint[];
  proposals: Proposal[];
  conflicts: Conflict[];
  tradeoffs: Tradeoff[];
  votes: Vote[];
  approvals: Approval[];
  activity: ActivityEvent[];
}
```

Requirements:

* IDs are opaque strings.
* Timestamps are ISO-8601 strings.
* Network DTO fields use `null` instead of `undefined` where a value is explicitly nullable.
* Do not expose Supabase authentication identifiers such as `user_id` unless there is a concrete frontend requirement.

`selfParticipantId` identifies which participant belongs to the current browser session.

It may be used for UX such as:

```text
You
Your vote
Your approval
Your office
```

It is informational only.

It is NOT authorization input.

---

# 9. Identity Invariant

Never create mutation inputs that trust a browser-supplied participant identity.

Incorrect:

```ts
castVote({
  participantId: "designer",
  proposalId,
  choice: "support",
});
```

Correct:

```ts
castMyVote({
  proposalId,
  choice: "support",
});
```

The server will derive:

```text
authenticated user
→ room membership
→ participant
→ authorized actor
```

The frontend must assume that this authorization is authoritative server-side.

Frontend UI may hide or disable invalid controls for UX, but that is not security.

---

# 10. Actor Identity vs Action Origin

Do not mix actor authority with execution origin.

Use concepts equivalent to:

```ts
export type ActorType =
  | "participant"
  | "expert"
  | "system";

export type ActionOrigin =
  | "manual_ui"
  | "webmcp"
  | "simulation"
  | "expert_service"
  | "system";
```

Examples.

Human participant manually using the UI:

```text
actorType = participant
origin = manual_ui
```

That participant's browser agent acting through WebMCP:

```text
actorType = participant
origin = webmcp
```

A deterministic simulated participant:

```text
actorType = participant
origin = simulation
```

An advisory Security Agent:

```text
actorType = expert
origin = expert_service
```

A browser agent is NOT a separate participant authority.

A participant may separately have:

```ts
kind: "human" | "simulation";
```

Experts should not pretend to be participants.

Experts do not vote or approve.

---

# 11. Activity Event Contract

Use the canonical shared type from `src/contracts/room.ts`.

Conceptually:

```ts
export interface ActivityEvent {
  id: string;

  actorType:
    | "participant"
    | "expert"
    | "system";

  actorId: string;
  actorName: string;

  origin:
    | "manual_ui"
    | "webmcp"
    | "simulation"
    | "expert_service"
    | "system";

  action: string;

  entityType: string | null;
  entityId: string | null;

  createdAt: string;
}
```

The frontend must visually distinguish:

* manual human actions;
* browser-agent actions;
* simulated participant actions;
* advisory expert actions;
* system actions.

But these visual distinctions must not imply different participant authority where none exists.

The activity ledger is a product feature, not developer logging.

---

# 12. Position and Constraint Contract

Positions and constraints are separate semantic entities.

`addMyPosition` may accept associated structured constraints.

Conceptually:

```ts
export interface AddPositionInput {
  summary: string;
  category: string | null;
  priority: string | null;

  constraints: Array<{
    category: string;
    text: string;
    priority: string | null;
  }>;
}
```

The mock implementation may create the position and associated constraints together.

This preserves stable constraint IDs that objections can reference later.

Do not create incompatible visual-only versions of constraints.

---

# 13. Canonical Action Result

Use exactly one result family across frontend and backend.

Conceptually:

```ts
export type ActionResult<T = null> =
  | {
      ok: true;
      data: T;
      roomVersion: number;
      message: string;
    }
  | {
      ok: false;
      error: {
        code:
          | "VALIDATION_ERROR"
          | "NOT_AUTHORIZED"
          | "WRONG_PHASE"
          | "STALE_ROOM_STATE"
          | "UNRESOLVED_BLOCKING_CONFLICT"
          | "HUMAN_CONFIRMATION_REQUIRED"
          | "DECISION_CHANGED"
          | "ALREADY_FINALIZED";
        message: string;
        recovery?: string;
      };
      roomVersion: number;
    };
```

Do not create a frontend variant with optional `data` or optional `message`.

For actions without meaningful response payload:

```ts
ActionResult<null>
```

is sufficient.

Create one reusable UI mechanism for showing structured action failures and recovery text.

---

# 14. Mandatory RoomClient Boundary

The frontend programs against one service abstraction:

```ts
export interface RoomClient {
  getRoom(roomId: string): Promise<RoomState>;

  subscribe(
    roomId: string,
    callback: (state: RoomState) => void
  ): () => void;

  claimSeat(
    roomId: string,
    input: ClaimSeatInput
  ): Promise<ActionResult>;

  addMyPosition(
    roomId: string,
    input: AddPositionInput
  ): Promise<ActionResult>;

  submitProposal(
    roomId: string,
    input: SubmitProposalInput
  ): Promise<ActionResult>;

  raiseObjection(
    roomId: string,
    input: RaiseObjectionInput
  ): Promise<ActionResult>;

  proposeTradeoff(
    roomId: string,
    input: ProposeTradeoffInput
  ): Promise<ActionResult>;

  castMyVote(
    roomId: string,
    input: CastVoteInput
  ): Promise<ActionResult>;

  previewFinalDecision(
    roomId: string
  ): Promise<ActionResult<FinalDecisionPreview>>;

  approveFinalDecision(
    roomId: string,
    input: {
      decisionHash: string;
    }
  ): Promise<ActionResult>;

  getDecisionRecord(
    roomId: string
  ): Promise<ActionResult<DecisionRecord>>;
}
```

The current frontend implementation is:

```text
MockRoomClient
```

The future production implementation is:

```text
ApiRoomClient
```

Do NOT create:

```text
SupabaseRoomClient
```

as the production architecture.

The backend engineer may initially implement only the methods required by their current milestone.

The frontend mock can support more of the demo flow, but shared method shapes must remain compatible.

---

# 15. Room State Ownership in React

Create one room-level frontend owner/provider for the latest `RoomState` snapshot.

For example:

```text
RoomPage
  ↓
RoomProvider / useRoom
  ↓
RoomClient
```

Components should consume semantic state through this layer.

Do not let individual components independently call mock data or maintain competing copies of domain state.

Conceptually:

```text
RoomClient
   ↓
Room Provider
   ↓
latest RoomState snapshot
   ├──→ ParticipantPanel
   ├──→ ProposalPanel
   ├──→ ConflictBoard
   ├──→ ActivityLedger
   └──→ createRoomVisualizationState()
                    ↓
                R3F Scene
```

The backend remains authoritative.

The React provider only holds the latest frontend snapshot.

---

# 16. Realtime Contract

`RoomClient.subscribe()` exposes canonical `RoomState` snapshots.

Components must not depend on raw Supabase realtime payloads.

The production implementation may eventually work conceptually like:

```text
Supabase Realtime notification
        ↓
invalidate/refetch canonical room snapshot
        ↓
ApiRoomClient
        ↓
RoomState
        ↓
subscribe callback
```

The frontend only knows:

```ts
callback(roomState)
```

This prevents database event formats from leaking into the UI and 3D scene.

`MockRoomClient.subscribe()` should imitate this contract locally.

---

# 17. Approval Invariant

Voting and approval are different concepts.

Voting means:

> I support, oppose, abstain, or request changes to this candidate.

Approval means:

> I reviewed this exact final plan and authorize my participant identity's approval.

The frontend must keep these visibly separate.

The flow is:

```text
previewFinalDecision()
        ↓
exact final candidate
        ↓
decisionHash
        ↓
visible human review
        ↓
explicit approval interaction
        ↓
approveFinalDecision({
  decisionHash
})
```

The frontend must never infer approval from:

* a vote;
* silence;
* participation;
* an agent message;
* previous approval of another version.

If the backend returns:

```text
DECISION_CHANGED
```

the frontend must:

1. invalidate the previous review state;
2. return to final review;
3. show the updated candidate;
4. require explicit approval again.

If it returns:

```text
HUMAN_CONFIRMATION_REQUIRED
```

keep the user in a visible confirmation/review flow.

Do not automatically retry approval.

---

# 18. Room State Machine UX

Design the interface around:

```text
INPUT
  ↓
PROPOSALS
  ↓
DELIBERATION
  ↓
VOTING
  ↓
APPROVAL
  ↓
FINALIZED
```

Each phase should visibly affect both the DOM interface and the 3D environment.

## Input

Focus on:

* meeting brief;
* participant positions;
* participant constraints.

## Proposals

Focus on:

* candidate proposals;
* active proposal;
* proposal creation;
* revisions.

## Deliberation

Focus on:

* active proposal;
* objections;
* conflict relationships;
* trade-offs;
* revisions.

## Voting

Focus on:

* candidate proposal;
* participant vote status;
* own vote action.

## Approval

Focus on:

* exact final-decision preview;
* required human approvers;
* completed approvals;
* missing approvals;
* explicit final review.

## Finalized

Focus on:

* immutable decision record;
* rationale;
* owners;
* deadlines;
* dissent;
* approvals;
* audit history.

Frontend controls may react to phase for UX.

Do not treat client-side phase checks as authoritative authorization.

---

# 19. Primary Route

Create:

```text
/room/demo
```

---

# 20. Revised Desktop Experience

The application should feel like a shared office environment with three clearly distinguishable spatial layers:

1. a large central meeting room;
2. up to 10 mini offices for individual participants;
3. a shared/common area for cross-cutting activity and system-wide signals.

The desktop UI should be composed around a large central 3D canvas, with semantic DOM panels surrounding or supporting it.

Suggested desktop composition:

```text
┌──────────────────────────────────────────────────────────────┐
│ Meeting Title · Current Phase · Room Status · You Are       │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│                    3D OFFICE ENVIRONMENT                     │
│                                                              │
│   ┌──────────────────────────────────────────────────────┐   │
│   │               Large Meeting Room                     │   │
│   │  - active proposal / negotiation table              │   │
│   │  - visible agent activity during deliberation       │   │
│   │  - shared decision focus                            │   │
│   └──────────────────────────────────────────────────────┘   │
│                                                              │
│   Mini Offices (up to 10)                                   │
│   [Office 1] [Office 2] [Office 3] [Office 4] [Office 5]    │
│   [Office 6] [Office 7] [Office 8] [Office 9] [Office 10]   │
│                                                              │
│   Shared/Common Area                                         │
│   - open issues / alerts / system activity / expert advice   │
│   - room-wide progress and consensus signals                 │
│                                                              │
├───────────────────────────────┬──────────────────────────────┤
│ Main Semantic Decision UI     │ Participants / Offices       │
│                               │                              │
│ - meeting brief               │ - participant list           │
│ - positions / constraints     │ - office occupancy           │
│ - active proposal             │ - role / status              │
│ - objections / conflicts      │ - vote / approval state      │
│ - trade-offs                  │ - simulated participant tags │
├───────────────────────────────┴──────────────────────────────┤
│ Activity / Audit Ledger                                     │
└──────────────────────────────────────────────────────────────┘
```

Requirements:

1. The 3D environment must remain the visual centerpiece.
2. The central meeting room must visibly represent shared deliberation.
3. Mini offices must represent participant-specific ownership and identity.
4. The common area must represent shared status, alerts, or cross-cutting system activity.
5. Structured semantic information must remain fully understandable in DOM UI.
6. The experience must still work if the 3D scene fails to load.
7. The page should scale gracefully even if fewer than 10 offices are active.
8. The initial seeded demo may use only 4 active participants, while the environment should be visually designed to support up to 10 participant offices.
9. Accessibility must not depend on the canvas.
10. Important actions must have visible text equivalents.

---

# 21. 3D Visualization Contract

The 3D office is a projection of semantic application state.

Create:

```ts
function createRoomVisualizationState(
  room: RoomState
): RoomVisualizationState
```

Conceptually:

```ts
export interface RoomVisualizationState {
  phase: RoomPhase;

  participants: VisualParticipant[];
  constraints: VisualConstraint[];
  proposals: VisualProposal[];
  conflicts: VisualConflict[];
  recentActivity: VisualActivity[];

  consensus: {
    voteProgress: number;
    approvalProgress: number;
    hasBlockingConflict: boolean;
  };
}
```

`RoomVisualizationState` belongs to the visualization layer.

It is derived entirely from canonical `RoomState`.

The React Three Fiber scene receives ONLY the visualization model.

The 3D layer must never:

* query Supabase;
* call application APIs;
* call `RoomClient`;
* authorize actions;
* execute mutations;
* calculate authoritative state transitions;
* calculate authoritative consensus;
* own vote state;
* own approval state;
* own canonical proposal state.

If backend storage changes without changing `RoomState`, the 3D architecture should not change.

---

# 22. 3D Environment Structure

The office should not be a single flat room.

Instead, structure the 3D environment into three semantic zones:

## 1. Large Central Meeting Room

This is the core collective decision space.

It should visually communicate:

* the active proposal;
* current negotiation focus;
* shared deliberation;
* browser-agent meeting activity;
* transitions between phases;
* final-decision review.

This is the main room where the participant agents are visually represented as convening around the shared decision.

The central table in this room should be the primary focal object for:

* proposals;
* revisions;
* trade-offs;
* final candidate decision.

Important shared events should feel like they happen here first.

## 2. Mini Offices

Create up to 10 mini offices representing participant-owned spaces.

Each mini office should communicate:

* participant identity;
* role;
* ownership;
* local constraints / positions;
* current activity;
* vote state;
* approval state.

The seeded demo may initially activate only:

* Product Manager
* Engineer
* Designer
* Marketing Lead

The remaining offices may appear as:

* empty;
* reserved;
* inactive;
* future participant slots.

Mini offices should make it visually obvious that each participant remains distinct and retains separate authority.

## 3. Shared / Common Area

This zone represents room-wide activity that is not owned by one participant alone.

It may include:

* open issue indicators;
* advisory expert activity;
* system activity;
* notifications;
* overall consensus state;
* room-wide progress.

This space should help communicate that the room is a shared decision environment, not only a collection of isolated personal offices.

---

# 23. 3D Semantic Mapping

Keep the office deliberately small and readable.

## Mini Offices Instead of Simple Desks

Each participant should have a small dedicated office or office station rather than only a desk.

Each office should show:

* participant identity;
* role;
* participant-owned constraints;
* local activity;
* vote state;
* approval state.

This helps visually reinforce separate authority and separate ownership.

Primary roles:

```text
Product Manager
Engineer
Designer
Marketing Lead
```

Simulated participants must clearly display:

```text
Simulated Participant
```

Never present simulation as a real human.

## Large Meeting Room / Central Table

The large meeting room is the collective decision center.

The central table represents the active proposal.

It may show:

* proposal documents;
* current proposal;
* proposal revisions;
* candidate final plan.

When a proposal becomes active, animate the visual document toward the table.

When deliberation intensifies, shared activity should visually concentrate here.

## Constraint Wall

Visualize participant-owned constraints.

Examples:

* engineering capacity;
* accessibility requirements;
* campaign deadline;
* onboarding improvement;
* dependency restrictions.

Constraints should remain visibly associated with their participant/source.

## Conflict Board

Visualize unresolved objections.

A conflict semantically connects:

```text
constraint ↔ proposal
```

Blocking conflicts should be more prominent than warnings.

Do not communicate severity only through color.

Also use one or more of:

* icons;
* labels;
* line styles;
* geometry;
* motion;
* thickness;
* spatial emphasis.

## Shared / Common Area Signals

The common area should display information that belongs to the whole room rather than one participant.

Examples:

* open issue count;
* advisory expert notices;
* room-wide alerts;
* consensus progress;
* system-triggered notifications;
* phase-wide status.

## Activity Visualization

Semantic actions should create lightweight spatial feedback.

Examples:

```text
position created
proposal submitted
objection raised
trade-off proposed
vote cast
approval recorded
```

Possible visual feedback:

* card movement;
* pulses;
* trails;
* brief labels;
* office indicators;
* central-meeting-room updates;
* conflict-link animation;
* common-area notifications.

Animations should communicate meaning rather than exist only as decoration.

---

# 24. 3D Scope Rules

Use:

* low-poly office assets;
* procedural geometry where convenient;
* simple environment assets;
* fixed or limited camera;
* lightweight animation;
* optimized lighting;
* minimal shadows.

Avoid:

* free-roaming player controls;
* physics;
* complex character controllers;
* giant environments;
* expensive realtime shadows;
* full avatar animation systems;
* game mechanics;
* business logic inside R3F components.

Performance and semantic clarity matter more than game-like freedom.

The 3d assets that you will be using are in the folder already.
---

# 25. Seeded Demo Scenario

Use one deterministic scenario.

Decision:

> **Should the startup ship an onboarding feature update within two weeks, and what scope should it have?**

Participants:

## Product Manager

Concerns:

* users should reach first value faster;
* onboarding completion should improve.

## Engineer

Constraints:

* implementation capacity is limited;
* no authentication rewrite;
* avoid fragile dependencies.

## Designer

Constraints:

* accessibility requirements;
* interaction consistency;
* visual consistency.

## Marketing Lead

Constraints:

* campaign date cannot move;
* product surface must stabilize before campaign cutoff.

Initial intentionally flawed proposal:

> **Rebuild onboarding as a custom multi-step flow with new event tracking and expanded personalization before the scheduled campaign launch.**

Seed conflicts:

Engineer:

```text
blocking capacity objection
```

Designer:

```text
blocking or warning accessibility-review objection
```

Optional future advisory expert:

Security Agent:

```text
analytics/privacy concern
```

The environment should support up to 10 mini offices, but the initial demo state may activate only 4 participant offices.

Unused offices may appear visually inactive or reserved.

The complete mock scenario should eventually be capable of demonstrating:

```text
constraints
→ proposal
→ objections
→ trade-off
→ revised proposal
→ voting
→ final review
→ independent approvals
→ finalized decision
```

However, do not implement the entire interaction flow in the first pass.

See the FIRST IMPLEMENTATION MILESTONE below.

---

# 26. MockRoomClient Rules

Until the real backend exists, implement deterministic local behavior through:

```text
MockRoomClient
```

Do NOT wire buttons directly to component `setState()` calls representing domain mutations.

Correct:

```text
UI action
→ RoomClient method
→ MockRoomClient
→ RoomState snapshot update
→ subscribe callback
→ React UI updates
→ visualization adapter updates
→ 3D updates
```

Incorrect:

```text
ConstraintForm
→ setConstraints([...])
```

where the component independently owns domain data.

Mock operations should imitate backend behavior enough for frontend development, but they must not become a second production domain implementation.

The mock may:

* validate basic input;
* produce deterministic objects;
* increment mock room version;
* produce activity events;
* simulate structured failures;
* emit updated snapshots.

These behaviors exist only to exercise the frontend contract.

Do not treat mock validation or mock authorization as production security.

---

# 27. Developer / Demo Controls

A clearly separated developer/demo panel may eventually provide deterministic actions such as:

* next mock phase;
* trigger seeded objection;
* resolve seeded conflict;
* simulate participant vote;
* simulate approval;
* reset demo.

These controls must be visually distinct from participant-facing actions.

Do not make judges confuse simulation controls with real participant actions.

---

# 28. Semantic 2D Components

Prefer small semantic components.

Suggested architecture:

```text
src/
  contracts/
    room.ts

  room-client/
    room-client.ts
    mock-room-client.ts

  components/
    room/
      room-provider.tsx
      phase-header.tsx
      participant-panel.tsx
      meeting-brief.tsx
      positions-panel.tsx
      proposal-panel.tsx
      conflict-board.tsx
      vote-panel.tsx
      final-approval.tsx
      activity-ledger.tsx

  visualization/
    room-view-model.ts
    room-visualization.tsx

    scene/
      office-scene.tsx
      central-meeting-room.tsx
      mini-office.tsx
      shared-common-area.tsx
      central-table.tsx
      constraint-wall.tsx
      conflict-visualization.tsx
      activity-trail.tsx
```

Do NOT create:

```text
room-client/types.ts
```

containing duplicate shared DTOs.

Shared application DTOs belong in:

```text
src/contracts/room.ts
```

Visualization-specific types may live in:

```text
visualization/room-view-model.ts
```

because those types are derived presentation models, not backend contracts.

---

# 29. UX Principle

The product must communicate:

> **Multiple humans are participating in one shared decision while retaining separate authority.**

Avoid making the experience feel like:

* one AI controlling everyone;
* generic chatbot bubbles;
* a multiplayer game;
* a normal project-management dashboard;
* autonomous agents with unrestricted authority.

Use the office metaphor to make WebMCP-mediated decision activity understandable.

Examples:

```text
participant adds constraint
→ constraint appears in or near their mini office

proposal submitted
→ document moves into the large meeting room central table

objection raised
→ conflict connection appears

trade-off accepted
→ conflict visibly weakens or resolves

vote cast
→ participant office vote indicator changes

approval recorded
→ independent approval indicator changes

all required approvals complete
→ room transitions visually to finalized state
```

The central meeting room should represent shared deliberation.

The mini offices should represent participant-specific perspective and authority.

The common area should represent room-wide signals.

---

# 30. Vote UX

Voting choices may include:

```text
support
oppose
abstain
request_changes
```

The frontend must clearly communicate:

> Voting evaluates the candidate.

A participant may only trigger:

```text
castMyVote(...)
```

for their own authenticated participant identity.

Do not expose UI that suggests voting for other participants.

---

# 31. Approval UX

Approval must clearly communicate:

> **I reviewed this exact final plan and authorize my approval.**

During approval show:

* complete final candidate;
* rationale;
* unresolved warnings;
* required approvers;
* completed approvals;
* pending approvals.

Do not place vote and approval in the same ambiguous control.

Do not automatically convert:

```text
support vote
```

into:

```text
approval
```

The approval view should feel intentionally more serious than voting.

---

# 32. Backend-Compatible Failure UX

Create a reusable failure treatment for `ActionResult`.

Examples.

For:

```text
STALE_ROOM_STATE
```

show something equivalent to:

> The room changed before this action completed. Review the latest state and retry if the action is still appropriate.

For:

```text
WRONG_PHASE
```

show that the action is no longer available in the current phase.

For:

```text
DECISION_CHANGED
```

return the participant to final review.

For:

```text
HUMAN_CONFIRMATION_REQUIRED
```

show explicit confirmation UI rather than automatically retrying.

For:

```text
NOT_AUTHORIZED
```

do not attempt client-side workarounds.

---

# 33. Backend Contract Comments

Where integration behavior is important, concise comments are allowed.

Example:

```ts
// BACKEND CONTRACT:
// Server derives participant identity from the authenticated session.
// Never send participantId as trusted authority.
```

Example:

```ts
// BACKEND CONTRACT:
// Production mutations may return STALE_ROOM_STATE when room.version changed.
```

Example:

```ts
// BACKEND CONTRACT:
// Approval is bound to the exact decisionHash returned by final preview.
```

Do not flood the codebase with redundant architecture comments.

---

# 34. What NOT to Build

Do not implement:

* authentication backend;
* Supabase schema;
* Supabase mutations from UI;
* database migrations;
* WebMCP tool handlers;
* server-side authorization;
* server-side expert orchestration;
* direct agent-to-agent communication;
* production decision finalization logic;
* production participant authorization logic.

Those belong to the backend/integration workstream.

You may define frontend expectations only through the canonical shared contract.

---

# 35. FIRST IMPLEMENTATION MILESTONE

For the first implementation pass, DO NOT build the entire product.

The purpose of the first pass is to prove that the architecture works end-to-end.

Stop after completing the following vertical slice.

## Step 1 — Inspect the Repository

Before changing code:

1. inspect the existing repository;
2. identify existing Next.js structure;
3. identify whether `src/contracts/room.ts` already exists;
4. identify any existing 3D assets/components;
5. summarize the architecture you found;
6. provide a concise implementation plan.

Do not rewrite working code without a reason.

## Step 2 — Shared Contract

Establish or consume:

```text
src/contracts/room.ts
```

Do not create duplicate frontend DTOs.

Ensure the frontend can import:

* `RoomState`;
* `RoomPhase`;
* participant types;
* position types;
* constraint types;
* proposal types;
* conflict types;
* activity types;
* relevant action inputs;
* `ActionResult`.

Only add shared fields that are necessary for the first vertical slice.

Do not prematurely model every stretch feature in detail.

## Step 3 — RoomClient

Implement the frontend abstraction:

```text
RoomClient
```

and its current local implementation:

```text
MockRoomClient
```

Do NOT implement the production `ApiRoomClient` in this workstream unless a tiny type-only placeholder is necessary for compilation.

The backend engineer owns the production implementation.

## Step 4 — Deterministic Seeded State

Create deterministic mock data for:

```text
/room/demo
```

Include:

* room title;
* decision brief;
* current phase;
* room version;
* Product Manager;
* Engineer;
* Designer;
* Marketing Lead;
* representative participant constraints;
* enough state to render the initial office.

Set one mock participant as:

```text
selfParticipantId
```

for local frontend demonstration.

The 3D environment should still be laid out to support up to 10 mini offices, even if only 4 are active.

## Step 5 — Room-Level State Owner

Create one room-level provider/hook that:

1. calls `RoomClient.getRoom(roomId)`;
2. stores the latest room snapshot;
3. subscribes through `RoomClient.subscribe()`;
4. exposes the room snapshot to the UI;
5. exposes RoomClient-backed actions where useful.

Visual components must not access mock data directly.

## Step 6 — Basic 2D Shell

Render the basic semantic application shell.

Minimum:

* meeting title;
* brief;
* phase;
* participants;
* current constraints;
* simple position/constraint action;
* basic activity ledger.

Do not over-polish.

## Step 7 — Visualization Adapter

Implement:

```ts
createRoomVisualizationState(room)
```

The function must be:

* deterministic;
* pure where practical;
* presentation-oriented;
* independent of APIs;
* independent of Supabase;
* independent of mutation behavior.

## Step 8 — Basic 3D Office

Implement a small R3F scene containing at minimum:

* one large central meeting room;
* up to 10 mini office slots;
* a shared/common area;
* a central table;
* a constraint wall;
* fixed or limited camera;
* lightweight lighting.

Do not build advanced animations yet.

The scene receives:

```text
RoomVisualizationState
```

only.

## Step 9 — Prove One Full Mutation Path

Implement exactly one meaningful end-to-end mock interaction:

```text
Engineer adds a structured constraint
        ↓
RoomClient.addMyPosition(...)
        ↓
MockRoomClient updates its state
        ↓
room.version increments
        ↓
ActivityEvent is created
        ↓
subscribe() emits a new RoomState snapshot
        ↓
2D interface updates
        ↓
createRoomVisualizationState() recomputes
        ↓
constraint appears/changes visibly in 3D
```

This mutation path is the architecture checkpoint.

The component must not mutate semantic state itself.

---

# 36. First-Pass Testing

Add focused tests appropriate to the frontend architecture.

At minimum test:

* `createRoomVisualizationState()` deterministically maps room state;
* `MockRoomClient.addMyPosition()` updates room state;
* room version increments;
* activity event is emitted;
* subscription receives an updated snapshot;
* the created constraint remains associated with the correct participant.

If practical, add one simple browser-level test proving:

```text
add constraint
→ DOM changes
→ semantic visualization state changes
```

Do not spend the first pass building exhaustive tests for later phases.

---

# 37. First-Pass Definition of Done

The first implementation pass is complete only when:

1. `/room/demo` loads.
2. The frontend imports shared application types from `src/contracts/room.ts`.
3. No competing frontend domain DTO definitions exist.
4. `RoomClient` exists.
5. `MockRoomClient` implements it.
6. A room provider owns the latest frontend snapshot.
7. The basic semantic 2D interface renders.
8. The 3D office renders.
9. Both surfaces consume the same `RoomState`.
10. The 3D scene receives only `RoomVisualizationState`.
11. Engineer can add one structured constraint through `RoomClient`.
12. The resulting state update appears in both 2D and 3D.
13. The room version changes.
14. An activity event appears.
15. No visual component writes directly to mock state.
16. No component writes directly to Supabase.
17. Vote/approval/backend logic has not been prematurely implemented.

Once these conditions pass:

**STOP.**

Do not continue into full deliberation, voting, approval, expert agents, or visual polish without a subsequent instruction.

---

# 38. Later Frontend Milestones

Architect the current work so later passes can add, in order:

```text
Milestone A
proposal visualization

Milestone B
objection + conflict visualization

Milestone C
trade-off + revision visualization

Milestone D
voting UX

Milestone E
final preview + decisionHash approval UX

Milestone F
finalized decision record

Milestone G
deterministic solo judge simulations

Milestone H
advanced semantic 3D animations

Milestone I
replace MockRoomClient with ApiRoomClient
```

Do not implement all of these in the first pass.

---

# 39. Integration Success Criterion

The architecture is successful if this replacement:

```text
MockRoomClient
      ↓
ApiRoomClient
```

does NOT require redesigning:

```text
RoomProvider
ParticipantPanel
PositionsPanel
ProposalPanel
ConflictBoard
VotePanel
FinalApproval
ActivityLedger
createRoomVisualizationState()
OfficeScene
CentralMeetingRoom
MiniOffice
SharedCommonArea
CentralTable
ConstraintWall
ConflictVisualization
```

The frontend should depend on semantic contracts, not storage implementation.

---

# 40. Final Product Success Criteria

When all frontend milestones are eventually complete, the experience should:

1. communicate the room's decision state clearly;
2. show multiple independent participants;
3. visibly preserve separate participant authority;
4. distinguish manual, WebMCP, simulation, expert, and system origins;
5. clearly label simulated participants;
6. make constraints spatially understandable;
7. make proposals visually central in the large meeting room;
8. make participant ownership clear through mini offices;
9. use the shared/common area for room-wide signals;
10. make conflicts visually obvious;
11. show negotiation as semantic change rather than chat;
12. make voting and approval clearly different;
13. work semantically without 3D;
14. use the same RoomState for 2D and 3D;
15. integrate with `ApiRoomClient` without visual architecture changes;
16. communicate the core product principle:

> **Agents negotiate. People decide.**

---

# 41. Working Style

Before implementation:

1. inspect the repository;
2. summarize existing architecture;
3. identify reusable code/assets;
4. produce a concise plan.

During implementation:

* work vertically;
* keep changes small;
* typecheck frequently;
* run relevant tests;
* fix errors before continuing;
* prefer explicit code over premature abstraction;
* do not over-polish isolated components;
* preserve shared contract boundaries.

When uncertain between:

```text
clever abstraction
```

and:

```text
simple explicit implementation
```

prefer the simple explicit implementation.

At the end of the first implementation milestone, report:

1. files added or changed;
2. architecture created;
3. canonical shared contract usage;
4. `RoomClient` / `MockRoomClient` design;
5. room-state ownership;
6. visualization adapter design;
7. 2D/3D synchronization path;
8. tests executed and results;
9. known limitations;
10. the cleanest next frontend milestone.

Then stop.
