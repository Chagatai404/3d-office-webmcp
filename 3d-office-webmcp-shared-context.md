# 3D Office WebMCP App — Shared Context & Implementation Plan

> **Hackathon:** OpenAI WebMCP Challenge  
> **Project:** 3D Office WebMCP App  
> **Purpose of this document:** Canonical shared context for product, engineering, WebMCP, 2D/3D UI, testing, and demo work.
>
> This document supersedes earlier brainstorming where it conflicts with the decisions below. It intentionally combines the simpler four-phase 3D Office WebMCP App experience with the stronger structured decision mechanics from the earlier Consensus Office concept.

---

# 1. Product Definition

## One-line pitch

**3D Office WebMCP App is a shared decision room where every participant brings their own browser agent. Agents turn individual constraints into structured positions, surface conflicts, negotiate trade-offs, and develop a candidate agreement, while every human retains their own vote and explicit final approval authority.**

## Core principle

> Agents can accelerate collective decisions, but they must not collapse separate people into one AI, erase disagreement, or acquire authority that belongs to humans.

3D Office WebMCP App is not a generic multi-agent chat room.

It is a **structured collective decision system** with:

- separate participant identities;
- participant-owned browser agents;
- structured positions and constraints;
- explicit proposals;
- objections and conflicts;
- trade-offs and revisions;
- participant-scoped voting;
- independent final human approval;
- optional advisory expert agents;
- visible activity and provenance;
- a final auditable decision record.

---

# 2. Primary Hackathon Scenario

The MVP will use one deterministic B2B scenario:

## Scenario

**A cross-functional startup team must decide whether and how to ship an onboarding feature update within two weeks.**

Participants:

- Product Manager
- Engineer
- Designer
- Marketing Lead

Optional expert agents:

- Security
- QA
- Legal / Compliance
- Finance

## Seeded concerns

### Product
- New users should reach first value faster.
- The proposed release should materially improve onboarding completion.

### Engineering
- Maximum implementation capacity is limited.
- No authentication rewrite can fit within the release window.
- The solution must avoid introducing fragile dependencies.

### Design
- The onboarding flow must meet accessibility requirements.
- The solution should preserve visual and interaction consistency.

### Marketing
- The campaign launch date cannot move.
- Final launch messaging and assets need a stable product surface before the campaign cutoff.

## Intentional conflict

The initial proposal should be attractive but flawed enough to create real negotiation.

Example:

> Rebuild onboarding as a custom multi-step flow with new event tracking and an expanded personalization layer before the scheduled campaign launch.

This should create meaningful conflicts around:

- engineering capacity;
- accessibility review;
- launch timing;
- analytics/privacy risk;
- QA scope.

The judge should be able to see the room move from conflict to negotiated agreement.

---

# 3. Product Experience

3D Office WebMCP App uses a simple four-phase user experience.

## Phase 1 — Setup

The organizer:

1. creates a meeting;
2. enters the decision title;
3. enters a short brief;
4. chooses or accepts the seeded participant roles;
5. optionally invites predefined expert agents;
6. shares the room link.

For the hackathon demo, a pre-seeded `/room/demo` route should exist so judges do not need to configure the room manually.

---

## Phase 2 — Input

Each human participant joins independently.

Each participant:

1. claims or receives one participant identity;
2. reads the decision brief;
3. adds their own constraints, requirements, preferences, or concerns;
4. can edit only their own participant-owned input before deliberation begins.

At this stage the product is intentionally simple.

The goal is to collect separate perspectives before agents begin negotiating.

---

## Phase 3 — Deliberation

The browser agents become active through WebMCP.

Agents can:

1. read the shared meeting context;
2. convert user input into structured positions;
3. inspect proposals and other participants' public positions;
4. submit proposals;
5. identify concrete conflicts;
6. raise objections tied to specific constraints;
7. offer trade-offs;
8. submit revised proposals;
9. inspect unresolved issues.

Optional expert agents may add advisory concerns and recommendations.

The UI can feel like a live agent meeting, but the underlying system is **structured state**, not a transcript.

