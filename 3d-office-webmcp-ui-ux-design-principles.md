# 3D Office WebMCP App — UI/UX Design Principles

## Product Design North Star

The product should feel like a **calm, premium meeting environment that happens to be agent-native**, not like a dashboard, game, or AI control panel.

The core product idea is:

> **Agents negotiate. People decide.**

Multiple people participate in one decision while retaining separate identity and authority. The 3D environment exists to make the shared semantic state understandable rather than becoming the application state itself.

---

# 1. Core Design Principles

| Principle | What it means for our app | Concrete rule |
|---|---|---|
| **1. The room is the hero** | The 3D meeting environment should dominate the screen. | Do not surround it with permanent sidebars, cards, logs, participant lists, and stats. |
| **2. One cognitive context at a time** | Users should never need to parse constraints, proposals, conflicts, votes, and notes simultaneously. | Show the meeting room or one focused workspace at a time. |
| **3. Spatial navigation = information architecture** | Physical places in the room should correspond to concepts. | Constraints live at the constraint board, proposals at the proposal board, notes at the whiteboard, decisions at the decision board. |
| **4. Camera movement communicates context change** | Navigation should feel like turning attention toward something in a real meeting. | Selecting `Proposals` smoothly moves the camera to the proposal surface instead of opening another dashboard panel. |
| **5. Metadata stays out of the world** | Participants, roles, settings, invites, and technical status are utilities, not meeting content. | Put them in a Zoom/Meet-style toolbar and drawers. |
| **6. Progressive disclosure over information density** | Show information when it becomes relevant. | A board can show a headline first; selecting an item reveals rationale, comments, or history. |
| **7. 3D must carry meaning** | Animation and objects should correspond to real state changes. | An objection appears on the issue board; approval changes the participant indicator; a revision replaces or moves beside its parent proposal. |
| **8. Motion explains, never entertains** | Camera and object motion should orient users rather than show off the 3D engine. | Short, predictable transitions; no unnecessary orbiting, floating UI, bouncing cards, or game-like movement. |
| **9. Human authority must be visually unmistakable** | AI participation must never blur who owns a vote or approval. | Clearly distinguish human, browser agent, simulation, and advisory expert actions. Vote and final approval must look like different actions. |
| **10. DOM for interaction, 3D for spatial understanding** | Important text and controls should remain normal HTML wherever practical. | Put dynamic proposal text, forms, and confirmation controls in accessible DOM overlays or surfaces; do not bake them into Blender textures. |
| **11. Calm hierarchy beats visual richness** | The experience should feel restrained and premium. | Neutral architecture, limited accent colors, generous whitespace, large typography, and very few simultaneously highlighted elements. |
| **12. Performance is part of UX** | A beautiful room that stutters immediately feels cheap. | Fixed/controlled camera, streamed assets, limited draw calls, restrained shadows, and instant UI feedback. |
| **13. Preserve orientation** | Users should always know where they are in the decision. | Keep the current phase, active workspace, and way back to the central room persistent. |
| **14. Every important state needs a non-color cue** | Accessibility cannot depend on red/green alone. | Use label + icon + shape/status treatment for blocking, warning, approved, pending, etc. |
| **15. The product should explain itself visually** | A judge should understand the workflow without a tutorial. | The room should visibly move from discussion → issue → revision → vote → approval → finalized state. |

---

# 2. Screen Hierarchy

The UI should have only **three major layers**.

## Layer 1 — Persistent Meeting Chrome

This is minimal and always available.

Suggested content:

- meeting name;
- current phase;
- room status;
- participant controls;
- People;
- Invite;
- Activity;
- WebMCP / agent status;
- Settings;
- Leave.

This layer should behave like existing meeting applications such as Zoom or Google Meet.

## Layer 2 — The 3D Room

The 3D environment should occupy almost the entire screen.

When nothing is selected, users see the central meeting room composition.

The visual direction should feel:

- architectural;
- spacious;
- premium;
- mostly static;
- carefully composed;
- restrained rather than game-like.

The room should visually serve as the product's home state.

## Layer 3 — Decision Workspace Dock

A second thin navigation bar should contain only the content that belongs to the meeting itself.

Suggested workspaces:

```text
Brief · Constraints · Proposals · Issues · Whiteboard · Vote · Decision
```

