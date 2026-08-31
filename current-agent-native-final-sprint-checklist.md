# Current Agent-Native Final Sprint Checklist

> **Execution source of truth for the remaining hackathon work**
>
> This checklist is intentionally based on the current `main` branch and the live two-agent test feedback.
>
> **Do not delete or replace the earlier repository checklist.** Keep updating the earlier checklist/status documents after each merged slice for historical/completeness tracking, but **use this file for day-to-day execution order, ownership, and merge decisions.**

---

## 0. Operating Rules

### Current base

Both developers branch from the latest `origin/main`.

```bash
git switch main
git pull origin main
git status
git rev-parse HEAD
```

Record the shared base SHA here before starting:

- [ ] `BASE_SHA = ______________________________`

At the time this plan was created, `main` already contained:

- Slice 1 reliability/access-loss cleanup.
- Production-safe `supabase/production-demo-bootstrap.sql`.
- Current room authority / alignment / Security Expert / WebMCP infrastructure.

Do **not** reimplement those pieces.

### Branches

Developer A — protocol/backend:

```bash
git switch main
git pull origin main
git switch -c feature/agent-protocol-core
```

Developer B — UX/3D:

```bash
git switch main
git pull origin main
git switch -c feature/agent-first-ux
```

- [ ] Developer A branch created from the recorded `BASE_SHA`.
- [ ] Developer B branch created from the same `BASE_SHA`.
- [ ] Neither feature branch is created from the other feature branch.

---

# 1. Non-Negotiable Ownership Boundaries

These boundaries exist to keep the branches mergeable.

## Developer A — `feature/agent-protocol-core`

Developer A owns protocol, authority, canonical state, backend, WebMCP, deployment/backend integration, and report generation.

### A-exclusive paths

Developer B must not modify these while parallel work is active:

```text
src/contracts/**
src/domain/**
src/webmcp/**
src/clients/**
src/lib/supabase/**
src/app/api/**
supabase/**
src/components/room/room-provider.tsx
tests/contracts/**
tests/domain/**
tests/webmcp/**
tests/room-client/**
package.json
package-lock.json
```

Developer A is the **only** developer who changes:

```text
src/contracts/room.ts
```

No duplicate shared DTOs may be created in UI code.

## Developer B — `feature/agent-first-ux`

Developer B owns the visible meeting experience, layout, drawers, 3D projection, manual interaction simplification, and presentation of canonical room state.

### B-exclusive paths

Developer A should avoid these unless an integration bug absolutely requires a coordinated change:

```text
src/components/shell/**
src/visualization/**
UI-only meeting workspace components
UI-only participant/drawer components
global/component styling
UI animation / camera behavior
UI-specific component tests
```

Developer B may modify non-API room pages/components when needed for presentation, but must not introduce new backend/domain types there.

## Shared-file rule

- [ ] If a file is not clearly owned above, the first developer who needs it announces/records ownership before editing it.
- [ ] Do not both edit the same shared file in parallel.
- [ ] `package.json` and the lock file stay Developer A-owned because PDF generation may require a dependency.
- [ ] `room-provider.tsx` stays Developer A-owned because new RoomClient actions/tool state may flow through it.
- [ ] Developer B consumes canonical state and actions; Developer B does not invent temporary backend types.

## Checklist/documentation rule

To avoid documentation merge conflicts:

- [ ] Do **not** have both branches edit this checklist concurrently.
- [ ] Do **not** have both branches edit the earlier master checklist concurrently.
- [ ] Keep branch-local notes while implementing.
- [ ] After a feature branch is merged to `main`, one designated integrator updates:
  - this checklist;
  - the earlier repository checklist;
  - `docs/status.md` or equivalent status documentation.

Designated checklist/status integrator:

- [ ] `Integrator = ______________________________`

---

# 2. Product Rules We Are Implementing

These rules are the acceptance criteria for architecture decisions.

- [ ] Every legitimate normal meeting action has a discoverable WebMCP capability.
- [ ] Agents should not need DOM inspection or visual wandering to understand meeting state.
- [ ] Phase restrictions should normally govern **execution**, not hide the existence of normal collaboration tools.
- [ ] Role/authority restrictions are used only where the action genuinely requires authority.
- [ ] Administrative authority and decision authority remain separate.
- [ ] Final approval remains intentionally human-confirmed.
- [ ] Agents can determine who is still working, what changed, and what they should do next.
- [ ] Participants receive explicit human-readable roles and explicit decision authority.
- [ ] The judge leads the demo; the demo is not dependent on one memorized prompt script.
- [ ] Finalized meetings produce one canonical report available to every participant.
- [ ] The canonical final report is exportable as PDF.
- [ ] Manual UI remains usable, but agent-first interaction is the preferred path.
- [ ] 3D remains a projection of canonical room state, never a second state system.

---

# 3. P0 — Production Demo Operational Gate

**Owner: Developer A**

The code for the production-safe bootstrap already exists on current `main`.

Do not create another bootstrap implementation.

## Hosted Supabase/Vercel configuration

- [ ] Hosted Supabase anonymous sign-ins are enabled.
- [ ] Hosted Supabase migrations are current.
- [ ] Vercel `NEXT_PUBLIC_SUPABASE_URL` points to the intended hosted Supabase project.
- [ ] Vercel `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` matches that project.
- [ ] Vercel `SUPABASE_SERVICE_ROLE_KEY` is present and server-only.
- [ ] Vercel `NEXT_PUBLIC_APP_URL` is the deployed application origin.
- [ ] No service-role/database secret is exposed through `NEXT_PUBLIC_*`.