---

## Phase 4 — Decision & Approval

Once the room reaches a viable candidate proposal:

1. participants vote;
2. the winning candidate becomes the proposed final decision;
3. the complete final plan is previewed;
4. every required human independently approves or rejects it;
5. the room finalizes only after all required approvals are recorded;
6. an immutable decision record is produced.

A vote is **not** final approval.

Approval is never inferred from:

- silence;
- a previous vote;
- an agent-generated message;
- participation in the discussion.

---

# 4. Async-First Collaboration Model

3D Office WebMCP App is **asynchronous by design with realtime presence and updates**.

This is a deliberate product and architecture decision.

A participant's browser agent does not need every other participant or agent to be online at the same time.

## Model

```text
Participant A + Browser Agent A
            |
          WebMCP
            |
            v
      Shared Room State
            |
       Realtime Update
            |
            v
Participant B + Browser Agent B
```

Participant B's agent can act later after reading the latest state.

If multiple sessions are online simultaneously, Supabase Realtime makes the experience feel live.

This gives us:

- reliable independent browser sessions;
- lower synchronization risk;
- natural recovery when a user disconnects;
- easier solo judge mode;
- compatibility with how browser agents actually invoke page tools.

We are **not** implementing direct agent-to-agent networking.

The application server coordinates the collaboration through shared state.

---

# 5. Canonical Domain Model

The application model is not a chat transcript.

The canonical room contains structured objects.

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
└── Audit Events
```

The UI may render these events conversationally, but conversational text is presentation only.

## Example

Instead of storing:

> "I disagree because this will take too long."

3D Office WebMCP App stores:

```text
Objection
- raisedBy: engineer
- proposalId: proposal_123
- constraintId: constraint_capacity
- severity: blocking
- reason: "Estimated scope exceeds available engineering capacity."
```

The UI can render that object as an agent message.

This distinction is critical to the product.

---

# 6. Room State Machine

The external UX has four phases, but internally the room uses a more explicit state machine.

```text
INPUT
  |
  v
PROPOSALS
  |
  v
DELIBERATION
  |
  v
VOTING
  |
  v
APPROVAL
  |
  v
FINALIZED
```

## Internal phases

### `input`

Allowed:

- read meeting context;
- add or edit participant-owned constraints and positions.

### `proposals`

Allowed:

- read positions;
- submit proposals;
- revise participant-owned proposals.

### `deliberation`

Allowed:

- read proposals;
- raise objections;
- inspect conflicts;
- propose trade-offs;
- submit revisions.

### `voting`

Allowed:

- inspect candidate proposals;
- vote;
- request revision.

### `approval`

Allowed:

- preview the final decision;
- independently approve or reject the exact final plan.

### `finalized`

Allowed:

- read the immutable decision record.

Mutating decision tools should be unregistered after finalization.

---

# 7. WebMCP Tool Set

The MVP should prioritize a small number of excellent tools over a large tool catalog.

The tools are dynamically registered according to the room phase.

## Input

### `get_meeting_context`

Read-only.

Returns:

- meeting title;
- brief;
- participant roles;
- current phase;
- success conditions;
- current participant identity;
- shared constraints and positions that are public.

### `add_my_position`

Participant-scoped write.

Adds structured input belonging to the active participant.

Inputs may include:

- summary;
- bullets;
- category;
- priority.

The participant identity is derived from the authenticated browser session, not supplied as trusted authority by the agent.

---

## Proposals

### `list_positions`

Read-only.

Returns structured public positions and constraints.

Participant-generated content should be treated as untrusted content.

### `submit_proposal`

Participant-scoped write.

Creates a concrete candidate solution.

Suggested fields:

- title;
- summary;
- rationale;
- expected outcomes;
- referenced constraints.

---

## Deliberation

### `raise_objection`

Participant-scoped write.

Raises a concrete concern against a proposal.

Suggested fields:

- proposal ID;
- related constraint ID;
- reason;
- severity: `blocking | warning`.

### `get_open_issues`

Read-only.

Returns:

- unresolved objections;
- associated proposal;
- associated constraint;
- severity;
- evidence or reasoning;
- latest related revision.

### `propose_tradeoff`

Participant-scoped write.

Proposes a specific change intended to resolve one or more open issues.

Suggested fields:

- conflict IDs;
- change description;
- expected effect;
- optional revised proposal fields.

---

## Voting

### `cast_my_vote`

Sensitive participant-scoped write.

Choices:

- `support`
- `oppose`
- `abstain`
- `request_changes`

The tool can only affect the active participant's vote.

Experts cannot vote.

A repeated vote update should be idempotent.

---

## Approval

### `preview_final_decision`

Read-only.

Returns the exact candidate final plan:

- final proposal;
- rationale;
- unresolved warnings;
- owners;
- deadlines;
- action items;
- dissent;
- required approvals.

The UI should visibly move into a final review state when this tool is used.

### `approve_final_decision`

Sensitive participant-scoped write.

This action approves the exact candidate decision only for the active human identity.

It must not approve on behalf of another participant.

The server should bind the approval to a stable representation or hash of the exact decision being approved.

If the decision changes, previous approvals are invalidated.

---

## Finalized

### `get_decision_record`

Read-only.

Returns the final immutable record:

- final decision;
- rationale;
- accepted trade-offs;
- unresolved non-blocking concerns;
- dissent;
- participant votes;
- independent approvals;
- owners and deadlines;
- provenance / audit metadata.

---

# 8. Dynamic Tool Availability

Tool registration should communicate the state machine.

## Example

```text
INPUT
────────────────────
get_meeting_context
add_my_position