Selecting one should **not** open another permanent dashboard panel.

Instead:

```text
User selects workspace
        ↓
Camera moves through room
        ↓
Relevant 3D workspace becomes the focus
        ↓
Only that workspace is visually dominant
```

Example screen structure:

```text
┌──────────────────────────────────────────────┐
│ Meeting title                     Phase      │
│                                              │
│                                              │
│               3D ENVIRONMENT                 │
│                                              │
│                                              │
│                                              │
│ Brief  Constraints  Proposals  Issues ...    │
│──────────────────────────────────────────────│
│ People   Activity   Agent   Settings   Leave │
└──────────────────────────────────────────────┘
```

---

# 3. Central Meeting Room as the Home State

The central meeting table should function as the spatial home screen.

Conceptually:

```text
              Constraints
                  ↑
                  │
Whiteboard ← MEETING ROOM → Proposals
                  │
                  ↓
                Issues

         Vote / Decision farther ahead
```

This does not need to be the exact physical floor plan.

The important principle is that users build **spatial memory**.

After using the app once, they should think:

> “The proposal board is over there.”

rather than:

> “Which tab had proposals again?”

This is one of the clearest UX advantages that 3D can provide over a normal SaaS dashboard.

---

# 4. Camera Design Rules

Users should **not** receive unrestricted FPS-style navigation.

The app should use a small set of named camera states.

Suggested states:

```text
room
brief
constraints
proposals
issues
whiteboard
vote
decision
```

Navigation becomes semantic:

```ts
navigateTo("proposals")
```

rather than relying on arbitrary coordinates.

## Camera transition guidelines

Recommended behavior:

- transition duration around 600–1000 ms;
- restrained easing;
- preserve enough of the room during movement to maintain spatial orientation;
- never spin dramatically;
- never move through geometry;
- avoid free orbit unless required;
- use fixed or limited angles;
- support reduced-motion mode.

Reduced-motion mode can:

- cut directly between views;
- use a fast crossfade;
- shorten motion significantly.

Motion should always explain a change in context.

---

# 5. Physical Workspace Design

The workspaces should feel like **physical products inside an architectural environment**, not browser cards pasted into 3D.

A proposal workspace might contain:

```text
black architectural frame
glass or acrylic surface
integrated display
small physical title marker

        ↓

dynamic meeting UI
```

Blender should produce:

- frame;
- screen body;
- stand;
- glass;
- lighting details;
- physical materials.

React should produce:

- proposal title;
- rationale;
- objections;
- votes;
- participant-generated content;
- actions and confirmations.

This keeps the environment reusable across unlimited meetings.

---

# 6. Workspace Identity

Each meeting concept should have its own spatial and visual identity.

## Brief

Purpose:

- orient users;
- show the current decision question;
- summarize goals and success criteria.

Possible physical language:

- presentation display;
- briefing wall;
- minimal agenda board.

## Constraints

Purpose:

- show participant requirements;
- make hard limits visible.

Possible physical language:

- structured pinned cards;
- layered requirements wall;
- categorized constraint surface.

## Proposals

Purpose:

- show candidate plans and revisions.

Possible physical language:

- presentation board;
- proposal panels;
- central comparison surface.

## Issues

Purpose:

- make unresolved objections and conflicts obvious.

Possible physical language:

- review/evaluation board;
- issue markers;
- visible blocking vs warning states.

## Whiteboard

Purpose:

- shared notes;
- brainstorming;
- trade-off sketches;
- temporary discussion artifacts.

Possible physical language:

- large writable wall;
- sticky-note composition;
- annotation surface.

## Vote

Purpose:

- compare viable candidates;
- record participant-scoped votes.

Possible physical language:

- voting console;
- decision table;
- dedicated ballot surface.

Voting should feel collaborative and relatively lightweight.

## Decision

Purpose:

- show the exact final candidate;
- show owners, deadlines, remaining warnings, and approval state;
- support deliberate human confirmation.

Possible physical language:

- formal final review surface;
- presentation pedestal;
- framed decision artifact.

Final approval should feel significantly more deliberate than voting.

---

# 7. Meeting State vs Meeting Controls

This distinction should be treated as a hard UX rule.

## Meeting Controls

These are meta-level utilities:

- Participants;
- Roles;
- Invites;
- Presence;
- Activity history;
- Agent connection;
- WebMCP status;
- Organizer controls;
- Settings;
- Leave.

