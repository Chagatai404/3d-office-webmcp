# 3D Office WebMCP — Canonical Shared Context

> **Hackathon:** OpenAI WebMCP Challenge  
> **Purpose:** source of truth for product, domain, WebMCP, browser UI, 3D
> presentation, testing, and demo decisions.
>
> This document supersedes the earlier multi-office / desktop-window / 2D floor
> plan direction. Backend authority and decision mechanics remain intact; the
> product presentation is now centered on one simple 3D meeting room with
> camera-driven workspaces.

---

# 1. Product definition

## One-line pitch

**3D Office WebMCP is a shared decision room where every participant can bring
their own browser agent. Agents surface constraints, negotiate proposals, and
resolve trade-offs while every human keeps separate identity, vote, and final
approval authority.**

## Core principle

> Agents negotiate. People decide.

This is not a generic multi-agent chat room and not a virtual-office simulator.
It is a structured collective-decision product.

The canonical room contains:

```text
Room
├── Participants
├── Decision brief
├── Positions
├── Constraints
├── Proposals
├── Conflicts / objections
├── Trade-offs / revisions
├── Votes
├── Approvals
└── Audit events
```

Chat-like text may be used for presentation, but authoritative state is
structured.

---

# 2. Primary hackathon scenario

The seeded MVP scenario is a cross-functional startup team deciding whether and
how to ship an onboarding update within two weeks.

Human roles:

- Product Manager
- Engineer
- Designer
- Marketing Lead

Optional advisory expert actors may include Security, QA, Legal/Compliance, or
Finance. Experts advise; they never vote or approve.

The seeded initial proposal should create meaningful tension around engineering
capacity, accessibility, launch timing, analytics/privacy, and QA scope so a
judge can see the room move from conflict to negotiated agreement.

---

# 3. External product journey

The external experience stays intentionally simple:

1. **Setup** — organizer creates a room, defines the decision, configures roles,
   and shares role-specific invite links.
2. **Input** — each participant publishes their own constraints, requirements,
   and position.
3. **Deliberation** — browser agents and humans inspect proposals, raise
   objections, propose trade-offs, and revise the candidate.
4. **Decision** — participants vote, review the exact final plan, and approve or
   reject it independently.

The internal state machine remains:

```text
INPUT -> PROPOSALS -> DELIBERATION -> VOTING -> APPROVAL -> FINALIZED
```

Tool availability and allowed mutations follow this state machine.

---

# 4. Canonical room UX

## 4.1 One meeting room, not an office campus

The primary `/room/[roomId]` runtime should look and behave like a modern
meeting product with a spatial 3D center.

The default view is one bright, minimal meeting room inspired by the reference
composition: a clean architectural room, central table, chairs, restrained
materials, generous negative space, and a single strong focal area.

Do not recreate the former ten mini offices, common area, wandering avatars,
free-roaming office navigation, or “desktop OS” window metaphor.

## 4.2 Two distinct navigation systems

The product has two UI layers with different responsibilities.

### A. Meeting toolbar — metadata and session controls

Persistent meeting-level controls belong in a compact toolbar/drawer system,
using the information hierarchy of Zoom or Google Meet without pretending the
app has video-call features it does not implement.

Examples:

- participants;
- my role / seat status;
- invitations / share room;
- organizer controls;
- agent/WebMCP connection guidance;
- activity/provenance;
- settings;
- leave / return home.

These are DOM controls. They are not 3D “rooms”.

Do **not** add fake microphone, camera, screen-share, or chat controls unless
those capabilities actually exist.

### B. Workspace dock — decision artifacts

A separate bar below the 3D stage navigates meeting content.

Canonical workspace targets:

```text
Room
Brief
Constraints
Proposals
Issues
Whiteboard
Vote
Decision
```

Some workspaces are phase-gated. The dock can disable, hide, or mark them as
upcoming when the room state does not allow meaningful interaction yet.

Each workspace has one dedicated 3D object/surface and one matching accessible
DOM surface.

## 4.3 Camera navigation

The room should never show every board and panel at once.

Selecting a workspace changes presentation state only:

```text
workspace selection
      -> camera target
      -> smooth move / slide
      -> active 3D board comes into focus
      -> matching DOM controls become active
```

Examples:

- `Room` -> central table overview;
- `Constraints` -> constraint board;
- `Proposals` -> proposal board / presentation screen;
- `Issues` -> evaluation/conflict board;
- `Whiteboard` -> notes board;
- `Vote` -> voting surface;
- `Decision` -> final review / decision artifact.

Inactive workspaces should be visually recessive or out of frame. Avoid a
single “dashboard wall” containing all information.

Camera state, active workspace, transition progress, drawers, and toolbar state
are presentation-only. They must never be written into canonical `RoomState`.

---

# 5. 3D semantic contract

3D is a visualization of semantic state, not the owner of it.

```ts
interface RoomVisualizationState {
  phase: RoomPhase;
  participants: VisualParticipant[];
  constraints: VisualConstraint[];
  proposals: VisualProposal[];
  conflicts: VisualConflict[];
  recentActivity: VisualActivity[];
  consensus: ConsensusState;
}
```

The exact presentation model may evolve, but this dependency direction must
remain:

```text
RoomState
  -> semantic DOM UI
  -> createRoomVisualizationState(RoomState)
      -> 3D scene
```

The 3D layer may:

- choose layouts and camera targets;
- animate scene transitions;
- render participant seat/name markers;
- render proposal, constraint, issue, voting, and approval state;
- emit presentation selection events.

The 3D layer may not:

- call Supabase or HTTP APIs;
- authorize actions;
- advance room phases;
- decide consensus;
- infer approval;
- create competing room DTOs.

---

# 6. 3D visual language and asset strategy

## Direction

Use a simple architectural product-render style rather than game-like low-poly
assets.

Desired qualities:

- bright neutral background;
- soft off-white / warm gray architecture;
- dark structural frames used sparingly;
- one restrained accent color for active state;
- clean furniture silhouettes;
- soft lighting;
- minimal visual noise;
- no decorative asset clutter.

## Asset policy

The previous committed low-poly office packs are deprecated and should be
removed.

Until custom assets are authored:

- use procedural R3F primitives as placeholders;
- do not spend time polishing temporary furniture;
- keep object interfaces semantic so Blender-authored assets can replace them
  without changing room state or domain code.

Later, Blender MCP should produce a small intentional asset set, for example:

```text
meeting-room-shell.glb
meeting-table.glb
meeting-chair.glb
board-brief.glb
board-constraints.glb
board-proposals.glb
board-issues.glb
board-whiteboard.glb
board-vote.glb
board-decision.glb
```

Do not reintroduce a generic office asset dump.

---

# 7. Participant representation

Participants are meeting attendees, not owners of separate mini offices.

In 3D, represent them with restrained seat-level cues such as:

- occupied chair / seat marker;
- role/name plate;
- subtle active-agent pulse;
- vote state;
- approval state.

The canonical participant list, role details, invitation state, readiness,
provenance, and organizer controls remain in the meeting toolbar/drawers.

This keeps the 3D room legible while preserving the human-authority story.

---

# 8. WebMCP tool model

WebMCP tools remain phase-scoped and participant-authorized.

Recommended tool groups:

## Input

- `get_meeting_context`
- `add_my_position`

## Proposals

- `list_positions`
- `submit_proposal`

## Deliberation

- `get_open_issues`
- `raise_objection`
- `propose_tradeoff`

## Voting

- `cast_my_vote`

## Approval

- `preview_final_decision`
- `approve_final_decision` — requests visible human confirmation; it does not
  silently record approval.

## Finalized

- `get_decision_record`

Tools invalid for the current phase should not be exposed.

---

# 9. Identity, authority, and approval invariants

Every browser session maps to at most one human participant in a room.

Never trust a participant ID supplied by an agent as authority.

```text
authenticated browser session
  -> participant membership
  -> authorized actor
```

A participant may mutate only actions allowed for their own identity.

Experts are a distinct advisory actor type and may never vote, approve, or
finalize.

Voting and final approval are separate concepts.

Final approval means:

> I reviewed this exact final decision and approve it for my participant
> identity.

Approval is bound to a stable decision hash. If the decision changes, previous
approvals become invalid.

---

# 10. Domain architecture

Manual UI, WebMCP, and expert services share the same domain operations.

```text
Manual UI ─────────┐
Browser WebMCP ────┼──> Domain operation -> authorization -> database
Expert service ────┘
```

Business logic must not live in React components, route handlers, WebMCP
adapters, 3D components, or expert prompts.

The domain layer owns:

- authorization;
- validation;
- room transitions;
- room versioning;
- idempotency;
- audit events;
- vote and approval invariants;
- finalization.

