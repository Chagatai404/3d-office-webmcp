# 3D Office WebMCP — Person B Tasks

## Lane B — Product UX, Join Flow, Room Controls, Agent UX, 2D/3D Semantics

**Base repository:** `Chagatai404/3d-office-webmcp`  
**Base branch:** the **Contract Freeze checkpoint commit produced by Person A**  
**Role:** Product UX / frontend / 2D + 3D visualization owner  
**Merge order:** Person A first, **Person B second**  
**Primary goal:** Build the real user journey on top of the stable canonical contract without duplicating backend authority or touching backend-owned hotspots.

> Principle: **Agents negotiate. People decide.**

---

# 0. Before parallel work starts

- [ ] **B-000 — Wait only for Contract Freeze checkpoint, not full backend implementation**
  - Person A provides commit containing stable shared signatures for:
    - `CreateRoomInput`
    - `CreatedRoom`
    - `RoomInvitePreview`
    - `ClaimInvitationInput`
    - participant `isReady`
    - onboarding-client signatures
    - `RoomProvider.actions.markMyInputReady`
    - `RoomProvider.actions.advanceRoomPhase`
  - Branch from that exact SHA.
  - **Done:** B does not need to modify `src/contracts/room.ts`.

- [ ] **B-001 — Verify own branch and baseline**
  ```bash
  git status
  npm run test:unit
  npm run build
  ```

---

# 1. Exclusive file ownership

Person B is the **exclusive owner** of:

```text
src/app/page.tsx
src/app/new/**
src/app/room/[roomId]/setup/**
src/app/room/[roomId]/join/**
src/components/onboarding/**
src/components/shell/**
src/components/plan/**
src/components/room/*-panel.tsx
src/components/room/activity-ledger.tsx
src/visualization/**
src/floorplan/**
tests/components/**
tests/floorplan/**
tests/visualization/**
README.md
docs/status.md
```

Person B must **not edit** during parallel implementation:

```text
src/contracts/room.ts
src/domain/**
src/lib/supabase/**
src/app/api/**
src/clients/api-room-client.ts
src/clients/room-onboarding-client.ts
src/room-client/room-client.ts
src/webmcp/**
supabase/**
tests/domain/**
tests/webmcp/**
tests/playwright/**
playwright.config.ts
package.json
package-lock.json
docs/backend-integration.md
```

### Special hotspot: `src/components/room/room-provider.tsx`

Person B **does not edit this file** during parallel work. Consume:

```ts
const { room, self, actions, visualization } = useRoom();
```

If a missing action/signature is discovered, record it as an integration request to Person A rather than editing the provider independently.

---

# 2. UX implementation rule for parallel coding

Because Person A’s APIs may not be complete while B is coding:

- Build pages/components against the stable onboarding-client and context signatures from Contract Freeze.
- Component tests may mock the onboarding client at the module boundary.
- Do **not** import fixtures directly into production components.
- Do **not** implement temporary direct Supabase writes.
- Do **not** create a second room DTO.
- Do **not** add browser-trusted organizer/participant IDs.

Temporary UI mocks belong only in tests.

---

# 3. Slice B1 — Product Entry + Room Creation UX

- [ ] **B-110 / T-110 — Turn home page into product entry**
  - `src/app/page.tsx`
  - CTAs:
    ```text
    Create decision room
    Open demo
    ```
  - Keep `/room/demo` as fast judge shortcut.
  - **Done:** demo is not the only entry point.

- [ ] **B-111 / T-111 — Add `/new` create-room page**
  - Suggested composition:
    ```text
    src/app/new/page.tsx
    src/components/onboarding/create-room-form.tsx
    ```
  - Fields:
    - decision title;
    - brief;
    - participant name;
    - participant role;
    - required approver checkbox.
  - Default role template:
    - Product Manager;
    - Engineer;
    - Designer;
    - Marketing Lead.
  - Minimum two participants.
  - Client-side validation is UX only; server remains authoritative.
  - Submit only canonical `CreateRoomInput`.
  - **Done:** no organizer/user/participant authority is sent from the form.

- [ ] **B-112 / T-112 — Handle create success navigation**
  - Navigate to:
    ```text
    /room/:roomId/setup
    ```
  - Pass invite results safely through navigation/session state or re-fetch via organizer-safe onboarding API once Person A provides it.
  - Do not place raw tokens in persistent global room state.
  - **Done:** created room immediately leads to invite setup.

## Component tests

- [ ] **B-113 — Create-room form validation test**
- [ ] **B-114 — Create-room success navigation test**
- [ ] **B-115 — Create-room API/client failure feedback test**

### B1 exit gate