These belong in:

- the bottom toolbar;
- small temporary drawers;
- contextual menus.

They do **not** belong permanently inside the 3D room.

## Meeting Content

These are part of the actual decision:

- Brief;
- Constraints;
- Proposals;
- Issues;
- Trade-offs;
- Notes;
- Voting;
- Final decision.

These belong in spatial 3D workspaces.

Never mix the two categories.

---

# 8. Progressive Disclosure

The interface should avoid showing complete data sets by default.

Use three information levels.

## Level 1 — Ambient Summary

Visible in the room.

Examples:

```text
3 open issues
2 proposals
4/4 positions submitted
Voting ready
```

## Level 2 — Workspace Summary

Visible after navigating to a workspace.

Example:

```text
Proposal A
Ship a reduced onboarding redesign

2 objections
3 supporters
1 revision
```

## Level 3 — Detail

Visible only after the user selects an item.

Could include:

- full rationale;
- linked constraints;
- audit provenance;
- complete comments;
- timestamps;
- revision history;
- detailed actions.

The user should not need to process Level 3 information to understand the room.

---

# 9. Visual Language

The overall visual system should be restrained.

Recommended base palette:

```text
warm off-white
soft gray
charcoal / black frames
natural wood
muted fabric
subtle greenery
```

Use one strong product accent.

For example, a vivid lime/acid accent could represent:

- selected;
- active;
- ready;
- connected;
- successful.

Semantic colors should be used sparingly for:

- blocking;
- warning;
- approved;
- pending;
- rejected.

Avoid turning every participant, object, and state into a different color category.

---

# 10. Typography

Typography should carry much of the visual hierarchy.

Recommended pairing:

```text
Editorial / display typeface
→ meeting title
→ workspace titles
→ final decision
→ major state transitions

Neutral grotesk / sans-serif
→ controls
→ participant information
→ proposal text
→ metadata
→ forms
```

Use:

- large headings;
- short labels;
- restrained body copy;
- strong spacing;
- clear hierarchy.

Avoid filling the room with long paragraphs.

A physical board should show the important 2–4 facts first.

Details should be revealed on demand.

---

# 11. Agent Activity

Agent activity must be observable without becoming visual noise.

## Ambient State

Examples:

```text
Agent working…
Reviewing proposal…
Checking constraints…
```

Represent this using subtle:

- pulses;
- participant indicators;
- workspace highlights;
- small transient labels.

## Important Agent Event

A significant action can briefly surface:

```text
Engineer agent raised an objection
```

or:

```text
Designer agent proposed a revision
```

These notifications should disappear automatically.

The full provenance history should live behind **Activity** in the meeting controls.

Avoid an always-open activity feed.

---

# 12. Human Authority

The system must visually distinguish:

- Human;
- Human-linked browser agent;
- Simulated participant;
- Advisory expert.

A user should always understand:

- who owns an action;
- who generated it;
- whether it is advisory;
- whether it has decision authority.

Never make an expert recommendation look like a participant vote.

Never make a browser agent's action look like another participant's action.

---

# 13. Voting vs Final Approval

Voting and final approval are separate product concepts and must look different.

## Voting

Voting means:

> “This is my position on this candidate.”

Possible states:

- support;
- oppose;
- abstain;
- request changes.

Voting can feel quick and collaborative.

## Final Approval

Approval means:

> “I reviewed this exact final decision and authorize my participant identity's approval.”

Final approval should move the user into a dedicated review state:

```text
camera → final decision workspace

exact final plan
owners
deadlines
remaining warnings
participant approval status

[ Review and approve ]
```

Approval should require explicit human confirmation.

It should feel closer to signing a final artifact than clicking a reaction.

---

# 14. DOM vs 3D Responsibility

Use **3D for spatial understanding**.

Use **DOM for interaction and information**.

## 3D should own

- architecture;
- furniture;
- workspace positions;
- physical frames;
- lighting;
- spatial composition;
- camera orientation;
- semantic motion.

## DOM should own

- dynamic text;
- forms;
- proposal data;
- buttons;
- participant-generated content;
- confirmation dialogs;
- accessible interactions;
- detailed information.

Do not bake dynamic meeting information into Blender textures.

---

# 15. Accessibility

Accessibility is part of the core interaction model.

