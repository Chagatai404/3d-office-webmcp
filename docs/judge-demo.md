# Judge demo: `/room/demo`

The canonical, deterministic hackathon demonstration. One human judge, their own browser
agent, and the real production WebMCP catalog -- nothing here is a UI animation pretending
backend work happened.

> **Agents deliberate. Humans intervene. Leaders decide.**

## The scenario

**Decision:** Should the startup ship AI-assisted onboarding in the upcoming release?

**Room:** "AI Onboarding Release Decision" -- deciding whether to ship AI-assisted onboarding
in the upcoming release while respecting engineering capacity, accessibility, campaign
timing, privacy, and existing authentication boundaries. Default policy: `owner_decides`.

## Who is who

| Seat | Kind | What it means |
|---|---|---|
| **Founder / Product Lead** | `human` — **you** | The real owner and decision-maker. Every action attributed to this seat is your own browser session, authenticated the same way any normal room's owner is. |
| **Engineer** | `simulation` | Deterministic. Reacts to real room state through the same domain/repository layer as every other mutation -- never a second, fake state. |
| **Product Designer** | `simulation` | Deterministic. |
| **Growth Lead** | `simulation` | Deterministic. |
| **Security Expert** | `expert` — **advisory only** | A server-side rule-based service, not a simulated human and not a browser-agent session. It can never join as human, become owner, align as a decision-maker, approve, or finalize -- every authority-deriving database function requires `kind = "human"`, which excludes it by construction. See `docs/backend-integration.md`'s Slice 6 section for the full architecture. |

Every non-owner participant carries an unmistakable label in the Participants drawer and the
meeting toolbar: "Simulated participant" or "Security Expert · Advisory". Neither is ever
labeled "Human" or "Connected human".

## What is seeded

- **Engineer:** only about two engineering days are available; do not rewrite authentication; reuse existing infrastructure.
- **Product Designer:** accessibility cannot regress; interaction patterns must stay consistent; avoid untested onboarding patterns.
- **Growth Lead:** the campaign launch date cannot move; the onboarding surface must stabilize before the campaign cutoff; the launch needs a measurable but simple experiment.
- **Security Expert:** collect only the data needed; avoid unnecessary auth/security-boundary expansion (surfaced as advisory findings once a matching proposal exists, not as seeded text).

The room already contains one deliberately over-scoped proposal, **"Highly personalized AI
onboarding"**: behavioral event tracking, a persistent per-user profile, dynamic onboarding
paths, new auth-linked profile fields, broad analytics instrumentation, and a custom
interactive onboarding UI, all in the upcoming release. It is scoped to trigger an
engineering capacity objection, a design/accessibility concern, and Security Expert advisory
findings, while the Growth deadline stays visible as context.

## Before you start

Open `http://localhost:3000/room/demo`. A fresh anonymous browser session automatically
becomes the Founder/Product Lead the first time it loads a never-claimed demo room -- there
is no room ID or passcode to know. If another judge session is already mid-demo, the Founder
seat may already be claimed by them; use **Reset demo** (Help drawer, described below) to
return to a clean run before continuing.

## The exact prompt script

Say these to your connected browser agent, in order. Each line names the real WebMCP tool
your agent should call -- you never need to say the tool name yourself.

1. **"What is this room deciding, and what does the team care about?"**
   Expected: `get_meeting_context`.
2. **"Move us forward."**
   Expected: the owner phase-advance tool (`advance_discussion`), moving Input → Proposals →
   Deliberation as needed. The seeded over-scoped proposal becomes active automatically; you
   do not need to type it yourself.
3. **"What concerns are blocking us?"**
   Expected: `get_open_issues`, surfacing the Engineer's capacity concern and the Designer's
   accessibility concern as blocking human conflicts. Ask **"What has the Security Expert
   found?"** for `get_expert_advice` -- its findings are separate, advisory, and never listed
   as a blocking human conflict.
