# Devpost submission copy

Copy/paste-ready text for the Devpost submission form. This file is internal
authoring material but is safe to leave public in the repository.

---

## One-line pitch

Quorum is a shared decision room where every accountable person brings their
own browser agent — agents deliberate, humans still click approve.

## Short description (Devpost summary field)

Real decisions rarely have one decision-maker. An engineer, a designer, a
growth lead, and a founder each bring different facts, constraints, and
authority to a release call, a pricing change, or a vendor pick. Most AI
tools optimize for one user talking to one assistant. Quorum is a WebMCP-native
shared decision room: each participant's own browser agent calls real,
dynamically-registered WebMCP tools to share context, propose options, raise
concerns, and negotiate trade-offs inside one canonical room — while every
human keeps a separate identity, and the final approval always requires a
specific accountable person's own visible click. The shipped demo is an
AI-assisted onboarding release decision: engineering capacity, accessibility,
campaign timing, and privacy all in real tension, resolved through structured
deliberation instead of a chat transcript.

## Full description

### Why this is a strong fit for WebMCP

A generic chatbot layered on a web app can only click around the DOM — it has
no reliable way to know which actions are valid right now, for this
authenticated person, in this room's current state. This product's actual
problem is exactly the shape WebMCP is built for: a concern can only be raised
during Deliberation; only a required approver can approve; only the owner can
admit a new participant. `document.modelContext.registerTool` lets the page
hand a browser agent that exact, live, per-session capability set instead of
making it infer the rules from pixels. When the room's state changes, the
tool catalog changes with it — a phase advance, an admission, a policy change,
or a lock toggle unregisters the old tools and registers the next phase's
tools, live, no reload.

### How it creates a better user experience

Instead of everyone typing into one shared chat with one shared AI, each
person keeps their own agent and their own seat. A participant's agent can
draft their position from their own context, but it can never act as another
participant, never see another participant's private material, and never
click the final approval on a human's behalf. Sensitive actions — removing a
participant, transferring ownership, approving the final decision — always
resolve to `HUMAN_CONFIRMATION_REQUIRED` and open the real, visible
confirmation UI; the tool call prepares the action, a human click finishes it.
The 3D meeting room turns "who did what, and what changed" into something
spatially legible at a glance, instead of a wall of log lines.

### What people and agents can now do together

Before this pattern, giving several people's agents access to one shared
decision meant either one agent for everyone (collapsing separate authority
and disagreement into a single AI) or independent chats with no shared state
(no real coordination at all). Here, each human's agent can read the same
canonical room state, act only within that human's own authority, and see
other participants' contributions as they happen — while the room's actual
decision-making rule (`owner_decides` or `equal_authority_consensus`) and its
required approvers stay exactly where they were: with specific, named humans.
Alignment (support / concern / strong objection / needs clarification) is
informative context for whoever holds decision authority, never a vote that
mechanically produces an outcome.

### How WebMCP is implemented

Tool definitions live in `src/webmcp/room-tools.ts` and
`src/webmcp/onboarding-tools.ts`; registration against `document.modelContext`
happens in `src/webmcp/register-tools.ts`. A single predicate table in
`src/webmcp/capability-context.ts` — one row per tool — derives the exact
available set from route, claimed-seat status, meeting role, decision role,
phase, decision policy, lock state, frozen-candidate state, and
required-approver status, and registration is re-run through an
`AbortController` every time that derived signature changes. Every mutation,
whether triggered by a WebMCP tool call, a manual UI click, or the advisory
Security Expert, converges on the same domain operations
(`src/domain/rooms/operations.ts`), which derive the acting participant from
the authenticated Supabase session server-side — never from a tool argument.

## Judging-criteria mapping

**WebMCP Leverage.** ~40 dynamically-registered tools span onboarding,
orientation, deliberation, alignment, decision approval, owner
administration, and an advisory expert. Availability is computed by one
capability table, not scattered ad hoc checks, and tools are torn down and
re-registered live as room state changes — the catalog itself expresses the
room's rules rather than exposing one novelty function.

**Execution.** The app is deployed and reachable at the live URL below; the
deterministic `/room/demo` route lets any judge run the entire lifecycle
solo. Server-side authorization is unconditional and independent of what the
client has registered, so a stale captured tool reference fails safely.
Dedicated test coverage exists for the tool catalog, participant-authority
boundaries, prompt-injection resistance, and live registration/deregistration
across multiple simulated browsers.

**Potential Impact.** Multi-stakeholder decisions with separate accountability
are common — release go/no-go, pricing, procurement, launch trade-offs — and
today's single-user AI assistants don't model that structure at all. This is
a concrete, working exploration of several people bringing their own agents
into one decision without collapsing their authority into a single AI.

**Creativity & Ambition.** The harder, more honest design was chosen over the
easier one: no universal-voting shortcut, an explicit `DecisionPolicy` naming
who actually decides, and final approval hash-bound to an exact frozen
candidate so a stale approval can never finalize a changed decision. The 3D
room is a spatial projection of the same canonical state everything else
reads, not decoration layered on top of a form.

## Links

- **Live app:** https://quorummeet.vercel.app/
- **Judge demo (deterministic):** https://quorummeet.vercel.app/room/demo
- **GitHub repo:** https://github.com/Chagatai404/quorum-webmcp
- **YouTube demo:** `TODO: ADD FINAL PUBLIC YOUTUBE URL`

## Suggested Devpost tagline

Agents deliberate. Humans intervene. Leaders decide.

## Suggested gallery captions

1. The shared 3D decision room — one table, every participant's seat, and the
   boards that hold the room's actual state.
2. A browser agent calling a real, registered WebMCP tool — not a scripted
   chat response.
3. A blocking concern and its resolution, negotiated through structured
   trade-offs instead of buried in chat.
4. The Security Expert's advisory findings, visually distinct from human
   concerns — it can flag risk, but it never votes or approves.
5. The exact frozen decision awaiting one required human's visible,
   hash-bound approval.
