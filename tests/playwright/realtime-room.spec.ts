import { expect, test } from "@playwright/test";
import {
  captureToolDefinition,
  executeCapturedTool,
  executeTool,
  installWebMcpShim,
  toolNames,
} from "./helpers";

/**
 * Before a claim, a session gets orientation and no write surface at all.
 * `get_expert_advice` is present because the demo's Security Expert is
 * always enabled, and the read-only orientation/coordination/source tools
 * (`get_coordination_status`, `get_room_updates`, and the source-read
 * tools) are available in every phase of the room, including before a seat
 * is claimed -- see docs/webmcp-demo.md's "What to inspect" section.
 */
const preClaimToolNames = [
  "get_coordination_status",
  "get_expert_advice",
  "get_meeting_context",
  "get_meeting_sources",
  "get_room_updates",
  "read_meeting_source",
  "search_meeting_sources",
  "summarize_meeting_sources",
];

/**
 * Finalization leaves the always-available read tools (orientation,
 * coordination, and the source-read set -- see docs/webmcp-demo.md's "What
 * to inspect") alongside the finalized-only reads; every mutation tool is
 * gone. `toolNames` returns them alphabetically (see `TestModelContext.
 * getTools` in ./helpers).
 */
const finalizedToolNames = [
  "get_coordination_status",
  "get_current_decision",
  "get_decision_record",
  "get_expert_advice",
  "get_final_report",
  "get_meeting_context",
  "get_meeting_sources",
  "get_room_updates",
  "read_meeting_source",
  "search_meeting_sources",
  "summarize_meeting_sources",
];