## Apply the existing production demo bootstrap

Use the already-committed file:

```text
supabase/production-demo-bootstrap.sql
```

Apply it only to the intended hosted Supabase project:

```bash
psql "$REMOTE_DATABASE_URL" \
  -v ON_ERROR_STOP=1 \
  -f supabase/production-demo-bootstrap.sql
```

- [ ] `REMOTE_DATABASE_URL` was supplied only in the operator shell.
- [ ] `REMOTE_DATABASE_URL` was not committed.
- [ ] Full `supabase/seed.sql` was **not** run against hosted production.
- [ ] Production demo bootstrap completed successfully.

## Hosted smoke test

Use a fresh/incognito browser.

- [ ] `/room/demo` loads.
- [ ] Anonymous session succeeds.
- [ ] Founder/Product Lead seat is claimed.
- [ ] Engineer simulation is present.
- [ ] Product Designer simulation is present.
- [ ] Growth simulation is present.
- [ ] Security Expert is present as advisory/expert.
- [ ] WebMCP meeting tools register.
- [ ] Reset Demo works.
- [ ] Reset returns the demo to a clean initial state.
- [ ] Normal room creation still works.
- [ ] A second fresh browser can request admission.
- [ ] Owner can admit the second browser.
- [ ] Realtime updates are observed by both browsers.

### If `/room/demo` still fails

Inspect the request to:

```text
GET /api/rooms/demo
```

Record:

- [ ] HTTP status: `________`
- [ ] Server log/error: `____________________________________________`

Interpret before modifying more code:

```text
401       -> auth/session/config issue
403/404   -> room fixture/read/claim/RLS issue
500       -> server env/repository/runtime issue
200       -> frontend parsing/client/render issue
```

### P0 exit gate

- [ ] Hosted demo works from fresh incognito.
- [ ] Reset works.
- [ ] Normal create/join/realtime works.
- [ ] No new production bootstrap implementation was created.

---

# 4. Developer A — Agent Protocol/Core Checklist

---

## A1 — Complete and Stable WebMCP Capability Coverage

### Goal

A participant's agent should discover the meeting protocol through WebMCP immediately, without inspecting the website.

### Tool-discovery behavior

- [ ] Audit every legitimate meeting action and map it to a WebMCP tool.
- [ ] Normal collaboration tools are not unnecessarily hidden merely because the current phase is different.
- [ ] Calling a normal tool in the wrong phase returns a structured refusal explaining the current phase and next requirement.
- [ ] Truly privileged tools remain authority-gated.
- [ ] Tool descriptions clearly tell the agent when/why to use each capability.
- [ ] Tool descriptions do not require the agent to inspect DOM/UI state.

### Missing readiness tool

Implement:

```text
mark_my_input_ready
```

- [ ] Tool is discoverable to active claimed human participants.
- [ ] Tool calls the same canonical operation as the existing visible readiness UI.
- [ ] Tool cannot mark another participant ready.
- [ ] Server-side actor identity still derives from authenticated session.
- [ ] Tool returns the resulting room version.

### Final approval tool naming

Expose the participant-facing capability as:

```text
approve_final_decision
```

The tool must **not** autonomously approve.

Required flow:

```text
agent calls approve_final_decision
        ↓
validate caller is required decision approver
validate exact decision hash
        ↓
open/prepare Decision confirmation surface
        ↓
return HUMAN_CONFIRMATION_REQUIRED
        ↓
human reviews and confirms visibly
```

- [ ] Existing autonomous approval bypass does not exist.
- [ ] Human confirmation remains required.
- [ ] Tool is available only to a legitimate required approver.
- [ ] Old overlapping WebMCP name is removed/aliased in a way that does not create duplicate confusing tools.
- [ ] Tests explicitly prove the agent cannot complete human confirmation itself.

### A1 tests

- [ ] Capability-matrix unit tests updated.
- [ ] Tool-catalog tests updated.
- [ ] `mark_my_input_ready` WebMCP test added.
- [ ] `approve_final_decision` human-gate test added.
- [ ] Stale captured tool references still fail server-side after authority/phase changes.

### A1 exit gate

- [ ] A real browser agent can discover how to share input, mark ready, propose, deliberate, align, review, and request final approval from WebMCP alone.
- [ ] No DOM inspection is necessary to discover those actions.

---

## A2 — Canonical Coordination Status

Implement a universal read tool:

```text
get_coordination_status
```

### Required response semantics

Every response should contain enough information for an agent to answer:

```text
Where are we?
What is this phase trying to accomplish?
What have I completed?
Who/what are we waiting for?
Can the meeting advance?
What should I do next?
```

### Input phase

- [ ] Phase goal included.
- [ ] Each active human's readiness included.
- [ ] Whether each participant has shared input is included.
- [ ] `waitingFor` identifies participants not ready.
- [ ] `canAdvance` is derived canonically.
- [ ] Recommended next action is explicit.

### Proposals phase

- [ ] Active/candidate proposal status included.
- [ ] Who proposed the current option is included.
- [ ] Whether the phase has enough state to advance is included.

### Deliberation phase

