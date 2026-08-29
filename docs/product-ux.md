# Product UX Contract — Meeting Room Overhaul

This document translates the current design direction into implementation rules.
It is intentionally narrower than the product/architecture context.

## Design objective

Make `/room/[roomId]` feel immediately understandable: the user is in one
meeting room discussing one decision.

The reference direction is a clean architectural product render with a large
uncluttered 3D stage. Information appears only when the user asks for it.

## Screen anatomy

```text
┌──────────────────────────────────────────────────────────────┐
│ room title / phase                              utility menu │
│                                                              │
│                    3D MEETING STAGE                          │
│         camera focuses one workspace at a time              │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│ Room  Brief  Constraints  Proposals  Issues  Notes  Vote... │  workspace dock
├──────────────────────────────────────────────────────────────┤
│ Participants · Role · Invite · Activity · Settings · Leave  │  meeting toolbar
└──────────────────────────────────────────────────────────────┘
```

The two bottom rows may be combined visually if the hierarchy remains clear:
meeting metadata and decision-workspace navigation are separate concepts.

## Meeting toolbar

Use compact buttons that open small drawers/sheets. Keep the stage visible.

Recommended controls:

- Participants
- My role
- Invite / Share
- Activity
- Agent / WebMCP status and guidance
- Organizer controls when authorized
- Settings
- Leave

Do not put constraints, proposals, issues, votes, or the final decision in this
toolbar. Those are meeting workspaces.

## Workspace dock

Recommended canonical IDs:

```ts
type MeetingWorkspace =
  | "room"
  | "brief"
  | "constraints"
  | "proposals"
  | "issues"
  | "whiteboard"
  | "vote"
  | "decision";
```

The dock should explain availability with simple state rather than clutter:
active, available, attention-needed, completed, or unavailable.

Examples:

- Issues can show a small count badge when objections are open.
- Vote stays unavailable until voting is valid.
- Decision becomes the focal destination during approval/finalized phases.

## Camera behavior

Users do not manually fly around the office.

Each workspace owns a stable camera pose. Clicking the dock or the matching 3D
surface initiates an eased camera transition.

```text
current pose -> transition -> target pose -> settle
```

Requirements:

- transitions should be short and spatially understandable;
- no abrupt teleport unless reduced-motion is enabled;
- input should be disabled or safely retargetable during a transition;
- camera movement is never saved to `RoomState`;
- keyboard navigation uses the same workspace actions as pointer navigation;
- `prefers-reduced-motion` switches to near-instant or minimal movement.

## Workspace objects

Each decision concept gets one dedicated 3D object or architectural surface.
Do not spread one concept over several panels.

### Room

Central table and participant seats. Shows the active proposal / overall meeting
state at a glance.

### Brief

A presentation display or wall panel containing the decision title, brief, and
success criteria.

### Constraints

A planning board with participant constraints grouped clearly. Blocking or
critical constraints receive restrained emphasis.

### Proposals

A presentation board/tablet for the active candidate and revision lineage.
Avoid showing every historical proposal equally.

### Issues

An evaluation board linking unresolved objections to the active proposal and
related constraints.

### Whiteboard

Shared meeting notes and concise working annotations. This is not the audit
ledger and not canonical decision authority.

### Vote

A focused voting surface showing each participant's own action and aggregate
status without implying final approval.

### Decision

The exact final plan, approval requirements, completed approvals, dissent, and
final record. This is the most deliberate / high-attention workspace.

## DOM behavior

The active workspace must have an accessible DOM surface that contains the
actual controls and readable text.

A good pattern is:

```text
3D board = orientation + state visualization
DOM workspace panel = readable detail + forms/actions
```

The DOM panel should be compact and context-sensitive. Do not return to a giant
all-in-one dashboard.

## Visual system

Use the reference image as mood, not as a literal copy.

- warm off-white page background;
- light architectural shell;
- dark slim frame lines;
- neutral furniture;
- one vivid accent for active/connected/attention state;
- large rounded outer surfaces in DOM UI;
- generous whitespace;
- minimal text on the 3D scene itself;
- soft shadows only when performance allows.

Avoid:

- game-like low-poly styling;
- neon sci-fi UI;
- dozens of colored semantic chips;
- small unreadable 3D text;
- permanent sidebars occupying large screen area;
- overlapping modal windows.

## Participant representation

Participant identity is important, but it should not dominate the scene.
Use seats/nameplates/markers around the table. Details live in the Participants
drawer.

WebMCP activity may cause a brief pulse or halo at the participant seat and in
the activity drawer. Do not make avatars wander through the room.

## Temporary asset strategy

Before Blender MCP assets exist, use procedural primitives only. Keep each
placeholder behind a semantic component boundary so it can later be replaced
with a `.glb` without changing scene or room-state contracts.

No generic office asset packs should be committed.

## Acceptance test for the overhaul

A first-time judge should be able to answer these questions without opening a
help screen:

1. What decision is this meeting about?
2. What phase are we in?
3. Who am I in this meeting?
4. Where do I see participants/settings/invite information?
5. Where do I see constraints/proposals/issues/notes/voting/final decision?
6. Why did the camera move when I selected a workspace?
7. Which things are human authority versus agent activity?

If the answer requires scanning several windows or simultaneous panels, the UX
is too dense.