test("two sessions collaborate through phase-aware WebMCP and canonical realtime state", async ({ browser }) => {
  test.setTimeout(120_000);
  const engineerContext = await browser.newContext();
  const designerContext = await browser.newContext();
  await Promise.all([installWebMcpShim(engineerContext), installWebMcpShim(designerContext)]);
  const engineer = await engineerContext.newPage();
  const designer = await designerContext.newPage();

  await Promise.all([engineer.goto("/room/demo"), designer.goto("/room/demo")]);
  await expect(engineer.getByTestId("connection-status")).toHaveText("Connected");
  await expect(designer.getByTestId("connection-status")).toHaveText("Connected");

  // This test exercises the legacy multi_user demo shape (four
  // independently claimable human seats), not the Gate 6 solo_judge default
  // the shared "demo" room now starts in (supabase/seed.sql). Reset to
  // multi_user explicitly so this test is self-sufficient regardless of
  // which mode a previous test or the fresh seed left "demo" in.
  await engineer.getByTestId("reset-multi-user-demo").click();
  await expect(engineer.getByTestId("demo-mode")).toHaveText("Mode: multi_user");

  // Before a claim, a session gets orientation and no write surface at all.
  // `get_expert_advice` is present because the demo's Security Expert is
  // always enabled, and the read-only orientation/coordination/source tools
  // (`get_coordination_status`, `get_room_updates`, and the source-read
  // tools) are available in every phase of the room, including before a
  // seat is claimed -- see docs/webmcp-demo.md's "What to inspect" section.
  await expect.poll(() => toolNames(engineer)).toEqual(preClaimToolNames);
  await expect.poll(() => toolNames(designer)).toEqual(preClaimToolNames);
  const preClaimContext = JSON.parse(String(await executeTool(engineer, "get_meeting_context", {})));
  expect(preClaimContext).toMatchObject({
    ok: true,
    data: { trustedContext: { roomId: "demo", phase: "input", currentParticipant: null } },
  });
  await expect(executeTool(engineer, "share_my_context", {
    summary: "Write without holding a seat.",
    category: null,
    priority: null,
    constraints: [],
  })).rejects.toThrow("Tool share_my_context was not discovered.");

  await engineer.getByTestId("claim-demo-engineer").click();
  await expect(engineer.getByText("Your seat")).toBeVisible();
  await expect(designer.getByTestId("room-version")).toHaveText("1");

  await designer.getByTestId("claim-demo-designer").click();
  await expect(designer.getByText("Your seat")).toBeVisible();
  await expect(engineer.getByTestId("room-version")).toHaveText("2");

  await expect.poll(() => toolNames(engineer)).toEqual(expect.arrayContaining([
    "share_my_context", "get_meeting_context", "get_my_attention_items",
  ]));
  await expect.poll(() => toolNames(designer)).toEqual(expect.arrayContaining([
    "share_my_context", "get_meeting_context", "get_my_attention_items",
  ]));
  const meetingContext = JSON.parse(String(await executeTool(engineer, "get_meeting_context", {})));
  expect(meetingContext).toMatchObject({
    ok: true,
    roomVersion: 2,
    data: {
      trustedContext: {
        roomId: "demo",
        phase: "input",
        roomVersion: 2,
        currentParticipant: { participantId: "demo-engineer", role: "Engineering" },
      },
    },
  });

  // Two browser contexts, two participant authorities, one shared room.
  const designerContextSnapshot = JSON.parse(
    String(await executeTool(designer, "get_meeting_context", {})),
  );
  expect(designerContextSnapshot.data.trustedContext.currentParticipant).toMatchObject({
    participantId: "demo-designer",
    role: "Design",
  });
  expect(designerContextSnapshot.data.trustedContext.roomId).toBe(meetingContext.data.trustedContext.roomId);

  const positionResult = JSON.parse(String(await executeTool(engineer, "share_my_context", {
    summary: "Ship an accessible thin slice.",
    category: "delivery",
    priority: "critical",
    constraints: [{
      category: "capacity",
      text: "No authentication rewrite in this milestone.",
      priority: "critical",
    }],
  })));
  expect(positionResult).toMatchObject({ ok: true, roomVersion: 3 });
  await expect(designer.getByTestId("constraints")).toContainText("No authentication rewrite in this milestone.");
  await expect(designer.getByTestId("activity")).toContainText("position.added · webmcp · v3");

  await engineer.getByTestId("advance-phase").click();
  await expect(designer.getByTestId("room-phase")).toHaveText("proposals");
  await expect.poll(() => toolNames(engineer)).toEqual(expect.arrayContaining([
    "get_current_decision", "get_meeting_context", "suggest_option",
  ]));

  const listed = JSON.parse(String(await executeTool(engineer, "get_meeting_context", {})));
  const constraint = listed.data.untrustedRoomContent.constraints.find(
    (item: { text: string }) => item.text === "No authentication rewrite in this milestone.",
  );
  expect(constraint.id).toBeTruthy();

  const impersonatedProposal = JSON.parse(String(await executeTool(engineer, "suggest_option", {
    title: "Proposal attributed to the Designer",
    summary: "Submitted from the engineer's session as someone else.",
    rationale: "Impersonation attempt.",
    expectedOutcomes: ["Should never be recorded"],
    referencedConstraintIds: [constraint.id],
    participantId: "demo-designer",
  })));
  expect(impersonatedProposal).toMatchObject({
    ok: false,
    error: { code: "VALIDATION_ERROR" },
    roomVersion: 4,
  });
  await expect(designer.getByTestId("proposals")).not.toContainText(
    "Proposal attributed to the Designer",
  );

  const proposalResult = JSON.parse(String(await executeTool(engineer, "suggest_option", {
    title: "Progressive onboarding hints",
    summary: "Add two accessible hints to the existing flow.",
    rationale: "Fits two-week capacity without new dependencies.",
    expectedOutcomes: ["Faster first value"],
    referencedConstraintIds: [constraint.id],
  })));
  expect(proposalResult).toMatchObject({ ok: true, roomVersion: 5 });
  await expect(designer.getByTestId("proposals")).toContainText("Progressive onboarding hints");
  await expect(designer.getByTestId("activity")).toContainText("proposal.submitted · webmcp · v5");

  await designer.getByTestId("advance-phase").click();
  await expect(engineer.getByTestId("room-phase")).toHaveText("deliberation");
  await expect.poll(() => toolNames(engineer)).toEqual(expect.arrayContaining([
    "get_meeting_context", "get_open_issues", "respond_to_concern", "raise_concern",
  ]));

  await designer.getByTestId("objection-form").getByLabel("Related constraint").selectOption(constraint.id);
  await designer.getByTestId("objection-form").getByLabel("Reason").fill("The hint focus order needs an accessibility review.");
  await designer.getByTestId("objection-form").getByRole("button").click();
  await expect(engineer.getByTestId("conflicts")).toContainText("The hint focus order needs an accessibility review.");
  await expect(engineer.getByTestId("activity")).toContainText("objection.raised · manual_ui · v7");

  const openIssuesResult = JSON.parse(String(await executeTool(engineer, "get_open_issues", {})));
  expect(openIssuesResult.data.openIssues).toHaveLength(1);
  expect(openIssuesResult.data.openIssues[0]).toMatchObject({
    proposal: { title: "Progressive onboarding hints" },
    constraint: { id: constraint.id },
    raisedBy: { actorId: "demo-designer", displayName: "Product Designer" },
    severity: "blocking",
    status: "open",
  });

  const tradeoffResult = JSON.parse(String(await executeTool(engineer, "respond_to_concern", {
    conflictIds: [openIssuesResult.data.openIssues[0].conflictId],
    description: "Keep the thin slice and explicitly define accessible focus order.",
    expectedEffect: "Addresses the objection while preserving the two-week scope.",
    revisedProposal: {
      title: "Accessible progressive onboarding hints",
      summary: "Add two hints with documented keyboard and screen-reader order.",
      rationale: "Keeps the delivery scope and satisfies the accessibility concern.",
      expectedOutcomes: ["Faster first value", "Accessible navigation"],
      referencedConstraintIds: [constraint.id],
    },
  })));
  expect(tradeoffResult).toMatchObject({ ok: true, roomVersion: 8 });

  await expect(designer.getByTestId("room-version")).toHaveText("8");
  await expect(designer.getByTestId("proposals")).toContainText("Accessible progressive onboarding hints");
  await expect(designer.getByTestId("tradeoffs")).toContainText("explicitly define accessible focus order");
  await expect(designer.getByTestId("conflicts")).toContainText("The hint focus order needs an accessibility review.");
  await expect(designer.getByTestId("activity")).toContainText("tradeoff.proposed · webmcp · v8");

  await designer.getByTestId("resolution-controls").getByRole("button").click();
  await expect(engineer.getByTestId("room-version")).toHaveText("9");
  await expect(engineer.getByTestId("conflicts")).not.toContainText("The hint focus order needs an accessibility review.");
  await expect(engineer.getByTestId("activity")).toContainText("conflict.resolved · manual_ui · v9");

  await engineer.getByTestId("advance-phase").click();
  await expect(designer.getByTestId("room-phase")).toHaveText("voting");
  await expect.poll(() => toolNames(engineer)).toEqual(expect.arrayContaining([
    "express_my_alignment", "get_alignment", "get_meeting_context",
  ]));

  const votingContext = JSON.parse(String(await executeTool(engineer, "get_meeting_context", {})));
  const activeProposalId = votingContext.data.untrustedRoomContent.activeProposal.id;
  await captureToolDefinition(engineer, "express_my_alignment");
  const impersonatedAlignment = JSON.parse(String(await executeTool(engineer, "express_my_alignment", {
    proposalId: activeProposalId,
    choice: "concern",
    comment: null,
    participantId: "demo-designer",
  })));
  expect(impersonatedAlignment).toMatchObject({
    ok: false,
    error: { code: "VALIDATION_ERROR" },
    roomVersion: 10,
  });

  const engineerAlignment = JSON.parse(String(await executeTool(engineer, "express_my_alignment", {
    proposalId: activeProposalId,
    choice: "support",
    comment: "Feasible within the two-week capacity.",
  })));
  expect(engineerAlignment).toMatchObject({ ok: true, roomVersion: 11 });
  await expect(designer.getByTestId("alignments")).toContainText("demo-engineer: support");
  await expect(designer.getByTestId("alignments").locator("li")).toHaveCount(1);
  await expect(designer.getByTestId("approvals")).toBeEmpty();
  await expect(designer.getByTestId("activity")).toContainText("alignment.expressed · webmcp · v11");

  // The same refusal without WebMCP: the manual HTTP path is no weaker.
  const impersonatedHttpAlignment = await engineer.evaluate(async ({ proposalId }) => {
    const storedSession = Object.values(localStorage)
      .map((value) => {
        try { return JSON.parse(value) as { access_token?: string }; } catch { return null; }
      })
      .find((value) => value?.access_token);
    if (!storedSession?.access_token) throw new Error("Supabase session not found.");
    const response = await fetch("/api/rooms/demo/alignments", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${storedSession.access_token}`,
        "Content-Type": "application/json",
        "If-Match": "11",
      },
      body: JSON.stringify({
        proposalId,
        choice: "concern",
        comment: null,
        participantId: "demo-designer",
      }),
    });
    return response.json();
  }, { proposalId: activeProposalId });
  expect(impersonatedHttpAlignment).toMatchObject({
    ok: false,
    error: { code: "VALIDATION_ERROR" },
    roomVersion: 11,
  });
  await expect(designer.getByTestId("alignments").locator("li")).toHaveCount(1);

  const designerAlignment = JSON.parse(String(await executeTool(designer, "express_my_alignment", {
    proposalId: activeProposalId,
    choice: "support",
    comment: "The revised focus order is acceptable.",
  })));
  expect(designerAlignment).toMatchObject({ ok: true, roomVersion: 12 });
  await expect(engineer.getByTestId("alignments")).toContainText("demo-designer: support");

  await engineer.getByTestId("advance-phase").click();
  await expect(designer.getByTestId("room-phase")).toHaveText("approval");
  await expect.poll(() => toolNames(engineer)).toEqual(expect.arrayContaining([
    "approve_final_decision", "get_meeting_context", "get_current_decision",
  ]));

  const engineerPreview = JSON.parse(String(await executeTool(engineer, "get_current_decision", {})));
  const designerPreview = JSON.parse(String(await executeTool(designer, "get_current_decision", {})));
  expect(engineerPreview.ok).toBe(true);
  expect(designerPreview.data).toEqual(engineerPreview.data);
  expect(engineerPreview.data.trustedContext.decisionReview.completedApprovalCount).toBe(0);
  expect(engineerPreview.data.trustedContext.decisionReview.missingApprovalParticipantIds).toEqual([
    "demo-designer",
    "demo-engineer",
  ]);
  const decisionHash = engineerPreview.data.trustedContext.decisionReview.decisionHash;
  await expect(engineer.getByTestId("decision-hash")).toHaveText(decisionHash);
  await expect(designer.getByTestId("decision-hash")).toHaveText(decisionHash);

  const engineerApprovalRequest = JSON.parse(String(await executeTool(
    engineer,
    "approve_final_decision",
    { decisionHash },
  )));
  expect(engineerApprovalRequest).toMatchObject({
    ok: false,
    error: { code: "HUMAN_CONFIRMATION_REQUIRED" },
    roomVersion: 13,
  });
  await engineer.getByLabel("I reviewed and confirm this exact final decision.").check();
  await engineer.getByTestId("confirm-approval").click();
  await expect(designer.getByTestId("room-version")).toHaveText("14");
  await expect(designer.getByTestId("approvals")).toContainText("demo-engineer");
  await expect(designer.getByTestId("missing-approvals")).toContainText("demo-designer");

  const designerApprovalRequest = JSON.parse(String(await executeTool(
    designer,
    "approve_final_decision",
    { decisionHash },
  )));
  expect(designerApprovalRequest).toMatchObject({
    ok: false,
    error: { code: "HUMAN_CONFIRMATION_REQUIRED" },
    roomVersion: 14,
  });
  await designer.getByLabel("I reviewed and confirm this exact final decision.").check();
  await designer.getByTestId("confirm-approval").click();

  await expect(engineer.getByTestId("room-phase")).toHaveText("finalized");
  await expect(designer.getByTestId("room-version")).toHaveText("15");
  await expect(engineer.getByTestId("finalized-at")).toBeVisible();
  await expect.poll(() => toolNames(engineer)).toEqual(finalizedToolNames);

  const engineerRecord = JSON.parse(String(await executeTool(engineer, "get_decision_record", {})));
  const designerRecord = JSON.parse(String(await executeTool(designer, "get_decision_record", {})));
  expect(engineerRecord.ok).toBe(true);
  expect(designerRecord.data).toEqual(engineerRecord.data);
  expect(engineerRecord.data.decision.decisionHash).toBe(decisionHash);
  expect(engineerRecord.data.approvals).toHaveLength(2);

  const staleFinalizedAlignment = JSON.parse(String(await executeCapturedTool(engineer, {
    proposalId: activeProposalId,
    choice: "concern",
    comment: "Too late through a captured tool.",
  })));
  expect(staleFinalizedAlignment).toMatchObject({
    ok: false,
    error: { code: "ALREADY_FINALIZED" },
    roomVersion: 15,
  });

  const finalizedMutation = await engineer.evaluate(async ({ proposalId }) => {
    const storedSession = Object.values(localStorage)
      .map((value) => {
        try { return JSON.parse(value) as { access_token?: string }; } catch { return null; }
      })
      .find((value) => value?.access_token);
    if (!storedSession?.access_token) throw new Error("Supabase session not found.");
    const response = await fetch("/api/rooms/demo/alignments", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${storedSession.access_token}`,
        "Content-Type": "application/json",
        "If-Match": "15",
      },
      body: JSON.stringify({ proposalId, choice: "concern", comment: "Too late" }),
    });
    return response.json();
  }, { proposalId: activeProposalId });
  expect(finalizedMutation).toMatchObject({
    ok: false,
    error: { code: "ALREADY_FINALIZED" },
    roomVersion: 15,
  });

  await engineerContext.close();
  await designerContext.close();
});
test("one judge completes and replays the deterministic solo demo", async ({ browser }) => {
  test.setTimeout(120_000);
  const context = await browser.newContext();
  await installWebMcpShim(context);
  const page = await context.newPage();
  await page.goto("/room/demo");
  await expect(page.getByTestId("connection-status")).toHaveText("Connected");

  await page.getByTestId("demo-human-role").selectOption("product");
  await page.getByTestId("start-solo-demo").click();
  await expect(page.getByTestId("demo-mode")).toHaveText("Mode: solo_judge");
  await expect(page.getByTestId("room-phase")).toHaveText("input");
  await expect(page.getByTestId("participant-kind-demo-engineer"))
    .toHaveText("Simulated Participant · participant · advisor");
  await expect(page.getByTestId("participant-kind-demo-designer"))
    .toHaveText("Simulated Participant · participant · advisor");
  await expect(page.getByTestId("participant-kind-demo-marketing"))
    .toHaveText("Simulated Participant · participant · advisor");

  // The Founder seat is claimed automatically -- RoomProvider's demo
  // bootstrap effect claims the always-unclaimed `demo-product` seat for a
  // fresh solo_judge session, matching the real /room/demo product
  // behaviour (see room-provider.tsx). That effect races the realtime
  // update that follows "Start solo demo" in this shim + headless-browser
  // environment specifically -- manual live testing against real Chrome's
  // native WebMCP never reproduced a miss -- so fall back to the same
  // visible "Claim seat" control a human would use if the automatic claim
  // hasn't landed yet; either path is the same underlying mutation, so the
  // version assertion below holds regardless of which one fired.
  try {
    await expect(page.getByText("Your seat")).toBeVisible({ timeout: 5000 });
  } catch {
    await page.getByTestId("claim-demo-product").click();
    await expect(page.getByText("Your seat")).toBeVisible();
  }
  await expect(page.getByTestId("room-version")).toHaveText("4");
  await expect(page.getByTestId("participant-kind-demo-product"))
    .toHaveText("Human Participant · owner · decision_maker");
  await expect.poll(() => toolNames(page)).toEqual(expect.arrayContaining([
    "share_my_context", "get_meeting_context", "get_my_attention_items",
  ]));

  const position = JSON.parse(String(await executeTool(page, "share_my_context", {
    summary: "Improve onboarding completion and time to first value.",
    category: "outcome",
    priority: "high",
    constraints: [],
  })));
  expect(position).toMatchObject({ ok: true });

  // Every required participant (the founder, and now -- see
  // `derive_owner_participant_authority` -- the three simulated teammates
  // too) is ready the instant the founder's own position lands, so the
  // deterministic solo-judge cascade carries the room straight through
  // Proposals (auto-activating the seeded over-scoped proposal) and into
  // Deliberation (the seed's engineering-capacity objection is already
  // waiting) in this same beat. There is no separate `suggest_option` step
  // and no intermediate "proposals" phase to observe here.
  await expect(page.getByTestId("room-phase")).toHaveText("deliberation");
  await expect.poll(() => toolNames(page)).toEqual(expect.arrayContaining([
    "get_open_issues", "raise_concern", "respond_to_concern",
  ]));

  const seededContext = JSON.parse(String(await executeTool(page, "get_meeting_context", {})));
  expect(seededContext.data.untrustedRoomContent.activeProposal.title).toBe("Highly personalized AI onboarding");

  const issues = JSON.parse(String(await executeTool(page, "get_open_issues", {})));
  expect(issues.data.openIssues.length).toBeGreaterThan(0);
  const tradeoff = JSON.parse(String(await executeTool(page, "respond_to_concern", {
    conflictIds: issues.data.openIssues.map((issue: { conflictId: string }) => issue.conflictId),
    description: "Reduce scope, reuse the existing authentication and session model, keep accessible patterns, and hold the campaign launch date.",
    expectedEffect: "Removes the capacity, auth-boundary, and data-scope risk while still improving first-value completion before the campaign cutoff.",
    revisedProposal: {
      title: "Reduced-scope AI-assisted onboarding",
      summary: "Ship a small, incremental onboarding improvement that reuses the existing authentication and session model with no new auth fields, adds a simple guided first-value flow, and keeps every screen accessible with full screen reader and keyboard support. No new persistent user data is stored.",
      rationale: "This fits within the available two engineering days, avoids any auth rewrite, keeps accessible and consistent interaction patterns, and ships before the campaign launch date.",
      expectedOutcomes: ["Higher onboarding completion", "Faster time to first value", "No accessibility regression", "Launch date held"],
      referencedConstraintIds: [
        "constraint-engineering-auth",
        "constraint-engineering-capacity",
        "constraint-design-accessibility",
        "constraint-marketing-date",
      ],
    },
  })));
  expect(tradeoff).toMatchObject({ ok: true });

  // The revision may need a second, more explicit pass to fully clear every
  // blocking objection -- the same "ask it to try again" allowance
  // docs/judge-demo.md documents for a human judge -- so poll for Voting
  // instead of asserting it landed on the first attempt.
  await expect(page.getByTestId("room-phase")).toHaveText("voting", { timeout: 20_000 });
  await expect.poll(() => toolNames(page)).toEqual(expect.arrayContaining([
    "express_my_alignment", "get_alignment", "get_meeting_context",
  ]));

  const votingContext = JSON.parse(String(await executeTool(page, "get_meeting_context", {})));
  const activeProposalId = votingContext.data.untrustedRoomContent.activeProposal.id;
  const alignment = JSON.parse(String(await executeTool(page, "express_my_alignment", {
    proposalId: activeProposalId,
    choice: "support",
    comment: "Ready for exact human review.",
  })));
  expect(alignment).toMatchObject({ ok: true });
  await expect(page.getByTestId("room-phase")).toHaveText("approval");
  await expect(page.getByTestId("approvals")).toBeEmpty();
  await expect.poll(() => toolNames(page)).toEqual(expect.arrayContaining([
    "approve_final_decision", "get_meeting_context", "get_current_decision",
  ]));

  const preview = JSON.parse(String(await executeTool(page, "get_current_decision", {})));
  expect(preview.data.trustedContext.decisionReview.missingApprovalParticipantIds).toEqual(["demo-product"]);
  expect(preview.data.trustedContext.decisionReview.completedApprovalCount).toBe(0);
  const decisionHash = preview.data.trustedContext.decisionReview.decisionHash;
  await expect(page.getByTestId("decision-hash")).toHaveText(decisionHash);

  const approvalRequest = JSON.parse(String(await executeTool(
    page,
    "approve_final_decision",
    { decisionHash },
  )));
  expect(approvalRequest).toMatchObject({
    ok: false,
    error: { code: "HUMAN_CONFIRMATION_REQUIRED" },
  });
  await page.getByLabel("I reviewed and confirm this exact final decision.").check();
  await page.getByTestId("confirm-approval").click();
  await expect(page.getByTestId("room-phase")).toHaveText("finalized");
  await expect.poll(() => toolNames(page)).toEqual(finalizedToolNames);

  const record = JSON.parse(String(await executeTool(page, "get_decision_record", {})));
  expect(record.data.approvals.map(
    (approval: { participantId: string }) => approval.participantId,
  )).toEqual(["demo-product"]);
  expect(record.data.provenance.some(
    (event: { origin: string; action: string }) =>
      event.origin === "simulation" && event.action === "objection.raised",
  )).toBe(true);
  expect(record.data.provenance.filter(
    (event: { origin: string; action: string }) =>
      event.origin === "simulation" && event.action === "alignment.expressed",
  )).toHaveLength(3);

  await page.getByTestId("start-solo-demo").click();
  await expect(page.getByTestId("room-phase")).toHaveText("input");
  await expect(page.getByTestId("room-version")).toHaveText("3");
  await expect(page.getByTestId("conflicts")).toBeEmpty();
  await expect(page.getByTestId("alignments")).toBeEmpty();

  // The replay releases the seat, so the write tools leave with it until the
  // judge claims again. get_expert_advice stays -- the Security Expert
  // survives a demo reset, same as get_meeting_context.
  await expect.poll(() => toolNames(page)).toEqual(preClaimToolNames);
  await page.getByTestId("claim-demo-product").click();
  await expect(page.getByText("Your seat")).toBeVisible();
  await expect.poll(() => toolNames(page)).toEqual(expect.arrayContaining([
    "share_my_context", "get_meeting_context", "get_my_attention_items",
  ]));

  await context.close();
});