- [ ] Blocking concern count included.
- [ ] Warning count included.
- [ ] Concern ownership/raiser included.
- [ ] `canAdvance` reflects unresolved blockers.

### Alignment phase

- [ ] Every active human is represented.
- [ ] Shared/not-shared alignment status is explicit.
- [ ] Current alignment choice is included when shared.
- [ ] Missing alignments are explicit.

### Approval phase

- [ ] Frozen decision hash included.
- [ ] Required approvers included.
- [ ] Completed approvers included.
- [ ] Missing approvers included.
- [ ] Human-confirmation requirement is explicit.

### A2 tests

- [ ] Coordination status tests for every phase.
- [ ] Multi-participant readiness test.
- [ ] Missing alignment test.
- [ ] Missing approval test.
- [ ] Removed participants do not count as pending work.

### A2 exit gate

- [ ] An agent can always answer "what are we waiting for?" using one WebMCP read.
- [ ] An agent never needs to navigate the 3D scene to determine whether the meeting advanced.

---

## A3 — Incremental Shared Awareness

Implement:

```text
get_room_updates
```

Input:

```json
{
  "sinceVersion": 27
}
```

### Required change coverage

Return relevant canonical changes after the supplied observed room version:

- [ ] participant joined/admitted;
- [ ] participant removed;
- [ ] role changed;
- [ ] decision authority changed;
- [ ] input/position shared;
- [ ] readiness changed;
- [ ] proposal created;
- [ ] proposal revised/superseded;
- [ ] concern raised;
- [ ] concern resolved;
- [ ] trade-off created;
- [ ] alignment changed;
- [ ] phase changed;
- [ ] Security Expert finding raised/resolved/dispositioned;
- [ ] decision candidate frozen;
- [ ] approval recorded;
- [ ] meeting finalized.

### Implementation constraints

- [ ] Use existing canonical room version/audit history.
- [ ] Do not create a second event store.
- [ ] Returned participant-authored text remains identified as untrusted room content.
- [ ] Tool returns current room version.
- [ ] Tool clearly indicates when no new updates exist.

### Optional if time permits

Implement a bounded:

```text
wait_for_room_change
```

Possible input:

```json
{
  "afterVersion": 27,
  "maxWaitSeconds": 15
}
```

- [ ] Short bounded wait only.
- [ ] No long-running/background agent infrastructure.
- [ ] Timeout produces a normal "no change yet" response.
- [ ] Result uses the same update projection as `get_room_updates`.

### A3 exit gate

- [ ] Agent A acts and records room version.
- [ ] Agent B acts.
- [ ] Agent A requests updates since its previous version.
- [ ] Agent A receives Agent B's relevant changes without DOM inspection.

---

## A4 — Correct Authority Gating

### Product distinction

```text
Meeting administration != meeting progression != decision authority
```

### Any active claimed human may initiate procedural progression

Review and update server/domain authorization for:

```text
advance_discussion
request_team_alignment
```

- [ ] These actions are not owner-only merely because they progress the workflow.
- [ ] Canonical prerequisites still determine success.
- [ ] No participant can bypass missing readiness/blockers/alignment.
- [ ] Actor identity remains authenticated and auditable.

### Decision-maker actions

`decisionRole = decision_maker` should control legitimate decision-review authority.

- [ ] `review_final_decision` is allowed to an active legitimate decision maker when prerequisites are satisfied.
- [ ] `approve_final_decision` is available only when caller is a required approver for the frozen candidate.
- [ ] Final approval still requires visible human confirmation.

### Keep genuine owner administration owner-only

- [ ] `get_waiting_participants`
- [ ] `admit_participant`
- [ ] `reject_participant`
- [ ] `lock_meeting`
- [ ] `unlock_meeting`
- [ ] `remove_participant`
- [ ] `transfer_ownership`
- [ ] decision-policy mutation
- [ ] participant authority/role assignment
- [ ] enabling the organizational specialist/Security Expert

### A4 tests

- [ ] Contributor cannot perform true owner administration.
- [ ] Non-owner active human can initiate allowed procedural advancement.
- [ ] Advancement fails when prerequisites are missing.
- [ ] Decision maker can enter final decision review when valid.
- [ ] Contributor cannot freeze/approve a decision when not authorized.
- [ ] Stale tools remain safely rejected after authority changes.

### A4 exit gate

- [ ] Being a contributor no longer blocks normal collaboration/progression unnecessarily.
- [ ] Owner status remains meaningful for administration.
- [ ] Decision-maker status remains meaningful for consequential decision actions.

---

## A5 — Explicit Waiting and Recovery Semantics

Add/standardize structured failure states where appropriate.

Required semantics:

```text
WAITING_FOR_PARTICIPANTS
WAITING_FOR_ALIGNMENT
UNRESOLVED_BLOCKING_CONFLICT
HUMAN_CONFIRMATION_REQUIRED
```

Use existing codes where equivalent; add new canonical codes only when they materially improve agent understanding.

### Every refusal should explain

- [ ] Why the action cannot happen.
- [ ] What/who is still pending.
- [ ] What the agent/user should do next.
- [ ] Current room version.

Example:

```json
{
  "code": "WAITING_FOR_PARTICIPANTS",
  "message": "Input cannot advance yet.",
  "recovery": "Wait for the CTO to mark their input ready.",
  "details": {
    "waitingParticipantIds": ["..."]
  }
}
```

If `ActionResult.error` needs JSON-safe `details`:

- [ ] Developer A updates the canonical contract.
- [ ] All parsers/tests updated.
- [ ] Developer B does not duplicate the type.

### A5 exit gate

- [ ] A natural-language agent can correctly distinguish "I am not authorized" from "the team is not ready yet."
- [ ] Failed phase progression never leaves the agent guessing.

---

## A6 — Explicit Role and Decision Authority Assignment

### Scope rule

Do **not** build a full RBAC system.

For this sprint:

```text
role         = human-readable/domain identity (CEO, CTO, Designer, etc.)
meetingRole  = administrative authority (owner/cohost/participant)
decisionRole = meeting decision authority (decision_maker/contributor/advisor)
```

### Admission

Extend owner admission/configuration so the admitted participant receives an explicit assigned role and decision role.

Target owner intent:

```text
"Admit Deniz as CTO and give him decision authority."
```

- [ ] Joiner's requested role is treated as requested metadata, not unquestioned authority.
- [ ] Owner can assign/confirm the participant's human-readable role.
- [ ] Owner can assign `decision_maker` or `contributor` where allowed.
- [ ] Ownership is not implicitly transferred.
- [ ] Expert/simulation actors cannot be promoted into human authority.
- [ ] Changes are audited.

### WebMCP owner tool

Prefer one clear configuration capability rather than many ambiguous controls, if it fits the existing architecture.

Possible tool:

```text
configure_participant
```

Possible fields:

```text
participantId
role
decisionRole
```

- [ ] No arbitrary acting participant ID is accepted.
- [ ] Caller authority is always derived server-side.
- [ ] Ownership transfer remains a separate sensitive operation.

### A6 tests

- [ ] Owner admits participant as CTO contributor.
- [ ] Owner admits/configures participant as CTO decision maker.
- [ ] Decision-maker status changes tool availability/authority correctly.
- [ ] Non-owner cannot assign roles/decision authority.
- [ ] Expert/simulation cannot become human decision maker through this path.

### A6 exit gate

- [ ] Every human participant has an explicit visible role.
- [ ] Every human participant has explicit decision authority.
- [ ] Owner's agent can understand and perform legitimate authority delegation.

---

## A7 — Judge-Led Demo Behavior

### Goal

Keep deterministic participant constraints/reactions, but remove dependence on one fixed meeting script.

Keep stable demo actors:

- [ ] Founder / CEO or Product Lead human judge.
- [ ] Engineer simulation.
- [ ] Product Designer simulation.
- [ ] Growth simulation.
- [ ] Security Expert advisory actor.

Keep stable constraint domains:

- [ ] engineering capacity;
- [ ] reuse/existing auth boundaries;
- [ ] accessibility/interaction consistency;
- [ ] launch timing;
- [ ] privacy/security.

### Remove rigid meeting path

- [ ] Judge can introduce a new proposal through normal WebMCP.
- [ ] Simulations react to the actual active proposal/current state.
- [ ] Security review analyzes the actual active proposal.
- [ ] Demo does not require the original seeded proposal to be the only viable path.
- [ ] Demo does not silently auto-finalize.
- [ ] Human decision gate remains intact.

### Keep reliability

- [ ] Simulation reactions remain deterministic/rule-based enough for a judge demo.
- [ ] Demo remains resettable.
- [ ] Reset produces a clean judge-ready state.
- [ ] No hidden fake UI state is introduced.

### A7 exit gate

- [ ] Two materially different judge-created proposals can both run through the protocol.
- [ ] The demo no longer depends on memorizing the old exact prompt sequence.

---

## A8 — Canonical Final Meeting Report

Create one canonical final report projection:

```text
MeetingReport
```

It must derive from canonical finalized decision state.

### Required report content

- [ ] meeting title;
- [ ] meeting brief;
- [ ] executive summary;
- [ ] final decision;
- [ ] rationale;
- [ ] participant names;
- [ ] participant human-readable roles;
- [ ] meeting/decision authority;
- [ ] key inputs;
- [ ] constraints;
- [ ] proposals considered;
- [ ] concerns raised;
- [ ] resolved concerns;
- [ ] accepted trade-offs;
- [ ] alignment;
- [ ] dissent/warnings;
- [ ] Security Expert advice/dispositions;
- [ ] action items;
- [ ] owners;
- [ ] deadlines;
- [ ] decision hash;
- [ ] finalized timestamp;
- [ ] concise provenance/audit summary.

### WebMCP

Expose:

```text
get_final_report
```

- [ ] Available to every active participant after finalization.
- [ ] Report returned to different participants is semantically identical.
- [ ] Decision hash is identical for every participant.
- [ ] Participant-authored content remains correctly marked/untrusted where appropriate.

### A8 tests

- [ ] Report cannot be read before finalization.
- [ ] Final report includes dissent.
- [ ] Final report includes expert advice.
- [ ] Final report includes approvals/authority.
- [ ] Two participants receive the same final decision hash/report basis.

### A8 exit gate

- [ ] Agents no longer reconstruct the final meeting outcome by combining many separate reads.

---

## A9 — PDF Export

Generate the PDF from `MeetingReport`, not from a second independent reconstruction.

Canonical flow:

```text
DecisionRecord
      ↓
MeetingReport
   /     |     \
WebMCP   UI     PDF
```

### Endpoint

Target:

```text
GET /api/rooms/:roomId/report.pdf
```