- [ ] User can understand and complete “Create Decision Room” without touching demo controls.

---

# 4. Slice B2 — Organizer Setup + Invitation UX

- [ ] **B-213 / T-213 — Add `/room/[roomId]/setup` organizer screen**
  - Show each participant seat:
    ```text
    Name
    Role
    Required approver
    Invite link copy action
    Join/readiness status when available
    ```
  - Keep tokens out of logs/debug DOM where avoidable.

- [ ] **B-214 / T-214 — Use canonical invite URL format**
  ```text
  /room/:roomId/join?invite=RAW_TOKEN
  ```
  - UI must not interpret token as participant authority itself.

- [ ] **B-215 / T-215 — Add `/room/[roomId]/join` page**
  - Flow:
    1. Ensure browser auth/session through onboarding client flow.
    2. Preview invite capability.
    3. Render room title/brief + intended role.
    4. Explicit `Join as <role>` button.
    5. Claim invitation.
    6. Redirect to `/room/:roomId`.
  - **Done:** user consciously claims intended role.

- [ ] **B-216 / T-216 — Do not mount normal `RoomProvider` before claim**
  - Join page is pre-membership surface.
  - No participant WebMCP mutation tool set may be registered there.
  - **Done:** join preview is independent of full room runtime.

## UX states

- [ ] Loading invite preview.
- [ ] Invalid invite.
- [ ] Expired invite.
- [ ] Revoked invite.
- [ ] Already claimed invite.
- [ ] Claim in progress.
- [ ] Claim race lost.
- [ ] Successful join.

## Component tests

- [ ] **B-217 — Valid preview renders intended role**
- [ ] **B-218 — Invalid/expired/revoked states**
- [ ] **B-219 — Join button calls claim once**
- [ ] **B-220 — Successful claim redirects into room runtime**
- [ ] **B-221 — Join page never mounts room runtime before membership**

### B2 exit gate

- [ ] Organizer can copy distinct role links.
- [ ] Invitee sees only safe pre-membership information.
- [ ] Full room opens only after claim succeeds.

---

# 5. Slice B3 — Waiting Room + Readiness + Organizer Controls

- [ ] **B-312 / T-312 — Add “My input is ready” UX**
  - Existing participant/positions surface.
  - Disabled until participant has at least one position.
  - After success show:
    ```text
    ✓ Ready for deliberation
    ```
  - Readiness comes from canonical snapshot, not local optimistic truth.

- [ ] **B-313 / T-313 — Organizer waiting/setup panel**
  - For every participant show:
    ```text
    Invited
    Joined
    Position published
    Ready
    ```
  - Realtime changes should naturally update through RoomProvider.

- [ ] **B-314 / T-314 — Organizer phase controls**
  - Buttons:
    ```text
    Start proposals
    Start deliberation
    Start voting
    ```
  - Call `actions.advanceRoomPhase(...)` only.
  - Never call `/api/dev/...` from product UI.
  - Display disabled/recovery reasons clearly.
  - Backend errors remain authoritative even if UI thinks action is allowed.

## Component tests

- [ ] **B-315 — Ready button disabled before position**
- [ ] **B-316 — Ready state follows canonical snapshot**
- [ ] **B-317 — Organizer controls call production action**
- [ ] **B-318 — Non-organizer does not see organizer CTA**
- [ ] **B-319 — Server rejection renders useful feedback**

### B3 exit gate

- [ ] Product UI has no dependency on demo phase controls for real rooms.

---

# 6. Slice B4 — WebMCP Product Onboarding + Agent UX

Person B does **not** change tool definitions or authority logic. This lane only explains and visualizes the existing WebMCP capability.

- [ ] **B-405 / T-405 — `document.modelContext` feature detection UI**
  - Supported:
    ```text
    Browser agent tools available for this phase
    ```
  - Unsupported:
    ```text
    WebMCP is unavailable in this browser. You can still participate manually.
    ```
  - Manual participation must never be blocked.

- [ ] **B-406 / T-406 — Agent prompt guidance in participant input surface**
  - Example:
    > Read this meeting and help me express my engineering constraints.
  - Explain that the agent acts only for this participant/session.

- [ ] **B-407 / T-407 — Last WebMCP action projection**
  - Derive from canonical `room.activity` where `origin === "webmcp"`.
  - Resolve latest event per participant.
  - Do not invent persistent “agent online” state.

- [ ] **B-408 / T-408 — Visible provenance in activity UI**
  - Example:
    ```text
    Engineering · via browser agent · added position
    ```
  - Manual / WebMCP / simulation / system must be distinguishable without color alone.

- [ ] **B-413 / T-413 — Manual fallback component test without `document.modelContext`**