The current Supabase-backed backend, anonymous-auth seat claiming, invite
security, realtime invalidation, room versioning, and immutable decision record
remain the canonical implementation direction.

---

# 11. Async-first collaboration

The product is asynchronous by design with realtime updates when participants
are online together.

Browser agents do not directly network with one another.

```text
Participant A + browser agent
          -> WebMCP
          -> shared room state
          -> realtime invalidation / refetch
          -> Participant B
```

Multiple meetings remain isolated by room ID and database authorization.

---

# 12. Accessible DOM parity

The 3D stage is not the only way to understand or operate the room.

Every actionable workspace must have a keyboard-accessible DOM equivalent.

The DOM should not become a second dashboard that displays every artifact at
once. It should mirror the same active-workspace model:

- one active workspace panel;
- compact drawers for metadata;
- clear phase and action feedback;
- fallback text when WebGL is unavailable.

---

# 13. Demo requirements

`/room/demo` remains the fast judge route.

Solo judge mode contains:

- one real human participant controlled by the judge;
- two or three clearly labelled simulated participants;
- deterministic scripted reactions;
- genuine WebMCP use by the judge;
- seeded conflict and trade-off opportunities;
- a reset action.

Simulated participants must never be presented as real humans or independent
browser agents.

The demo should communicate, in roughly three minutes:

1. separate humans / identities;
2. browser-agent tool use;
3. constraints becoming visible;
4. proposal and conflict;
5. trade-off / revision;
6. participant-scoped voting;
7. exact human approval;
8. final auditable decision record.

---

# 14. Repository structure

Target presentation structure:

```text
src/
  components/
    meeting/
      meeting-shell.tsx
      meeting-toolbar.tsx
      workspace-dock.tsx
      workspace-panel.tsx
      drawers/

  visualization/
    room-view-model.ts
    room-visualization.tsx
    scene/
      meeting-scene.tsx
      camera-controller.tsx
      workspace-layout.ts
      procedural-placeholders.tsx
      workspaces/
        room-workspace.tsx
        brief-board.tsx
        constraint-board.tsx
        proposal-board.tsx
        issue-board.tsx
        whiteboard.tsx
        vote-board.tsx
        decision-board.tsx
```

The exact filenames may change, but the separation is intentional:

- meeting metadata controls are DOM UI;
- decision workspaces map to 3D surfaces;
- camera/navigation state is presentation-only;
- room state remains canonical and shared.

---

# 15. Deprecated implementation directions

Do not extend these patterns:

- 2D architectural floor-plan route;
- desktop OS windows floating over the scene;
- ten participant mini offices;
- shared common-area gameplay;
- wandering participants / office roaming;
- free-fly or god-view navigation as the primary interaction;
- generic low-poly office asset packs;
- displaying all decision panels at once.

Existing code that still implements these patterns should be treated as
migration code and deleted as the new meeting shell replaces it.

---

# 16. MVP scope

Must have:

1. runtime-created private rooms and secure invite claiming;
2. participant identity isolation;
3. realtime canonical room updates;
4. structured positions, constraints, proposals, objections, and trade-offs;
5. participant-scoped voting;
6. explicit hash-bound final approval;
7. audit/provenance visibility;
8. phase-scoped WebMCP tools;
9. one clean 3D meeting room;
10. workspace dock with camera transitions;
11. semantic DOM parity/fallback;
12. solo judge mode;
13. multi-browser Playwright coverage;
14. public deployment and under-three-minute demo.

Out of scope:

- direct agent-to-agent networking;
- voice/video calling;
- free-roaming avatars;
- physics;
- generic virtual-office simulation;
- full project-management features;
- large expert orchestration frameworks;
- arbitrary external integrations.

---

# 17. Definition of success

A judge should open one URL and quickly understand that this is a shared meeting
for one decision, not a complicated office simulator.

They should be able to:

1. identify their own participant identity;
2. see the current meeting phase;
3. use a browser agent through WebMCP;
4. watch structured room state change;
5. navigate between the central meeting view and one focused decision workspace
   at a time;
6. understand conflicts and trade-offs visually;
7. vote only for themselves;
8. review and explicitly approve the exact final plan;
9. inspect the final decision record and provenance.

The visual experience should reinforce one idea without clutter:

> **One shared room. Separate human authority. Focused decision workspaces.**