- [ ] Authenticated access required.
- [ ] Caller must have legitimate room access.
- [ ] Finalized room required.
- [ ] Response content type is `application/pdf`.
- [ ] Suggested filename is stable and human-readable.
- [ ] PDF contains the important report sections.
- [ ] Decision hash appears in PDF.
- [ ] No service credentials leak into browser code.
- [ ] PDF generation dependency, if required, is added only by Developer A.

### A9 tests

- [ ] Unauthorized caller cannot download.
- [ ] Non-finalized room cannot download final report.
- [ ] Finalized participant can download.
- [ ] PDF is non-empty/valid.
- [ ] PDF report decision hash matches `get_final_report`.

### A9 exit gate

- [ ] Every participant can obtain the same finalized report as an exportable PDF.

---

# 5. Developer B — Agent-First UX / 3D Checklist

Developer B can work on B1/B2/B3/B5/B6 in parallel immediately.

B4 authority wiring and B7 canonical report wiring must wait until Developer A's relevant contract/backend changes are merged to `main` and Developer B rebases.

---

## B1 — Simplify Manual Input

### Input phase

Default UI should emphasize one concise human input surface.

Target:

```text
What should the team know from you?

[ text ]

Share with meeting
```

- [ ] Remove the default wall of summary/category/priority/constraint fields.
- [ ] Preserve structured manual controls only as an advanced/fallback path when needed.
- [ ] Primary UI does not expose database/DTO structure to judges.
- [ ] Agent-first guidance is visible.
- [ ] Manual users can still complete the meeting without an agent.

### Proposal phase

Target:

```text
Describe your proposed option

[ text ]

Propose
```

- [ ] Default proposal experience is concise.
- [ ] Advanced structured fields are secondary/hidden.
- [ ] The interface still surfaces enough context for deliberate human review.

### B1 exit gate

- [ ] A first-time judge can understand Input and Proposal screens without explanation.
- [ ] No primary workspace looks like a database form.

---

## B2 — Visible Coordination State

Use existing canonical `RoomState` wherever possible during parallel work.

### Input

Show something like:

```text
INPUT
3 / 4 ready

✓ CEO
✓ Designer
✓ Growth
○ CTO
```

- [ ] Current phase is unmistakable.
- [ ] Phase goal is visible in concise language.
- [ ] Ready count is visible.
- [ ] Pending participants are visible.

### Deliberation

- [ ] Blocking concern count is obvious.
- [ ] Warnings are visually distinct from blockers.
- [ ] Raiser/owner of concern is understandable.

### Alignment

- [ ] Every human participant is represented.
- [ ] Missing alignment is visibly "Waiting", not mistaken for neutrality/support.
- [ ] Alignment remains presented as informative, not a mechanical vote.

### Approval

- [ ] Missing required approvals are obvious.
- [ ] Frozen decision status is obvious.

### B2 exit gate

- [ ] The visible UI tells the same coordination story as the agent protocol.
- [ ] No manual wandering between workspaces is required to answer "who are we waiting for?"

---

## B3 — Explicit Participant Role Presentation

Participant cards/drawer should show human language.

Example:

```text
ATA
CEO

Owner
Decision maker
```

```text
ÇAĞATAY
CTO

Participant
Decision maker
```

- [ ] Human-readable role is prominent.
- [ ] Administrative authority is understandable.
- [ ] Decision authority is understandable.
- [ ] Simulated participants are clearly labeled simulated.
- [ ] Security Expert is clearly advisory/expert.
- [ ] UI does not imply Security Expert can vote/approve/own.
- [ ] Internal enum names are not the primary copy.

### B3 exit gate

- [ ] A judge can tell who the CEO/CTO/etc. is and who may decide without opening technical settings.

---

## B4 — Admission and Authority UX

**Do visual scaffolding in parallel. Wire to canonical actions only after Developer A's A6 changes are merged and Developer B rebases.**

Target:

```text
Deniz wants to join

Requested role
CTO

Assign role
[ CTO ]

Decision authority
○ Contributor
● Decision maker

[ Admit participant ]
```

- [ ] Requested role is shown.
- [ ] Owner explicitly confirms/assigns actual role.
- [ ] Decision authority is explicit.
- [ ] Ownership transfer is not conflated with decision authority.
- [ ] No temporary duplicate contract type is created.
- [ ] After rebase, component uses canonical A6 input/action.

### B4 exit gate

- [ ] Owner can understand and assign participant authority without knowing internal enums.

---

## B5 — Agent-First Guidance, Not Scripted Demo Instructions

Replace rigid prompt scripts with contextual examples.

### Input examples

- [ ] `"What has everyone shared so far?"`
- [ ] `"Share my constraints and mark me ready."`

### Waiting examples

- [ ] `"Are we ready to move on?"`
- [ ] `"Who are we still waiting for?"`

### Deliberation examples

- [ ] `"What changed since my last action?"`
- [ ] `"What is still blocking us?"`

### Alignment examples

- [ ] `"Show me where everyone stands."`

### Decision examples

- [ ] `"Prepare the final decision for my review."`

Rules:

- [ ] Suggestions are optional examples, not required commands.
- [ ] Demo copy does not imply only one exact prompt sequence works.
- [ ] Agent guidance does not instruct DOM inspection.

### B5 exit gate

- [ ] Judge can freely prompt their agent rather than following a tutorial script.

---

## B6 — Intentional Human Final Approval