### B4 exit gate

- [ ] Judge/user can understand how to use their own browser agent without needing an “agent account” setup flow.
- [ ] UI never claims an agent is continuously online unless actual evidence exists.

---

# 7. Slice B5 — Participant-facing Decision UX Completeness

The backend already has proposal, objection, tradeoff, voting, approval and final record primitives. Make sure the real UX exposes enough of them for a complete non-demo journey.

- [ ] **B-500 — Proposal panel/action is usable in proposals phase**
  - Use `actions.submitProposal`.
  - Show active proposal on central table/plan.

- [ ] **B-501 — Conflict/objection panel is usable in deliberation**
  - Use `actions.raiseObjection`.
  - Show open/blocking status.

- [ ] **B-502 — Tradeoff/revision UX**
  - Use `actions.proposeTradeoff`.
  - Show revised proposal lineage where useful.

- [ ] **B-503 — Explicit objection-resolution UX**
  - Use `actions.resolveObjection`.
  - Do not imply tradeoff automatically resolves issue.

- [ ] **B-504 — Voting panel**
  - Current participant only.
  - Support / oppose / abstain / request changes.
  - Make clear vote is not final approval.

- [ ] **B-505 — Exact final preview + human approval UI**
  - Render exact server candidate.
  - Show decision hash.
  - Explicit confirmation checkbox bound to exact current hash.
  - Enable approval only after explicit review/confirmation.
  - If candidate/hash changes, reset confirmation.

- [ ] **B-506 — Final decision record UI**
  - Persisted immutable record, not reconstructed local state.
  - Proposal, rationale, accepted tradeoffs, dissent, votes, approvals, provenance.

### B5 exit gate

- [ ] A human can complete every participant-visible action in the real DesktopShell without old `RoomClientView` harness.

---

# 8. Slice B6 — 2D / 3D Semantic Product State

Only visualize canonical projections. No domain mutations inside 3D.

- [ ] **B-730 / T-730 — Joined participant office state**
  - Unclaimed = empty/waiting.
  - Claimed = occupied.

- [ ] **B-731 / T-731 — Ready marker**
  - Derived from canonical `isReady`.

- [ ] **B-732 / T-732 — WebMCP activity pulse/trail**
  - Derive from audit/activity events.
  - No fake persistent agent avatar/presence.

- [ ] **B-733 / T-733 — Active proposal on central table**
- [ ] **B-734 / T-734 — Conflict constraint→proposal semantic linkage**
  - Accessible indicators; not color-only.
- [ ] **B-735 / T-735 — Voting state markers**
- [ ] **B-736 / T-736 — Human approval pending/approved markers**
- [ ] **B-737 / T-737 — Finalized artifact lock state**

### B6 exit gate

- [ ] 2D and 3D respond to the same canonical state and remain presentation-only.

---

# 9. Slice B7 — Demo / Submission Hardening

- [ ] **B-600 / T-600 — Keep `/room/demo` as fast judge shortcut**
- [ ] **B-601 / T-601 — Clearly separate product create flow from demo flow**
  - Home has both `Create decision room` and `Open demo`.
- [ ] **B-603 / T-603 — Update README product journey**
  - Create → invite → join → browser agent → deliberate → vote → human approval.
- [ ] **B-605 / T-605 — Update `docs/status.md`**
  - Remove stale “Mock→API is remaining” statements.
  - Describe actual merged state.

---

# 10. P1 UX polish owned by Person B

Only after P0 is green.

## Invitation controls

- [ ] **B-702 / T-702 — Setup-page regenerate/revoke controls**
  - Calls Person A’s organizer invite-management APIs.
  - Confirmation UX.
  - Copy replacement link.

## Waiting room polish

- [ ] **B-710 / T-710 — Standardize seat-state vocabulary**
  ```text
  Invited
  Joined
  Input published
  Ready
  ```

- [ ] **B-711 / T-711 — Explain blocked organizer prerequisites**
  - Example: `Designer has not marked input ready.`

- [ ] **B-712 / T-712 — Participant self-status summary**
  - Role.
  - Join state.
  - Position state.
  - Readiness.

## Agent UX polish

- [ ] **B-720 / T-720 — Per-participant last WebMCP action timestamp**
- [ ] **B-721 / T-721 — Current-phase available-tool summary**
- [ ] **B-722 / T-722 — Better unsupported-browser fallback copy**
- [ ] **B-723 / T-723 — Async return prompt guidance**
  - Example:
    > What changed since my last participation and what issues affect my constraints?

---

# 11. P2 UX tasks after hackathon

Do not start before P0/P1 are stable.