PROPOSALS
────────────────────
get_meeting_context
list_positions
submit_proposal

DELIBERATION
────────────────────
get_meeting_context
list_positions
get_open_issues
raise_objection
propose_tradeoff

VOTING
────────────────────
get_meeting_context
get_open_issues
cast_my_vote

APPROVAL
────────────────────
preview_final_decision
approve_final_decision

FINALIZED
────────────────────
get_decision_record
```

The agent should not see tools that are invalid in the current phase.

This is a core WebMCP demonstration, not an optional implementation detail.

---

# 9. Human-Linked Agents vs Expert Agents

3D Office WebMCP App has two intentionally different actor types.

## A. Human-linked browser agents

Examples:

- Product Manager's ChatGPT/browser agent
- Engineer's ChatGPT/browser agent
- Designer's ChatGPT/browser agent
- Marketing Lead's ChatGPT/browser agent

These agents interact through WebMCP from the participant's own browser session.

Their authority is inherited from that participant's application identity.

They can never act for another participant.

---

## B. Advisory expert agents

Examples:

- Security Agent
- QA Agent
- Legal / Compliance Agent
- Finance Agent

These are optional server-side AI actors.

They are **not another user's browser agent**.

They do not call page WebMCP tools from the backend.

Instead, both WebMCP tools and expert agents call the same underlying domain operations.

```text
Browser Agent
    |
 WebMCP Adapter
    |
    v
Domain Operation
    ^
    |
Expert Agent Service
```

Example domain operation:

```text
createAdvisoryPosition(...)
```

or:

```text
raiseAdvisoryConcern(...)
```

---

# 10. Expert Authority Model

Experts advise.

They do not decide.

## Expert permissions

Experts may:

- read the current public decision context;
- add advisory positions;
- flag risks;
- raise non-human advisory concerns;
- recommend trade-offs;
- suggest revisions.

Experts may not:

- claim a human participant identity;
- vote;
- approve;
- finalize the decision;
- silently convert advice into a participant action.

Expert content should always be visibly labeled.

Examples:

```text
Security Agent · Advisory
QA Agent · Advisory
Finance Agent · Advisory
```

The final decision can explicitly state which expert concerns were:

- resolved;
- accepted as known risk;
- rejected with rationale.

---

# 11. Domain Layer Rule

Manual UI actions, WebMCP tools, and expert agents must use the same domain operations.

```text
Manual UI ────────┐
                  |