When the agent requests final approval and receives `HUMAN_CONFIRMATION_REQUIRED`, the UI should make this feel intentional.

Target:

```text
Your agent prepared the final decision.

Review this exact decision before approving.

☐ I reviewed this decision

[ Approve decision ]
```

- [x] Camera/workspace moves to the Decision review surface when appropriate.
- [x] Exact frozen decision is visible.
- [x] Decision hash/identity is available in a non-intrusive way.
- [x] Human confirmation control is explicit.
- [x] Copy explains that human confirmation is deliberate.
- [x] UI does not imply the agent/WebMCP failed.

Delivered as:

- `MeetingShellProvider` gained `openDecisionReviewForHuman()` / `agentPreparedDecision`.
  The WebMCP confirmation bridge's `{ kind: "decision" }` event now calls that
  instead of a bare `goToWorkspace("decision")`, so the room knows *why* it moved.
- The Decision workspace shows a hand-off card — "Your agent prepared the final
  decision… the last step is deliberately yours" — styled as accent, never as
  the error treatment. Tested against a blocklist of failure words.
- The tick reads "I reviewed this decision" with the bound short hash beneath it;
  the full hash stays available on hover and in the report's provenance.
- A standing note under the button: an agent can prepare the exact decision,
  recording it takes the person's own confirmation.
- The notice clears once the person confirms, or when they walk elsewhere.

### B6 exit gate

- [x] Judge understands why one human click remains after agent-driven meeting progression.

---

## B7 — Final Decision Report UI

**Layout can be prepared in parallel. Final canonical wiring occurs after A8 is merged and Developer B rebases.**

Target top-level report:

```text
DECISION REPORT

Decision
Why we chose it

Key constraints
Concerns addressed
Trade-offs
Team alignment
Owners & actions
Security advice

[ Download PDF ]

View detailed provenance
```

- [x] Finalized room automatically exposes the report experience.
- [x] Every participant sees the same decision outcome.
- [ ] Report uses canonical `MeetingReport` after rebase. **Blocked on A8.**
- [x] No second frontend-only report model is introduced.
- [x] Download PDF action points to the authenticated A9 endpoint. **Endpoint pending A9.**
- [x] Provenance is available but not allowed to overwhelm the primary report.

Delivered as `src/components/room/final-report.tsx`:

- The Decision surface *becomes* the report once `phase === "finalized"` — the
  same pedestal, the artifact it now holds. A finalized room fetches the record
  by itself; nobody has to know to press anything.
- Sections in reading order: Decision · Why we chose it · Key constraints ·
  Concerns addressed · Trade-offs · Team alignment · Owners & actions ·
  Security advice · Download PDF · View detailed provenance (a closed
  `<details>`).
- Every value is read out of the server's `DecisionRecord` plus canonical
  `RoomState`. No frontend report interface exists, so the A8 swap is a change
  of source, not of sections. The old "Load persisted final record" button and
  `DecisionRecordView` are gone — the report replaced both.
- Dissent and unresolved warnings are rendered as part of the record, not
  tidied away.

**Two follow-ups after Developer A merges:**

1. swap `getDecisionRecord()` for the canonical `MeetingReport` (A8) and drop
   the small local lookups (constraints by id, resolved objections);
2. `GET /api/rooms/:roomId/report.pdf` does not exist yet, so the Download PDF
   link 404s until A9 lands. The link is correct and needs no change.

### B7 exit gate

- [x] Finalized meeting ends in a clear shared artifact, not a technical state dump.

---

## B8 — 3D State and Navigation Polish

3D should reinforce meeting state, not become navigation work for the agent.

Suggested semantic mapping:

```text
Input         -> participant/readiness area
Proposals     -> proposal surface
Deliberation  -> issues/evaluation board
Alignment     -> alignment surface
Decision      -> decision review surface
Finalized     -> report / memory surface
```

- [x] No manual free-fly requirement.
- [x] Stable camera pose per workspace.
- [x] Camera transitions remain eased.
- [x] Reduced-motion behavior preserved.
- [x] Agent activity may be represented visually but is not authoritative.
- [x] Pending participants/readiness can be understood without tiny 3D text.
- [x] DOM remains the readable/control layer.

Delivered as:

- `PHASE_WORKSPACE` (`src/components/shell/phase-workspace.ts`) makes the
  mapping above real, and `usePhaseFollow` moves the room when the canonical
  phase changes. Three rules keep it from being a hijack: the first snapshot
  never moves, an unchanged phase never moves, and an open drawer wins (the
  owner mid-admission is not dragged away).
- Input maps to the table rather than to a board: input is the phase whose
  subject is the people. Finalized maps to the same decision pedestal approval
  does — one place, one artifact.
- Seats now carry a raised marker for anyone the room is waiting on
  (`PendingMarker`). Silhouette, not text: "three markers up" is countable from
  the room pose. Only *pending* is ever marked — there is no "done" token,
  because in Proposals and Deliberation the room is short of a thing rather
  than a person, and a clean table is the honest picture there.
- The marker reads `deriveCoordinationStatus(room).waitingParticipantIds`, the
  same derivation the DOM roster and the coordination strip read, so a chair
  can never disagree with the sentence above it.
- Camera behaviour is untouched: still the named poses in `CAMERA_POSES`, still
  eased by `CameraController`, still an instant cut under reduced motion, and
  still no orbit/pan/WASD anywhere in the scene.