4. **"Propose a reduced-scope version that addresses these concerns while keeping the launch
   date."**
   Expected: `respond_to_concern`. For the deterministic scenario to settle automatically,
   the revised proposal should mention: reusing the existing authentication/session model (no
   auth rewrite), a reduced/incremental scope, the two-week campaign/launch date, accessible
   patterns (screen readers, keyboard support), and first-value/completion -- while avoiding
   language like "tracking", "profile", or "auth-linked". A capable agent naturally covers all
   of this from the prompt above; if a first attempt does not fully resolve the blockers, ask
   it to try again, more explicitly reusing the existing auth model and dropping any
   persistent tracking/profiling.
5. **"Ask the team for alignment."**
   Expected: `request_team_alignment`, once the blocking concerns above are resolved. The
   simulated teammates then share deterministic alignment on the revised proposal.
6. **"What needs me now?"**
   Expected: `get_my_attention_items`, surfacing `owner_decision_required` -- the room never
   silently finalizes.
7. **"Review the final decision."**
   Expected: `review_final_decision`, freezing the exact candidate (including the Security
   Expert's advisory disposition) and its hash.
8. **"Finalize it."**
   Expected: `approve_final_decision`, returning `HUMAN_CONFIRMATION_REQUIRED`.
   The Decision workspace opens. **The agent never clicks the confirmation for you** -- you
   review the exact decision and click it yourself.

## What you should visually observe at each step

- Step 2: the phase indicator in the meeting toolbar advances; the over-scoped proposal
  appears in the Proposals/Deliberation workspace.
- Step 3: two blocking issues appear in Deliberation; a "Security Expert · Advisory" section
  appears in the Alignment workspace listing open findings (e.g. behavioral tracking / privacy
  risk, and typically auth-boundary expansion) -- visually distinct from the blocking
  conflicts, never mixed into "Team alignment".
- Step 4: the blocking issues resolve; if the revision also removes the tracking/auth-boundary
  language, the Security Expert's finding(s) move to "Resolved" automatically (a deterministic
  disposition, not a silent one -- it is audited with `origin = expert_service`).
- Step 5: "Team alignment" shows Engineer/Designer/Growth Lead's deterministic support; the
  Security Expert never appears there -- it never aligns, votes, or approves.
- Step 6: the "Needs you" badge in the meeting toolbar lights up.
- Step 7: the Decision workspace shows the exact frozen candidate, including a "Security
  Expert · Advisory" line with each finding's final status and rationale.
- Step 8: a visible confirmation control appears; nothing finalizes until you click it
  yourself. After you do, the immutable decision record appears, and every browser watching
  the room (including a second observer tab) updates via realtime without a refresh.

## Reset demo

Open the Help drawer (the "?" control in the meeting toolbar) and click **Reset demo**. This
calls a dedicated, always-available server route (`POST /api/demo/reset`) that is hard-scoped
to the fixed `"demo"` room id -- it never accepts an arbitrary room id from the browser, and
it cannot affect any other room. It atomically restores the initial seeded scenario: phase,
participants (including the Security Expert), constraints, the over-scoped proposal, and
clears every concern/finding/alignment/approval/decision record from the previous run.
Running the demo again after a reset produces the same deterministic outcome.

## Known limitation: single demo instance

`/room/demo` is one shared, deterministic fixture, not one isolated room per judge session
(see `docs/backend-integration.md`'s Slice 6 section for why, given the hackathon timeline).
If two judges open it at the same time, the second one sees the first judge's live progress
as a read-only spectator until the Founder seat is next reset. This is a disclosed,
deliberate scope decision, not a bug -- production rooms created through the normal Create
Meeting flow do not share this limitation; each is fully isolated.

## Real Chrome WebMCP inspector

Follow `docs/webmcp-demo.md`'s Chrome setup section, then drive the prompt script above
against a real running app and a real Chrome browser with WebMCP testing enabled. At minimum
validate `get_meeting_context`, `advance_discussion`, `get_open_issues`, `respond_to_concern`,
`request_team_alignment`, `get_my_attention_items`, `review_final_decision`, and
`approve_final_decision` this way, with natural-language tool selection (not
manual tool invocation from DevTools). This manual pass has not been automated by any coding
agent and must be performed by a human before Gate 6 is considered fully closed -- see the
Slice 6 completion report's "Chrome Inspector" section for the current status.