- [ ] **B-804 / T-804 — Human-visible unattended delegation controls**
  - Allowed operations.
  - Hard constraints.
  - Expiry.
  - Stop/revoke.
  - Must never offer final approval delegation.

- [ ] **B-820 / T-820 — Email invitation UX**
- [ ] **B-821 / T-821 — Slack invitation UX**
- [ ] **B-822 / T-822 — Persistent user profile UX**
- [ ] **B-823 / T-823 — Team/workspace UX**
- [ ] **B-824 / T-824 — Multi-organizer UX**

---

# 12. Architecture checklist — Person B responsibilities

- [ ] UI imports canonical contract types only.
- [ ] No production component imports `demoRoom` fixture.
- [ ] No production component imports Supabase table types.
- [ ] No direct Supabase mutation from UI.
- [ ] No direct `/api/dev/...` call for real rooms.
- [ ] Pre-membership join page does not mount RoomProvider.
- [ ] Normal room pages rely on RoomProvider as the single room snapshot owner.
- [ ] 3D receives only `RoomVisualizationState`.
- [ ] Invite token is never copied into canonical room state.
- [ ] Participant/organizer authority is never inferred from URL/query params.
- [ ] Visible final approval always requires explicit human confirmation.

---

# 13. Component / presentation tests — Person B

Run continuously:

```bash
npm run typecheck
npm run test:unit
```

Add/maintain tests for:

- [ ] Home product entry.
- [ ] Create room form.
- [ ] Create failure feedback.
- [ ] Setup invite list/copy behavior.
- [ ] Join preview states.
- [ ] Successful join redirect.
- [ ] No RoomProvider on join page.
- [ ] Waiting-room status rendering.
- [ ] Ready button semantics.
- [ ] Organizer production phase controls.
- [ ] WebMCP feature detection.
- [ ] Activity provenance.
- [ ] Proposal/conflict/tradeoff panels.
- [ ] Voting UI.
- [ ] Approval hash confirmation invalidation.
- [ ] Final decision record.
- [ ] 2D/3D joined/ready/proposal/conflict/vote/approval/finalized projections.

Before handoff:

```bash
npm run lint
npm run typecheck
npm run test:unit
npm run build
git diff --check
git status
```

Person B does not own the Supabase/domain/E2E test files, but after merging A locally should also run the final full suite.

---

# 14. Person B merge handoff

Before final merge:

- [ ] Rebase/merge latest Person A branch into B **only after A is green**.
- [ ] Resolve expected integration points through existing public signatures, not by duplicating logic.
- [ ] Verify no B changes touched A-exclusive hotspots.
- [ ] Run component/unit/build suite after A merge.
- [ ] Hand final branch to integration owner for full E2E.

### Recommended B commit sequence

```text
feat: add create-room product entry
feat: add organizer invite and participant join UX
feat: add waiting room and readiness controls
feat: surface browser-agent availability and provenance
feat: complete participant decision workflow UI
feat: visualize product lifecycle state in 2d and 3d
docs: update product journey and frontend status
```

---

# 15. Expected final integration sequence

Do not merge both branches into the integration branch in arbitrary order.

1. Contract Freeze checkpoint is common ancestor.
2. Person A completes and verifies core branch.
3. Merge **Person A → integration/product-flow**.
4. Update Person B branch with the merged A branch.
5. Fix only interface/integration mismatches on B branch.
6. Run B unit/component/build tests.
7. Merge **Person B → integration/product-flow**.
8. Run full final suite:
   ```bash
   npm run check
   npm run test:unit
   npm run test:domain
   npm run test:e2e
   npm run build
   ```
9. Manual non-demo create → invite → join → WebMCP → vote → approval smoke test.
10. Verify `/room/demo` still works.

---

# 16. Person B Definition of Done

- [ ] User can create a non-demo decision room from home.
- [ ] Organizer receives clear role-specific invitation UX.
- [ ] Invitee can preview and explicitly join intended role.
- [ ] Join page does not expose full room before claim.
- [ ] Normal room runtime starts only after membership.
- [ ] Participant can publish position and mark ready.
- [ ] Organizer can see realtime joined/ready status.
- [ ] Organizer can use production phase controls.
- [ ] Browser-agent availability is understandable in the UI.
- [ ] WebMCP provenance is visible without pretending persistent presence.
- [ ] Proposal/objection/tradeoff/vote/approval/final-record UX is complete.
- [ ] Human approval is visibly hash-bound and explicit.
- [ ] 2D/3D represent joined, ready, proposal, conflict, voting, approval and finalized state.
- [ ] Demo remains a separate fast judge path.
- [ ] Unit/component/build tests pass before merge.