WebMCP Tool ──────┼──> Domain Operation ──> Authorization ──> Database
                  |
Expert Agent ─────┘
```

Business logic must not live inside:

- React components;
- WebMCP handlers;
- 3D components;
- expert-agent prompts.

The domain layer owns:

- authorization;
- validation;
- state transitions;
- room versioning;
- idempotency;
- audit event creation;
- decision invariants.

---

# 12. Suggested Domain Operations

```text
getMeetingContext()
addParticipantPosition()

submitProposal()
reviseProposal()

raiseObjection()
resolveObjection()
proposeTradeoff()

castVote()

previewFinalDecision()
approveFinalDecision()
finalizeDecision()

getDecisionRecord()
```

Expert-specific entry points may call shared lower-level operations:

```text
addExpertPosition()
raiseExpertConcern()
```

---

# 13. Data Model

Suggested MVP database entities:

## `rooms`

Important fields:

- `id`
- `title`
- `brief`
- `phase`
- `version`
- `active_proposal_id`
- `created_at`
- `finalized_at`
- `final_record`

## `participants`

- `id`
- `room_id`
- `user_id`
- `name`
- `role`
- `kind`
- `required_for_approval`
- `created_at`

`kind` may be:

- `human`
- `simulation`

Expert agents should preferably use a separate expert table or explicit actor type rather than pretending to be participants.

## `positions`

- `id`
- `room_id`
- `participant_id`
- `summary`
- `category`
- `priority`
- `created_at`

## `constraints`

- `id`
- `room_id`
- `participant_id`
- `category`
- `text`
- `priority`
- `created_at`

## `proposals`

- `id`
- `room_id`
- `participant_id`
- `title`
- `summary`
- `rationale`
- `parent_proposal_id`
- `status`
- `created_at`

## `conflicts`

- `id`
- `room_id`
- `proposal_id`
- `constraint_id`
- `raised_by_actor_type`
- `raised_by_actor_id`
- `severity`
- `reason`
- `status`
- `created_at`
- `resolved_at`

## `tradeoffs`

- `id`
- `room_id`
- `conflict_id`
- `created_by_actor_type`
- `created_by_actor_id`
- `description`
- `resulting_proposal_id`
- `created_at`

## `votes`

- `room_id`
- `proposal_id`
- `participant_id`
- `choice`
- `comment`
- `updated_at`

Unique key:

```text
(room_id, proposal_id, participant_id)
```

## `approvals`

- `room_id`
- `participant_id`
- `decision_hash`
- `approved_at`

Unique key:

```text
(room_id, participant_id)
```

## `audit_events`

- `id`
- `room_id`
- `actor_type`
- `actor_id`
- `origin`
- `action`
- `entity_type`
- `entity_id`
- `sanitized_input`
- `result`
- `previous_room_version`
- `resulting_room_version`
- `confirmation_required`
- `created_at`

---

# 14. Identity & Authorization

Every browser session belongs to exactly one human participant identity.

The server, not the WebMCP tool input, determines the acting participant.

## Rule

Never trust:

```text
participantId supplied by the agent
```

as authority.

Instead derive:

```text
authenticated user
    ->
participant membership
    ->
authorized actor
```

A participant may only mutate their own:

- input;
- positions;
- proposals where applicable;
- vote;
- approval.

The server must reject attempts to impersonate another participant.

---

# 15. Authentication Strategy

For the hackathon MVP, prefer low-friction authentication.

Recommended direction:

**Supabase anonymous authentication + participant seat claiming.**

Example:

```text
Browser session
    |
Supabase anonymous user
    |
Claim participant seat
    |
