# Hackathon submission checklist

Final-pass control sheet for the OpenAI WebMCP Challenge submission of **Quorum: Agent-Native
Decision Rooms** (repository slug: `quorum-webmcp`; live URL: `quorummeet.vercel.app`). Canonical product/architecture
background lives in [`../3d-office-webmcp-shared-context.md`](../3d-office-webmcp-shared-context.md)
(historical — see its notice) and [`backend-integration.md`](backend-integration.md) (current).
Devpost copy is in [`devpost-submission.md`](devpost-submission.md).

## 1. Submission requirements

- [x] Working live URL — [quorummeet.vercel.app](https://quorummeet.vercel.app/)
- [x] Public GitHub repository
- [x] License visibly detected by GitHub's **About** sidebar (manual check — see
      "Requires external verification" below; the `LICENSE` file itself is present and correct)
- [x] README rewritten for judges (this pass)
- [x] WebMCP implementation clearly discoverable (README "WebMCP implementation" section, plus
      [`src/webmcp/register-tools.ts`](../src/webmcp/register-tools.ts) and
      [`src/webmcp/capability-context.ts`](../src/webmcp/capability-context.ts) linked directly)
- [x] Devpost text drafted ([`devpost-submission.md`](devpost-submission.md))
- [ ] Public YouTube demo video recorded and uploaded
- [ ] Video under 3 minutes
- [ ] Video contains audio (narration)
- [ ] Video clearly demonstrates real WebMCP tool use (not a scripted UI walkthrough)
- [ ] Deployment confirmed to remain available through the judging window
- [ ] `/room/demo` reset to a clean state immediately before recording/submission
- [ ] Final `npm run check` / `npm run build` pass confirmed on the submitted commit
- [ ] Screenshots/gallery captured (captions drafted in `devpost-submission.md`; images not
      yet captured)
- [x] Third-party 3D asset attribution present — [`../CREDITS.md`](../CREDITS.md) and the
      in-app Help drawer credit Quaternius's Ultimate Modular Women/Men Packs and dook's The
      Office Pack (all CC-BY, via Poly Pizza)

## 2. Judging criteria — evidence mapping

**WebMCP Leverage.** Tool availability is not a fixed menu: [`capability-context.ts`](../src/webmcp/capability-context.ts)
derives the exact registered tool set from route, seat-claim status, meeting role, decision
role, phase, decision policy, lock state, frozen-candidate state, and required-approver status,
and [`register-tools.ts`](../src/webmcp/register-tools.ts) tears down and re-registers that set
live, through an `AbortController`, every time any of those inputs changes — no reload. Roughly
40 tools span onboarding, orientation, deliberation, alignment, decision approval, owner
administration, and an advisory expert, all built on the imperative
`document.modelContext.registerTool` API. This is materially different from exposing one novelty
function: the catalog itself encodes the room's rules.

**Execution.** The app is deployed and reachable, the deterministic `/room/demo` route lets any
judge exercise the entire lifecycle solo, and creating/joining real rooms (`create_meeting` /
`join_meeting`, a real invite link and passcode, owner admission) is fully functional production
behavior a judge can try directly, not a demo-only affordance. The same domain operations back
manual UI clicks, WebMCP tool calls, and the Security Expert's actions — there is no separate,
weaker "WebMCP-only" code path. Authority is derived server-side from the authenticated session on every mutation, not
from tool arguments. `tests/webmcp/` covers the tool catalog, participant-authority boundaries,
prompt-injection resistance, and tool-selection evals; Playwright covers live registration and
stale-tool-reference rejection across multiple simulated browsers.

**Potential Impact.** The problem — several accountable humans, each with different authority and
constraints, trying to reach one decision with AI help — is not solved by a single-user assistant.
Today's AI tools mostly optimize for one person talking to one model. This project is a concrete
exploration of the alternative: each person keeps their own browser agent and their own identity,
and a specific human is still the one who must click approve. The AI-assisted-onboarding-release
scenario is one instance of a broad class (pricing, procurement, launch, cross-functional
trade-offs) where this pattern applies.

**Creativity & Ambition.** The product commits to a real authority model instead of the easier
universal-voting shortcut: `Alignment` is explicitly informative and never mechanically decisive,
`DecisionPolicy` names who actually decides, and final approval is bound to an exact frozen
decision hash so a stale approval can never finalize a changed candidate. The 3D room is not
decoration bolted onto a form — it's a spatial projection of the same canonical `RoomState`
everything else reads, used to make shared multi-agent activity legible rather than to look
impressive.

## 3. Demo recording checklist

Follow the canonical script in [`judge-demo.md`](judge-demo.md) exactly — it is written to be
followed by a judge with zero repository context, and the video should demonstrate the same
sequence. Comfortably fits under three minutes if narration stays tight.

The recording must visibly establish, in order:

- [ ] the concrete problem this solves (a few seconds of framing before touching the app)
- [ ] a browser agent discovering and calling **real** WebMCP tools (not narrated-over UI clicks)
      — e.g. `get_meeting_context` on arrival
- [ ] structured room state visibly changing on screen as a result of a tool call
- [ ] a meaningful concern/conflict surfacing (the seeded blocking concerns in Deliberation)
- [ ] a revision/trade-off that resolves it (`respond_to_concern`)
- [ ] team alignment being requested and shared (`request_team_alignment`, deterministic
      teammate alignment appearing)
- [ ] the Security Expert's advisory distinction (its findings visually separate from human
      blocking concerns, never presented as a vote)
- [ ] human decision authority in action (`review_final_decision` freezing the exact candidate)
- [ ] `HUMAN_CONFIRMATION_REQUIRED` returned from `approve_final_decision` — the agent does not
      finalize
- [ ] a visible human click confirming the decision in the UI
- [ ] the immutable final record appearing (`get_decision_record` / the finalized report)

## 4. Last-hour submission checklist

- [ ] Reset `/room/demo` (Help drawer → **Reset demo**, or `POST /api/demo/reset`)
- [ ] Load the live URL in a fresh/incognito session and confirm it renders correctly
- [ ] Confirm WebMCP tool calls work end-to-end in a supported browser (ChatGPT in-app browser
      or Chrome 149+ with WebMCP enabled)
- [ ] Confirm the GitHub repository is public
- [ ] Confirm GitHub's **About** sidebar visibly shows the detected AGPL-3.0 license
- [ ] Confirm the YouTube video is **public** (not unlisted/private), per official rules
- [ ] Confirm the video has audio
- [ ] Confirm the video is under the official duration limit
- [ ] Confirm every link in `devpost-submission.md` resolves (live app, judge route, repo, video)
- [ ] Confirm no copyrighted music or unauthorized third-party material is in the video
- [ ] Run `npm run check` and `npm run build` on the exact commit being submitted
- [ ] Do not make further changes after the official submission deadline once it closes, per the
      official Devpost rules for this challenge

> The official deadline is not restated here because it was not independently verified against
> the live Devpost rules page during this documentation pass — confirm it directly on Devpost
> before treating any date as authoritative.