Rules:

- do not rely only on color;
- provide text labels for semantic states;
- provide reduced-motion support;
- ensure keyboard navigation;
- maintain a DOM representation of important information;
- maintain readable contrast;
- ensure important controls have clear focus states;
- keep text selectable where practical;
- avoid tiny text embedded inside the 3D canvas.

Possible status representation:

```text
● Blocking
△ Warning
✓ Approved
○ Pending
```

The icon and text should carry meaning even without color.

---

# 16. Performance Is UX

A polished room that drops frames feels lower quality than a simpler room running perfectly.

Prefer:

- controlled camera;
- streamed assets;
- object instancing;
- limited real-time lights;
- restrained shadows;
- compressed textures;
- limited draw calls;
- lightweight animations;
- lazy-loaded secondary workspaces.

UI interactions should respond immediately even when 3D assets are still transitioning.

Performance should not be treated as a post-processing task.

---

# 17. Animation Principles

Animation should communicate:

- change of attention;
- creation;
- revision;
- conflict;
- resolution;
- voting;
- approval;
- finalization.

Avoid animation that exists only for spectacle.

Good examples:

```text
Proposal created
→ proposal panel softly enters its workspace

Blocking objection created
→ issue marker appears

Trade-off accepted
→ conflict indicator resolves

Vote recorded
→ participant vote state updates

Decision finalized
→ room enters a calm completed state
```

Bad examples:

- constantly floating panels;
- exaggerated bouncing;
- arbitrary particle systems;
- characters moving without semantic meaning;
- dramatic camera spins;
- game-like reward effects.

---

# 18. Orientation

Users should always know:

1. what meeting they are in;
2. what phase the meeting is in;
3. which workspace they are viewing;
4. what happened most recently;
5. how to return to the central room.

This can be achieved using a small persistent indicator such as:

```text
Launch Decision
Deliberation · Proposals
```

and a clearly available:

```text
Back to room
```

interaction.

---

# 19. Design Tests

Use these questions during every UI review.

## Spatial Product Test

> If we removed all the text, would this still look like a sophisticated meeting product rather than an indie 3D game?

If no, simplify the 3D language.

## Semantic UX Test

> If we removed the 3D assets, would the interaction model and decision state still be understandable?

If no, too much product meaning has been hidden inside the 3D environment.

## Information Density Test

> Is the user being asked to understand more than one major decision concept at once?

If yes, use progressive disclosure or move information into another workspace.

## Motion Test

> Does this animation explain something that just changed?

If no, remove it.

## Authority Test

> Can the user immediately tell who performed this action and who has authority over it?

If no, redesign the state representation.

## Meeting Test

> Does this feel like something people would actually use during a meeting?

If no, remove game-like or dashboard-like conventions.

---

# 20. Anti-Patterns

Avoid:

- permanent participant sidebars;
- permanent activity feeds;
- multiple decision panels visible simultaneously;
- giant card grids;
- analytics-dashboard layouts;
- free-roaming avatars;
- FPS navigation;
- decorative agent trails everywhere;
- floating glassmorphism UI everywhere;
- excessive status colors;
- tiny labels attached to every object;
- UI controls baked into 3D meshes;
- long copy rendered directly in WebGL;
- arbitrary motion;
- game HUD conventions;
- chat transcript as the primary interface;
- using 3D when a normal control would be clearer.

---

# 21. UX Architecture Summary

The product should follow this mental model:

```text
                    ┌─────────────────────────┐
                    │     MEETING CHROME      │
                    │ people / agent / setup  │
                    └────────────┬────────────┘
                                 │
                                 ↓
                    ┌─────────────────────────┐
                    │                         │
                    │     CENTRAL 3D ROOM     │
                    │                         │
                    │   shared spatial home   │
                    │                         │
                    └────────────┬────────────┘
                                 │
                 Decision Workspace Navigation
                                 │
           ┌──────────┬──────────┼───────────┐
           ↓          ↓          ↓           ↓
      Constraints  Proposals   Issues    Whiteboard
                                 │
                                 ↓
                              Voting
                                 │
                                 ↓
                         Final Decision
```

The central rule is:

> **Do not build a 3D dashboard. Build a spatial meeting product.**

3D should make the decision process easier to understand, easier to remember, and easier to follow.

Everything else should remain quiet.