participant.user_id = auth.uid()
```

This gives real session isolation without:

- email verification;
- passwords;
- OAuth setup;
- judge credential friction.

The demo room should be resettable.

---

# 16. Room Versioning & Concurrency

Every room has a monotonically increasing `version`.

All mutations are validated against the state observed by the calling browser/domain operation.

If another mutation has already changed the room:

```json
{
  "ok": false,
  "error": {
    "code": "STALE_ROOM_STATE",
    "currentVersion": 14,
    "message": "The room changed before this action completed.",
    "recovery": "Review the latest room state and retry if the action is still appropriate."
  }
}
```

The WebMCP adapter may inject the currently observed version automatically.

The agent should not need to manually manage version numbers.

---

# 17. Standard Tool / Domain Result Shape

Use one structured result format wherever practical.

```ts
type ToolResult<T> =
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

Errors should tell an agent how to recover.

---

# 18. Human Confirmation

The approval architecture must not depend on one experimental browser-interaction API behaving perfectly.

The product must have its own visible confirmation flow.

## Required behavior

```text
approve_final_decision
        |
        v
Server checks exact decision
        |
        v
Human confirmation required
        |
        v
Visible approval UI
        |
        v
Human confirms exact plan
        |
        v
Approval recorded
```

If a stable WebMCP user-interaction API is available in the target judging environment, it may enhance this flow.

It must not be the only thing protecting approval.

---

# 19. Vote vs Approval

Voting and final approval are separate concepts.

## Vote

A participant may:

- support;
- oppose;
- abstain;
- request changes.

Voting selects or rejects a candidate proposal.

## Approval

Approval means:

> "I have reviewed this exact final decision and authorize my participant identity's approval."

If the final decision changes after approval:

- the decision hash changes;
- previous approvals are invalid;
- humans must approve the revised version again.

---

# 20. Audit Ledger

The activity ledger is a product feature.

Every important action should record:

- actor;
- whether actor was human-linked agent, expert, simulation, or manual UI;
- action;
- timestamp;
- affected entity;
- previous room version;
- resulting room version;
- sanitized input;
- result;
- whether human confirmation was required.

The ledger should make agent activity understandable without opening developer tools.

---

# 21. 2D Interface

The 2D interface is the semantic product surface.

It must work fully without 3D.

Suggested desktop layout:

```text
┌─────────────────────────────────────────────┐
│ Meeting Title / Current Phase / Room Status │
├─────────────────────┬───────────────────────┤
│                     │ Participants          │
│ Main Decision Area  │                       │
│                     ├───────────────────────┤
│                     │ Open Issues           │
├─────────────────────┴───────────────────────┤
│ Activity Ledger                             │
└─────────────────────────────────────────────┘
```

Main decision area changes by phase:

- input -> brief + constraints;
- proposals -> candidate proposals;
- deliberation -> proposal + conflicts + trade-offs;
- voting -> comparison + vote status;
- approval -> final preview;
- finalized -> decision record.

---

# 22. 3D Office Contract

The 3D office visualizes semantic state.

It does not own state.

It should consume a stable visualization model.

Example:

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

## Semantic mapping

### Participant desks

Show:

- identity;
- role;
- presence;
- current activity;
- vote state;
- approval state.

### Central table

Shows:

- active proposals;
- revisions;
- candidate final proposal.

### Constraint wall

Shows:

- participant requirements;
- important hard constraints.

### Conflict board

Shows:

- unresolved objections;
- conflict links between proposals and constraints.

### Activity trails

Show visible movement representing:

- tool calls;
- proposal creation;
- objection creation;
- trade-offs;
- votes;
- approvals.

### Finalization area

Shows:

- candidate final decision;
- missing approvals;
- completed approvals.

---

# 23. 3D Scope Rules

The 3D environment must remain deliberately small.

Use:

- React Three Fiber;
- Drei;
- low-poly assets;
- fixed or limited camera;
- lightweight animations;
- procedural primitives where convenient.

Avoid:

- physics;
- free walking;
- complex character controllers;
- full avatar animation systems;
- giant imported environments;
- expensive shadows;
- state logic embedded in 3D components.

The same information must remain available in normal DOM content.

---

# 24. Solo Judge Mode

The project must be impressive with one judge and one browser agent.

Solo judge mode should contain:

- one real participant controlled by the judge;
- two or three clearly labeled simulated participants;
- deterministic scripted simulation behavior;
- genuine WebMCP tool use for the judge;
- a seeded decision brief;
- seeded conflicts;
- a reset button.

Simulated participants must never be represented as real humans or autonomous browser agents.

Label clearly:

```text
Simulated Participant
```

The demo video should additionally show at least two real browser sessions sharing the same room.

---

# 25. Simulation Model

Simulations should be deterministic rather than dependent on external LLM behavior.

Example:

When the judge submits the seeded high-scope proposal:

- simulated Engineer raises capacity objection;
- simulated Designer raises accessibility objection.

After a valid trade-off:

- objections transition predictably;
- simulations cast predictable votes.

This keeps judging reliable.

---

# 26. Expert Agents Are Optional MVP+

Expert agents strengthen the concept but should not block the main path.

## MVP priority

First complete:

```text
Human participant
-> browser agent
-> WebMCP
-> shared state
-> conflict
-> trade-off
-> vote
-> final human approval
```

Only then add server-side expert agents.

Recommended first expert:

**Security Agent**

Why:

- clear advisory role;
- easy to distinguish from participant authority;
- useful privacy/security objections;
- aligns with the trust story.

Do not build six experts before one works well.

---

# 27. Private Local Constraints

Private local constraints are a stretch feature.

Possible future flow:

```text
save_private_constraint
evaluate_proposal_for_me
publish_constraint_summary
```

Private constraints would remain in browser-local storage until explicitly disclosed.

This is distinctive but not required for the core demo.

Do not implement until the full shared decision path is stable.

---

# 28. Recommended Stack

## Application

- Next.js App Router
- TypeScript

## Validation

- Zod

Share schemas between:

- WebMCP adapters;
- domain operations;
- route/server handlers;
- tests.

## Shared state

- Supabase Postgres

## Authentication

- Supabase Auth
- preferably anonymous auth for the demo

## Realtime

- Supabase Realtime

## 3D

- React Three Fiber
- Drei

## Testing

- Vitest
- Playwright

## Deployment

- Vercel or another already-familiar reliable platform

---

# 29. Suggested Repository Structure

```text
src/
  app/
    room/[roomId]/
      page.tsx
      room-client.tsx

    api/
      rooms/
      demo/

  domain/
    meetings/
      types.ts
      schemas.ts
      permissions.ts
      transitions.ts

      operations/
        add-position.ts
        submit-proposal.ts
        raise-objection.ts
        propose-tradeoff.ts
        cast-vote.ts
        preview-final-decision.ts
        approve-final-decision.ts
        finalize-decision.ts

  webmcp/
    register-tools.ts
    tool-definitions.ts
    tool-result.ts
    types.d.ts

  experts/
    expert-types.ts
    run-expert.ts
    security-expert.ts

  components/
    room/
      phase-header.tsx
      meeting-brief.tsx
      positions-panel.tsx
      proposal-panel.tsx
      conflict-board.tsx
      participant-panel.tsx
      vote-panel.tsx
      final-approval.tsx
      activity-ledger.tsx

  visualization/
    room-view-model.ts
    room-visualization.tsx

  lib/
    supabase/
      client.ts
      server.ts

supabase/
  migrations/
  seed.sql

tests/
  domain/
  playwright/
  webmcp-evals/
```

---

# 30. Agent Experience Requirements

Agents are first-class application users.

Each tool should have:

- one clear responsibility;
- concise naming;
- strict schemas;
- required fields;
- enum constraints;
- limited output size;
- structured errors;
- useful recovery instructions;
- server-side validation;
- visible UI effect.

Read-only tools should be marked as read-only where supported.

Participant-generated or external content should be treated as untrusted content where supported.

Tool descriptions must distinguish:

- proposal;
- objection;
- trade-off;
- vote;
- approval.

The agent should never have to infer those concepts from generic text.

---

# 31. Tests

## Domain tests

Test:

- valid input;
- invalid schema input;
- participant isolation;
- wrong-phase rejection;
- idempotent voting;
- stale-state rejection;
- decision-hash invalidation;
- all-approval finalization;
- expert no-vote rule;
- immutable finalized room.

