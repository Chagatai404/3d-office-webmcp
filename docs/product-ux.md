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
success criteria. The board draws the title and brief text itself, wrapped and
clamped to the panel and sized to stay legible at the Brief camera pose.

### Constraints

A planning board with participant constraints grouped clearly, each card
carrying its category and constraint text (the same wording as the panel).
High-priority constraints receive restrained emphasis; the overflow past what
fits rolls into a "+N more" card.

### Proposals

A presentation board/tablet for the candidate plans, each card showing the
proposal title. The active candidate is the only one that takes the accent
tone, and only while Proposals is the board in focus; superseded proposals are
muted.

### Issues

An evaluation board with one card per unresolved objection, showing the
objection text. Blocking objections take the attention tone; the rest are
muted.

Concise real text on these four boards is intentional: it is an echo of the
matching workspace panel, which stays the accessible source of truth (the
canvas is `aria-hidden`). Text is sized for each board's own camera pose, never
crammed — long values wrap, clamp, and overflow into a "+N more" card.

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

The DOM panel should be context-sensitive. Do not return to a giant
all-in-one dashboard.

### Where the panel opens

One workspace panel at a time, as a wide card centred over the stage — not a
rail down one edge. A brief, a constraints board and a proposal form all need
more width than an edge rail can give them, and a rail crowds the stage it is
supposed to be explaining.

```text
┌────────────────────────────────────────────┐
│ room title / phase             utilities   │
│      ┌──────────────────────────────┐      │
│  3D  │  the open workspace      [×] │  3D  │
│      │  readable detail + actions   │      │
│      └──────────────────────────────┘      │
│ Room  Brief  Constraints  Proposals  …     │  workspace dock
│ Participants · Role · Activity · Leave     │  meeting toolbar
└────────────────────────────────────────────┘
```

Requirements:

- the toolbar above and the dock below are never covered, so the way out is
  always one press away and the viewer can always see where they are;
- a soft scrim sits between the card and the stage: the room stays visible
  behind it rather than being replaced by a page;
- dismissal is available three ways — Escape, the close button, the scrim;
- Room clears the panel rather than opening one: it is the home state;
- a drawer and a workspace panel never share the screen; opening either puts
  the other away.

### Opening at one item

A board is made of written things, and pressing one of them opens that one
thing, not just the wall it is written on:

```text
press the constraints board  -> Constraints opens
press one constraint on it   -> Constraints opens, marked at that constraint
press its "+N more" card      -> Constraints opens, nothing singled out
```

The card grid is laid out once and shared, so a card's pressable area is the
card. Where a panel does not render the pressed item, the workspace simply
opens unmarked — never a broken or empty state. The dock carries the same
routes for the keyboard, so the canvas stays an alternative and never the only
way in.

## Visual system

Use the reference image as mood, not as a literal copy.

- warm off-white page background;
- light architectural shell;
- dark slim frame lines;
- neutral furniture;
- one vivid accent for active/connected/attention state;
- large rounded outer surfaces in DOM UI;
- generous whitespace;
- text on the 3D scene stays concise — board cards echo the panel in a few
  words, wrapped and clamped, and sized for that board's camera pose; the DOM
  panel is still where full detail and controls live;
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