### B8 exit gate

- [x] 3D makes the meeting easier to understand without becoming necessary for protocol comprehension.

---

# 6. First Integration Checkpoint

Do not wait until both branches are huge.

Developer A should finish and verify at least:

```text
A1 WebMCP coverage
A2 Coordination
A3 Updates
A4 Authority
A5 Waiting semantics
A6 Role/authority assignment
```

Before the first core merge.

## Developer A verification before PR/merge

Run against the **local Supabase test stack**, not hosted production:

```bash
npm run check
npm run test:unit
npm run test:domain
npm run test:e2e
npm run build
```

- [ ] `npm run check` passed.
- [ ] `npm run test:unit` passed.
- [ ] `npm run test:domain` passed.
- [ ] `npm run test:e2e` passed.
- [ ] `npm run build` passed.
- [ ] No automated test command reset/mutated hosted production Supabase.
- [ ] Existing Security Expert authority guarantees still pass.
- [ ] Existing ownership/removal/realtime tests still pass.

### Merge A core

- [ ] `feature/agent-protocol-core` reviewed.
- [ ] A1–A6 merged into `main`.
- [ ] Earlier repository checklist/status updated by integrator.

---

# 7. Developer B Rebase Checkpoint

After A core reaches `main`:

```bash
git switch feature/agent-first-ux
git fetch origin
git rebase origin/main
```

- [ ] Rebase completed.
- [ ] No canonical backend type was overwritten by UI branch.
- [ ] No old capability matrix was restored.
- [ ] No old authority behavior was accidentally reintroduced.
- [ ] B4 wired to canonical role/decision-authority actions.
- [ ] B2 updated if coordination data shape requires it.
- [ ] B6 wired to canonical `approve_final_decision` flow.

Developer B then continues/finishes B1–B6.

---

# 8. Report Integration Checkpoint

Developer A completes:

```text
A7 judge-led demo
A8 MeetingReport
A9 PDF export
```

Verify:

```bash
npm run check
npm run test:unit
npm run test:domain
npm run test:e2e
npm run build
```

- [ ] A7 passed.
- [ ] A8 passed.
- [ ] A9 passed.
- [ ] Report API/WebMCP/PDF share one canonical report basis.
- [ ] A7–A9 merged into `main`.
- [ ] Earlier repository checklist/status updated.

Developer B rebases again:

```bash
git switch feature/agent-first-ux
git fetch origin
git rebase origin/main
```

Then:

- [ ] B7 wired to canonical `MeetingReport`.
- [ ] B7 Download PDF wired to canonical A9 endpoint.
- [ ] B8 final 3D/report transitions completed.

---

# 9. Developer B Final Verification and Merge

Run:

```bash
npm run check
npm run test:unit
npm run build
```

Then targeted Playwright tests for the modified user journeys.

- [ ] `npm run check` passed.
- [ ] `npm run test:unit` passed.
- [ ] `npm run build` passed.
- [ ] Input simplification manually verified.
- [ ] Role/authority assignment UI manually verified.
- [ ] Coordination UI manually verified.
- [ ] Human confirmation UX manually verified.
- [ ] Final report UI manually verified.
- [ ] PDF download manually verified.
- [ ] `feature/agent-first-ux` merged into `main`.
- [ ] Earlier repository checklist/status updated.

---

# 10. Canonical Two-Human / Two-Agent Live Test

This is a **required manual gate**.

Use two real browser sessions and two real agents.

## Setup

### Human/Agent A

- [ ] Creates room through WebMCP.
- [ ] Is clearly identified as CEO/owner/decision maker.

### Human/Agent B

- [ ] Requests join.
- [ ] Is admitted as CTO.
- [ ] Has explicit decision authority assigned as intended.

## Shared context

- [ ] Agent A uses WebMCP discovery rather than DOM inspection.
- [ ] Agent B uses WebMCP discovery rather than DOM inspection.
- [ ] Agent A reads meeting/participant roles.
- [ ] Agent B reads meeting/participant roles.
- [ ] Both agents understand who has administrative authority.
- [ ] Both agents understand who has decision authority.

## Input

- [ ] Agent A shares input through WebMCP.
- [ ] Agent B shares input through WebMCP.
- [ ] Agent A marks input ready through WebMCP.
- [ ] Agent B marks input ready through WebMCP.
- [ ] Neither human clicks readiness manually.
- [ ] Coordination status says all required humans are ready.

## Proposals

- [ ] Meeting advances through WebMCP/state-machine action.
- [ ] One agent proposes an option.
- [ ] Other agent learns about it through `get_room_updates` / coordination reads.
- [ ] No DOM inspection is needed to discover the new proposal.

## Deliberation

- [ ] One agent raises a concern.
- [ ] Other agent sees the concern through WebMCP.
- [ ] Other agent responds/revises.
- [ ] Concern resolves through canonical operations.
- [ ] Agents understand when the room is still blocked vs ready.

## Alignment

- [ ] Alignment requested through WebMCP.
- [ ] Agent A expresses its human's alignment.
- [ ] Agent B expresses its human's alignment.
- [ ] Both agents can see missing/current alignments.
- [ ] Alignment is not presented as an automatic vote outcome.

## Decision