## Realtime multi-browser test

Playwright journey:

1. Browser A joins as Engineer.
2. Browser B joins as Designer.
3. A adds a constraint.
4. B sees it.
5. A submits proposal.
6. B sees it.
7. B raises objection.
8. A sees it.
9. A proposes trade-off.
10. B sees revision.
11. Both vote independently.
12. Both preview final decision.
13. Both approve independently.
14. Both receive the same final decision record.

## WebMCP / agent evals

Create a small version-controlled set of prompts covering:

- correct tool selection;
- parameter extraction;
- tool ordering;
- refusal to impersonate another participant;
- recovery from stale room state;
- recognition of unresolved blocking objections;
- distinction between vote and approval;
- final record retrieval.

---

# 32. Canonical Demo Journey

The primary demo should be understandable in under three minutes.

## 0:00–0:20 — Problem

Explain:

- team decisions lose constraints;
- AI assistants normally represent one user;
- collective authority becomes unclear.

## 0:20–0:40 — Room

Show:

- Product;
- Engineering;
- Design;
- Marketing;
- each with their own participant identity / agent.

## 0:40–1:05 — Positions

Agents add structured constraints.

The room visibly updates.

## 1:05–1:30 — Proposal & Conflict

A proposal is submitted.

Engineering and accessibility objections appear.

Conflict visualization activates.

## 1:30–1:55 — Negotiation

An agent proposes a trade-off.

The proposal is revised.

Blocking conflicts are resolved.

## 1:55–2:15 — Expert Advice

If implemented, Security Agent adds one advisory concern.

Make clear:

> advisory, no vote.

## 2:15–2:35 — Voting

Humans' participant agents cast votes within their own authority.

Show that one identity cannot vote for another.

## 2:35–2:50 — Approval

Show complete final plan.

Humans independently approve.

Emphasize:

> vote is not approval.

## 2:50–3:00 — Record

Show:

- final decision;
- owners;
- deadlines;
- dissent;
- approvals;
- activity ledger.

End with:

> This app lets agents negotiate without collapsing the people they represent into one AI.

---

# 33. MVP Scope

## Must Have

1. Seeded decision room.
2. At least two real independent browser participant sessions.
3. Participant identity isolation.
4. Async-first shared state.
5. Realtime UI updates.
6. Explicit room state machine.
7. Structured positions.
8. Structured proposals.
9. Structured conflicts / objections.
10. Trade-offs / revisions.
11. Participant-scoped voting.
12. Separate final approval.
13. Audit ledger.
14. Six to ten reliable WebMCP tools across phases.
15. Dynamic tool registration.
16. Functional 2D interface.
17. One integrated 3D office.
18. Solo judge mode.
19. Playwright multi-browser path.
20. Agent/tool eval prompts.
21. Public deployment.
22. Public repository.
23. License.
24. README.
25. Under-three-minute demo video.

---

# 34. Stretch Scope

Only after the complete MVP path is stable:

- server-side expert agent;
- more expert personas;
- private local constraints;
- selective disclosure;
- undo/history;
- decision export;
- performance dashboard;
- richer 3D animations;
- additional decision templates.

---

# 35. Explicitly Out of Scope

Do not build:

- direct agent-to-agent networking;
- a generic multi-agent chat app;
- voice chat;
- free-roaming avatars;
- physics;
- CRDTs unless absolutely necessary;
- complex live presence infrastructure;
- travel search;
- purchasing / checkout;
- arbitrary external integrations;
- custom AI model hosting;
- large expert-agent orchestration frameworks;
- general-purpose project management.

---

# 36. Implementation Order

Build vertically.

Do not finish "backend", "frontend", and "3D" as independent projects.

## Milestone 1 — Shared Room Skeleton

Goal:

```text
/room/demo
```

works.

Deliver:

- Next.js project;
- Supabase project;
- schema/migrations;
- seed data;
- anonymous auth;
- participant seat claiming;
- room state loading.

