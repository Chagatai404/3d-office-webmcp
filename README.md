# Quorum: Agent-Native Decision Rooms

A shared decision room where several people, each with their own authority and
their own browser agent, negotiate a real decision together — and where the
final call still belongs to a specific accountable human.

**Agents negotiate. Humans decide.**

Real decisions rarely have one decision-maker. A release, a pricing change, a
vendor pick, a launch call — an engineer, a designer, a growth lead, and a
founder each bring different facts, different constraints, and different
authority. Most AI tools optimize for a single user talking to a single
assistant. This project explores what happens when several people bring their
own browser agents into *one* shared room, without collapsing their separate
identities, disagreements, or approval authority into one AI.

## Live demo

- **App:** [quorummeet.vercel.app](https://quorummeet.vercel.app/)
- **Judge route (deterministic):** [quorummeet.vercel.app/room/demo](https://quorummeet.vercel.app/room/demo)

## Try it in under a minute

1. Open the [judge route](https://quorummeet.vercel.app/room/demo).
2. Bring a WebMCP-capable browser agent to that page — either **ChatGPT's
   in-app browser** (WebMCP support built in) or **Chrome 149+** with WebMCP
   enabled (see [`docs/webmcp-demo.md`](docs/webmcp-demo.md) for exact flags).
   A WebMCP-capable agent claims the open "Founder / Product Lead" seat
   automatically; a plain human browser instead sees a **Take the wheel**
   button.
3. Ask it: *"What is this room deciding, and what does the team care about?"*
   Your agent calls `get_meeting_context` — a real, registered WebMCP tool,
   not a scripted response.

For the full deterministic walkthrough (exact prompts, what to expect at each
step, what the tool calls prove), see **[`docs/judge-demo.md`](docs/judge-demo.md)**.
For Chrome DevTools inspection of the live tool catalog and deeper test
scripts, see **[`docs/webmcp-demo.md`](docs/webmcp-demo.md)**.

## Why WebMCP

A generic chatbot bolted onto a web app can only click buttons and read text —
it has no reliable way to know what actions are currently valid, who is
allowed to take them, or what state just changed. WebMCP's
`document.modelContext` gives the page itself a way to describe, in the
browser, exactly which structured actions are available *right now, to this
authenticated session* — and to change that set live as the room's state
changes, without a page reload.

That is the actual shape of this problem. A concern can only be raised during
Deliberation. Only a required approver can approve a decision. Only the owner
can admit a waiting participant. A generic DOM-clicking agent has to guess
these rules from the UI; a WebMCP agent reads them directly from the tool
catalog the page hands it, and the catalog itself enforces the room's rules by
construction — a tool for an action that isn't currently valid simply isn't
registered.

## What happens in a decision room

```text
Human context  →  Options  →  Concerns & trade-offs  →  Alignment  →  Decision review  →  Explicit approval  →  Immutable record
   (Input)       (Proposals)     (Deliberation)         (Alignment)     (freeze)         (human click)        (finalized)
```

- **Input** — each participant shares their own facts and constraints
  (`share_my_context`) and marks their input ready.
- **Proposals** — anyone suggests a candidate option (`suggest_option`).
- **Deliberation** — participants raise concerns (`raise_concern`), propose
  trade-offs and revisions (`respond_to_concern`), and resolve their own
  concerns (`resolve_my_concern`).
- **Alignment** — participants share support, a concern, a strong objection,
  or a request for clarification on the current candidate
  (`express_my_alignment`). This is **informative, not a vote** — it never
  mechanically decides the outcome.
- **Decision review** — a decision-maker freezes the exact current candidate
  and its content hash (`review_final_decision`).
- **Explicit approval** — a required approver calls `approve_final_decision`,
  which never finalizes anything by itself: it returns
  `HUMAN_CONFIRMATION_REQUIRED` and opens the visible Decision workspace. Only
  the human's own click finalizes the room.
- **Immutable record** — the finalized decision, its full rationale, dissent,
  and provenance are readable forever (`get_decision_record`,
  `get_final_report`).

Who is required to approve is set by the room's `DecisionPolicy`:
`owner_decides` (the owner alone approves; alignment informs but never binds
them) or `equal_authority_consensus` (every active decision-maker must
approve separately). See [`src/contracts/room.ts`](src/contracts/room.ts) and
[`src/domain/rooms/decision.ts`](src/domain/rooms/decision.ts).

## Demo scenario

The shipped judge demo is the **AI-assisted onboarding release decision**: a
startup team deciding whether to ship AI-assisted onboarding in the upcoming
release, under real tension between engineering capacity, accessibility,
campaign timing, and privacy.

- **You** are the real human participant — the Founder / Product Lead, the
  room's owner and decision-maker. Every action attributed to that seat comes
  from your own authenticated browser session, the same as any normal room's
  owner.
- **Engineer, Product Designer, and Growth Lead** are deterministic
  *simulated* teammates — server-side logic that reacts to real room state
  through the same domain layer as every other mutation. They are clearly
  labeled "Simulated participant" and are never presented as independent
  humans or browser agents.
- **The Security Expert** is an advisory-only server actor (`kind: "expert"`),
  labeled "Security Expert · Advisory". It can review proposals and surface
  findings, but it can never join as human, become owner, align as a
  decision-maker, approve, or finalize anything.
- A **normal production room**, created through `create_meeting` or the
  Create Meeting flow, is an independent, fully isolated multi-user room with
  no simulated participants — the demo scenario exists specifically to give a
  judge a deterministic, single-session way to see the whole lifecycle.

See [`docs/judge-demo.md`](docs/judge-demo.md) for the exact prompt sequence.

## WebMCP implementation

Tools are registered with the imperative WebMCP API on `document.modelContext`.
Conceptually, a tool definition looks like this:

```ts
await document.modelContext.registerTool({
  name: "raise_concern",
  description: "Raise a concern against the active proposal during Deliberation...",
  inputSchema: {
    type: "object",
    properties: {
      proposalId: { type: "string", minLength: 1 },
      reason: { type: "string", minLength: 1 },
      severity: { type: "string", enum: ["blocking", "warning"] },
    },
    required: ["proposalId", "reason", "severity"],
  },
  execute: async (input) => {
    /* validate, call the domain layer, return a structured result */
  },
});
```

The production code does not call `registerTool` inline like this everywhere.
Tool *definitions* are built by
[`src/webmcp/room-tools.ts`](src/webmcp/room-tools.ts) and
[`src/webmcp/onboarding-tools.ts`](src/webmcp/onboarding-tools.ts); actual
*registration* against `document.modelContext` happens in
[`src/webmcp/register-tools.ts`](src/webmcp/register-tools.ts), which
re-registers the live tool set through an `AbortController` every time a
participant's derived capability signature changes.

**Registration is dynamic, not static.** [`src/webmcp/capability-context.ts`](src/webmcp/capability-context.ts)
holds a single predicate table — one row per tool — that derives the exact
available tool set from route, whether a seat is claimed, meeting role,
decision role, room phase, decision policy, lock state, whether a decision
candidate is frozen, and whether the current participant is a required
approver. When any of that changes — a phase advance, an admission, an
ownership transfer, a policy change, a lock toggle — the old tools are
unregistered and the new phase's tools are registered in their place, live, no
reload. This is the core of the WebMCP story here: an agent's available
capabilities are never a fixed menu, and the catalog itself expresses the
room's rules.

Representative tools (verify the full, current list against
[`capability-context.ts`](src/webmcp/capability-context.ts)):

| Category | Tools |
|---|---|
| Onboarding | `create_meeting`, `join_meeting`, `get_my_join_status` |
| Orientation | `get_meeting_context`, `get_coordination_status`, `get_room_updates`, `get_my_attention_items` |
| Input & proposals | `share_my_context`, `mark_my_input_ready`, `suggest_option` |
| Deliberation | `raise_concern`, `respond_to_concern`, `resolve_my_concern`, `get_open_issues` |
| Alignment & decision | `express_my_alignment`, `get_alignment`, `review_final_decision`, `approve_final_decision`, `get_decision_record`, `get_final_report` |
| Owner / admin | `admit_participant`, `reject_participant`, `lock_meeting`/`unlock_meeting`, `configure_participant`, `set_decision_policy`, `set_participant_decision_role`, `remove_participant`, `transfer_ownership` |
| Security Expert | `enable_security_expert`, `request_security_review`, `get_expert_advice`, `record_expert_advice_outcome` |

Manual UI clicks, WebMCP tool calls, and the Security Expert's own actions all
converge on the same domain operations in
[`src/domain/rooms/operations.ts`](src/domain/rooms/operations.ts) — there is
no separate "WebMCP-only" code path with weaker rules.

WebMCP does not give agents a direct channel to each other. Coordination
happens through shared application state:

```text
Browser agent
  → WebMCP tools registered in that participant's browser (document.modelContext)
    → application/domain operations (src/domain/rooms/operations.ts)
      → server-side authorization (Supabase, derived from the authenticated session)
        → shared room state (Supabase Postgres)
          → realtime updates
            → every other participant's session
```

## Human authority by design

| Property | How it's enforced |
|---|---|
| Agent input never supplies trusted identity | Every mutation derives the acting participant from the authenticated Supabase session server-side, never from a tool argument. |
| A participant can't act as another | E.g. `resolve_my_concern` only resolves concerns *you* raised; `express_my_alignment` only sets *your* alignment. |
| Untrusted content is labeled | Read tools split `trustedContext` from `untrustedRoomContent`; participant-authored text is never treated as instructions (see `tests/webmcp/prompt-injection.test.ts`). |
| Stale state is rejected, not replayed | A mutation against an outdated room version returns `STALE_ROOM_STATE` and asks the agent to re-read and reconsider, not blindly retry. |
| Consequential actions need a visible human click | `remove_participant`, `transfer_ownership`, and `approve_final_decision` never complete from a tool call alone — they arm the real UI confirmation and return `HUMAN_CONFIRMATION_REQUIRED`. |
| Final approval is bound to an exact decision | `approve_final_decision` takes the frozen candidate's exact content hash; if the candidate changes, a stale approval cannot finalize the new one. |
| The Security Expert is advisory only | It is a distinct actor kind (`expert`, never `human`), excluded by construction from ownership, decision authority, alignment, approval, and finalization. |

Full technical detail: [`docs/backend-integration.md`](docs/backend-integration.md).

## Architecture

```text
Manual UI ─────────┐
Browser WebMCP  ────┼──▶ Domain operations ──▶ server-side authorization ──▶ Supabase
Security Expert ────┘                                                          │
                                                                          realtime
RoomState ──▶ semantic DOM UI                                                  │
RoomState ──▶ createRoomVisualizationState() ──▶ 3D presentation   ◀───────────┘
```

- [`src/contracts/room.ts`](src/contracts/room.ts) is the single canonical
  room contract shared by the UI, WebMCP tools, and the API.
- The 3D layer is presentation-only: it never performs authorization or
  drives a business transition.

## The 3D room

One central 3D meeting room — a round table, seated participant avatars, and
wall-mounted boards (Brief, Constraints, Sources, Proposals, Issues,
Alignment, Decision) — driven by the same canonical `RoomState` as the rest of
the app. Selecting a workspace flies the camera to a named, pre-authored pose
for that board (`src/visualization/scene/camera-poses.ts`); the camera only
ever moves to one of these fixed positions, never to arbitrary coordinates.
Committed `.glb` models (`public/models/meeting-room/`) furnish the room. The
3D layer exists to make who's doing what, and what's changed, spatially
legible at a glance — it never holds authorization or canonical decision
state, both of which live entirely in `RoomState`.

## Run locally

Requirements: Node.js 20.9+ and Docker (for local Supabase).

```bash
npm install
npm run supabase:start
npx supabase status -o env
```

Copy the reported `API_URL` and `PUBLISHABLE_KEY` into `.env.local` (see
[`.env.example`](.env.example)), then:

```bash
npm run dev
```

Open `http://localhost:3000/room/demo` for the local seeded judge room.

## Testing

```bash
npm run check       # lint + typecheck + contracts/decision/webmcp unit tests
npm run test:webmcp  # WebMCP catalog, schemas, authority, registration, attention,
                      # prompt-injection, and tool-selection eval tests only
npm run test:domain  # domain/database tests against local Supabase
npm run test:e2e     # multi-browser Playwright, incl. live WebMCP registration
npm run test:all     # unit + domain + e2e
```

`tests/webmcp/` includes dedicated coverage for registration/deregistration,
participant-authority boundaries, prompt-injection resistance, and
tool-selection evals. `tests/playwright/` (Playwright) exercises dynamic tool
registration and stale-tool-reference rejection against the real server
boundary across multiple simulated browsers. Verify all commands above
against [`package.json`](package.json) before relying on this list.

## Repository map

| Path | What's there |
|---|---|
| [`src/contracts/room.ts`](src/contracts/room.ts) | The canonical room contract (types, schemas) |
| [`src/domain/rooms/`](src/domain/rooms/) | Domain operations, decision hashing, the Security Expert, attention derivation |
| [`src/webmcp/`](src/webmcp/) | Tool definitions, capability-driven registration, tool-result shaping, confirmation bridge |
| [`src/components/shell/`](src/components/shell/) | The meeting UI shell — toolbar, drawers, workspace dock |
| [`src/visualization/`](src/visualization/) | The 3D scene, camera poses, and room props |
| [`public/models/meeting-room/`](public/models/meeting-room/), [`public/models/people/`](public/models/people/) | Committed `.glb` room and avatar assets |
| [`CREDITS.md`](CREDITS.md) | Third-party 3D asset attribution (CC-BY, via Poly Pizza) |
| [`tests/webmcp/`](tests/webmcp/) | WebMCP catalog, authority, and prompt-injection tests |
| [`docs/judge-demo.md`](docs/judge-demo.md) | Canonical judge walkthrough |
| [`docs/webmcp-demo.md`](docs/webmcp-demo.md) | Chrome/WebMCP inspection and deeper test scripts |
| [`docs/backend-integration.md`](docs/backend-integration.md) | Full API/authority/realtime/WebMCP architecture |
| [`docs/status.md`](docs/status.md) | Implementation history |
| [`docs/devpost-submission.md`](docs/devpost-submission.md) | Devpost submission copy |

## License

This project is licensed under the GNU Affero General Public License v3.0
(AGPL-3.0-only) — see [`LICENSE`](LICENSE). For commercial licensing
inquiries, contact the project maintainers.

Third-party 3D asset attribution (Poly Pizza, CC-BY) is in
[`CREDITS.md`](CREDITS.md) and is also shown in-app, in the meeting room's
Help drawer.