- [ ] Legitimate decision maker freezes/reviews candidate.
- [ ] Agent calls `approve_final_decision`.
- [ ] Tool returns `HUMAN_CONFIRMATION_REQUIRED`.
- [ ] Agent cannot autonomously bypass confirmation.
- [ ] Human reviews exact decision.
- [ ] Human manually confirms approval.
- [ ] Finalization updates both browsers via realtime.

## Final report

- [ ] Agent A calls `get_final_report`.
- [ ] Agent B calls `get_final_report`.
- [ ] Decision hash matches.
- [ ] Final decision matches.
- [ ] Dissent/warnings match.
- [ ] Security advice matches.
- [ ] PDF can be downloaded.
- [ ] PDF decision hash matches canonical report.

### Two-agent live gate

- [ ] **PASS: neither agent needed DOM inspection/wandering for meeting protocol.**
- [ ] **PASS: normal collaboration was not unnecessarily owner-gated.**
- [ ] **PASS: genuine administrative/decision authority remained enforced.**
- [ ] **PASS: final human confirmation remained mandatory.**

---

# 11. Judge-Led Hosted Demo Gate

Run on the actual deployed application after `main` is deployed.

Use a fresh/incognito browser.

- [ ] `/room/demo` opens.
- [ ] Judge becomes the intended human participant.
- [ ] WebMCP tools are discovered immediately.
- [ ] Judge can ask an arbitrary reasonable meeting question.
- [ ] Judge can introduce a proposal that differs from the old scripted proposal.
- [ ] Simulated teammates respond to current state/proposal.
- [ ] Security Expert reviews relevant actual proposal content.
- [ ] Agent knows when it is waiting for another participant/state condition.
- [ ] Agent knows when the meeting advances.
- [ ] Human approval gate works.
- [ ] Final report appears.
- [ ] PDF downloads.
- [ ] Reset Demo works after the run.

### Hosted demo gate

- [ ] PASS in fresh incognito.
- [ ] PASS after Reset Demo.
- [ ] PASS after one full judge-led meeting.

---

# 12. Final Regression Gate

From latest merged `main`:

```bash
git switch main
git pull origin main
```

Run:

```bash
npm run check
npm run test:unit
npm run test:domain
npm run test:e2e
npm run build
```

- [ ] `npm run check`
- [ ] `npm run test:unit`
- [ ] `npm run test:domain`
- [ ] `npm run test:e2e`
- [ ] `npm run build`

Manual:

- [ ] normal room creation;
- [ ] passcode join;
- [ ] invite join;
- [ ] waiting-room admission;
- [ ] participant removal;
- [ ] ownership transfer;
- [ ] meeting lock/unlock;
- [ ] readiness;
- [ ] proposals;
- [ ] concerns/trade-offs;
- [ ] alignment;
- [ ] decision review;
- [ ] human final approval;
- [ ] Security Expert;
- [ ] realtime convergence;
- [ ] final report;
- [ ] PDF;
- [ ] deployed `/room/demo`;
- [ ] Reset Demo.

Security/authority:

- [ ] removed participant cannot regain room access;
- [ ] stale WebMCP tool references fail closed;
- [ ] contributor cannot perform owner administration;
- [ ] unauthorized participant cannot approve;
- [ ] expert/simulation cannot gain human decision authority;
- [ ] service-role credentials are server-only;
- [ ] finalized record remains immutable.

---

# 13. P2 — Only If Core Agent-Native Loop Is Green

Do **not** start these while any P0/P1 gate above is red.

## Workspace context

Possible canonical additions:

```text
WorkspaceContext
Workstreams
```

Possible tools:

```text
get_workspace_context
list_workstreams
```

- [ ] Start only after final regression/live-agent gate is healthy.

## Organizational decision memory

Possible canonical addition:

```text
OrganizationalDecision
```

Possible tools:

```text
get_relevant_context
list_organizational_decisions
```

- [ ] Start only after final report/PDF is healthy.

## Additional 3D polish

- [ ] Only after protocol, report, and hosted demo are green.

---

# 14. Cut List If Time Runs Short

Cut from the bottom upward.

### Never cut

- [ ] hosted `/room/demo` operational;
- [ ] complete WebMCP discovery/coverage;
- [ ] `mark_my_input_ready`;
- [ ] correct authority gating;
- [ ] coordination status;
- [ ] multi-agent updates/awareness;
- [ ] explicit participant roles/decision authority;
- [ ] human final approval gate;
- [ ] final shared report.

### Cut later if necessary

1. [ ] optional `wait_for_room_change`;
2. [ ] extra PDF visual polish;
3. [ ] extra 3D transitions;
4. [ ] workspace/workstreams;
5. [ ] organizational decision memory;
6. [ ] additional specialists;
7. [ ] marketplace/recruitment expansion.

---

# 15. Definition of Done

The sprint is complete only when this statement is true:

> Two humans can join one meeting with their own agents. The agents immediately discover the meeting protocol through WebMCP, understand all participants' roles and authority, share and observe canonical meeting inputs, know when they must wait, know when the room advances, deliberate without inspecting the DOM, respect administrative and decision authority, prepare the exact final decision for deliberate human confirmation, and leave every participant with the same canonical final report and downloadable PDF.

Final sign-off:

- [ ] Developer A sign-off: __________________
- [ ] Developer B sign-off: __________________
- [ ] Two-agent live test sign-off: __________________
- [ ] Hosted demo sign-off: __________________
- [ ] Earlier repository checklist/status updated to reflect final merged state.