## Milestone 2 — First Multi-Browser Vertical Slice

Two browsers can:

```text
Engineer joins
-> Designer joins
-> Engineer adds constraint
-> Designer sees it
-> Engineer submits proposal
-> Designer sees it
-> Designer raises conflict
-> Engineer sees it
-> ledger records all actions
```

This is the first critical architecture checkpoint.

## Milestone 3 — WebMCP Vertical Slice

Expose the same actions through WebMCP.

Verify:

- tool discovery;
- tool selection;
- visible UI effects;
- participant authorization;
- structured errors.

## Milestone 4 — Negotiation

Implement:

- open issues;
- objections;
- trade-offs;
- proposal revision.

## Milestone 5 — Voting & Approval

Implement:

- votes;
- vote status;
- final preview;
- decision hash;
- independent approvals;
- finalization.

## Milestone 6 — Solo Judge Mode

Implement:

- simulated participants;
- deterministic responses;
- reset flow.

## Milestone 7 — 3D Integration

Feed the real semantic room state into the visualization adapter.

Do not duplicate room state inside the 3D layer.

## Milestone 8 — Reliability

Complete:

- domain tests;
- Playwright;
- agent evals;
- error polish;
- deployment verification.

## Milestone 9 — Submission

Complete:

- README;
- architecture diagram;
- WebMCP explanation;
- screenshots;
- demo video;
- Devpost copy.

---

# 37. Workstream Split

With two primary builders:

## Builder A — Core / Integration

Own:

- domain model;
- Supabase;
- auth;
- room state machine;
- WebMCP;
- permissions;
- concurrency;
- tests;
- deployment;
- integration.

## Builder B — 3D / Experience

Own:

- visual direction;
- R3F environment;
- participant desks;
- proposal visualization;
- constraint wall;
- conflict board;
- activity trails;
- vote/approval visualization.

## Joint

Own:

- seeded scenario;
- UX decisions;
- 2D/3D integration;
- demo flow;
- README;
- Devpost submission;
- video.

One person must remain the integration owner so the domain state, WebMCP tools, 2D UI, and 3D scene do not become separate systems.

---

# 38. Product Positioning

Avoid:

> "A room where multiple people each have an AI agent."

That space already has adjacent projects.

Prefer:

> **A WebMCP-native collective decision room where each human retains an independent identity, agent, vote, veto/objection capability, and final approval authority.**

The core distinction is **collective authority**, not merely multiple agents.

Alternative concise pitch:

> **Agents negotiate. People decide.**

Longer positioning:

> Existing assistants optimize for one user's intent. 3D Office WebMCP App explores what happens when several humans, each with their own browser agent, must reach one shared decision without giving up individual authority, disagreement, or consent.

---

# 39. Technical Claims We Should Make Carefully

We can say:

- each participant's browser agent calls WebMCP tools in that participant's browser context;
- shared server state mediates the collaboration;
- tool availability changes with room phase;
- server authorization enforces participant boundaries;
- expert agents are advisory server-side actors;
- final approval is independently recorded per human.

Do not say:

- WebMCP itself provides agent-to-agent messaging;
- expert backend agents are browser WebMCP clients;
- every agent is directly connected to every other agent;
- the system proves globally unique functionality;
- simulated participants are real agents;
- a browser-agent confirmation API is the only safety boundary.

---

# 40. Definition of Success

The hackathon version succeeds when a judge can:

1. open one URL;
2. understand the problem within roughly twenty seconds;
3. participate as one human identity;
4. ask their browser agent to interact with the room;
5. watch WebMCP tool calls visibly change shared state;
6. encounter a meaningful objection;
7. help negotiate a trade-off;
8. vote only for their own identity;
9. review the exact final plan;
10. independently approve it;
11. inspect the final decision record;
12. understand which actions came from humans, browser agents, simulations, and advisory experts.

The final experience should communicate one idea unmistakably:

> **The agent-native web can support collective decisions without taking collective authority away from the humans who must live with those decisions.**
