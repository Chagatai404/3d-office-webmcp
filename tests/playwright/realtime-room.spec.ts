import { expect, test, type BrowserContext, type Page } from "@playwright/test";

async function installWebMcpShim(context: BrowserContext) {
  await context.addInitScript(() => {
    class TestModelContext extends EventTarget {
      private readonly tools = new Map<string, WebMcpToolDefinition>();

      async registerTool(
        definition: WebMcpToolDefinition,
        options?: { signal?: AbortSignal },
      ) {
        this.tools.set(definition.name, definition);
        this.dispatchEvent(new Event("toolchange"));
        options?.signal?.addEventListener("abort", () => {
          if (this.tools.get(definition.name) === definition) {
            this.tools.delete(definition.name);
            this.dispatchEvent(new Event("toolchange"));
          }
        }, { once: true });
      }

      async getTools(): Promise<WebMcpRegisteredTool[]> {
        return [...this.tools.values()]
          .sort((left, right) => left.name.localeCompare(right.name))
          .map(({ name, description, inputSchema, annotations }) => ({
            name,
            description,
            inputSchema,
            ...(annotations ? { annotations } : {}),
          }));
      }

      async executeTool(
        tool: WebMcpRegisteredTool,
        inputJson: string,
        options?: { signal?: AbortSignal },
      ) {
        const definition = this.tools.get(tool.name);
        if (!definition) throw new Error(`Tool ${tool.name} is unavailable.`);
        return definition.execute(JSON.parse(inputJson), {
          signal: options?.signal ?? new AbortController().signal,
        });
      }
    }

    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: new TestModelContext(),
    });
  });
}

async function toolNames(page: Page) {
  return page.evaluate(async () =>
    (await document.modelContext!.getTools()).map((tool) => tool.name),
  );
}

async function executeTool(page: Page, name: string, input: unknown) {
  return page.evaluate(async ({ toolName, toolInput }) => {
    const modelContext = document.modelContext!;
    const tool = (await modelContext.getTools()).find((candidate) => candidate.name === toolName);
    if (!tool) throw new Error(`Tool ${toolName} was not discovered.`);
    return modelContext.executeTool(tool, JSON.stringify(toolInput));
  }, { toolName: name, toolInput: input });
}

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

  await engineer.getByTestId("claim-demo-engineer").click();
  await expect(engineer.getByText("Your seat")).toBeVisible();
  await expect(designer.getByTestId("room-version")).toHaveText("1");

  await designer.getByTestId("claim-demo-designer").click();
  await expect(designer.getByText("Your seat")).toBeVisible();
  await expect(engineer.getByTestId("room-version")).toHaveText("2");

  await expect.poll(() => toolNames(engineer)).toEqual([
    "add_my_position",
    "get_meeting_context",
  ]);
  const meetingContext = JSON.parse(String(await executeTool(engineer, "get_meeting_context", {})));
  expect(meetingContext).toMatchObject({
    ok: true,
    roomVersion: 2,
    data: {
      roomId: "demo",
      phase: "input",
      roomVersion: 2,
      currentParticipant: { participantId: "demo-engineer", role: "Engineer" },
    },
  });

  const positionResult = JSON.parse(String(await executeTool(engineer, "add_my_position", {
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
  await expect.poll(() => toolNames(engineer)).toEqual([
    "get_meeting_context",
    "list_positions",
    "submit_proposal",
  ]);

  const listed = JSON.parse(String(await executeTool(engineer, "list_positions", {})));
  const constraint = listed.data.participantPositions
    .flatMap((group: { constraints: Array<{ id: string; text: string }> }) => group.constraints)
    .find(
    (item: { text: string }) => item.text === "No authentication rewrite in this milestone.",
  );
  expect(constraint.id).toBeTruthy();

  const proposalResult = JSON.parse(String(await executeTool(engineer, "submit_proposal", {
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
  await expect.poll(() => toolNames(engineer)).toEqual([
    "get_meeting_context",
    "get_open_issues",
    "list_positions",
    "propose_tradeoff",
    "raise_objection",
  ]);

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
    raisedBy: { actorId: "demo-designer", displayName: "Lina" },
    severity: "blocking",
    status: "open",
  });

  const tradeoffResult = JSON.parse(String(await executeTool(engineer, "propose_tradeoff", {
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
  await expect.poll(() => toolNames(engineer)).toEqual([
    "cast_my_vote",
    "get_meeting_context",
    "get_open_issues",
  ]);

  const votingContext = JSON.parse(String(await executeTool(engineer, "get_meeting_context", {})));
  const activeProposalId = votingContext.data.activeProposal.id;
  const engineerVote = JSON.parse(String(await executeTool(engineer, "cast_my_vote", {
    proposalId: activeProposalId,
    choice: "support",
    comment: "Feasible within the two-week capacity.",
  })));
  expect(engineerVote).toMatchObject({ ok: true, roomVersion: 11 });
  await expect(designer.getByTestId("votes")).toContainText("demo-engineer: support");
  await expect(designer.getByTestId("approvals")).toBeEmpty();
  await expect(designer.getByTestId("activity")).toContainText("vote.cast · webmcp · v11");

  const designerVote = JSON.parse(String(await executeTool(designer, "cast_my_vote", {
    proposalId: activeProposalId,
    choice: "support",
    comment: "The revised focus order is acceptable.",
  })));
  expect(designerVote).toMatchObject({ ok: true, roomVersion: 12 });
  await expect(engineer.getByTestId("votes")).toContainText("demo-designer: support");

  await engineer.getByTestId("advance-phase").click();
  await expect(designer.getByTestId("room-phase")).toHaveText("approval");
  await expect.poll(() => toolNames(engineer)).toEqual([
    "approve_final_decision",
    "get_meeting_context",
    "preview_final_decision",
  ]);

  const engineerPreview = JSON.parse(String(await executeTool(engineer, "preview_final_decision", {})));
  const designerPreview = JSON.parse(String(await executeTool(designer, "preview_final_decision", {})));
  expect(engineerPreview.ok).toBe(true);
  expect(designerPreview.data).toEqual(engineerPreview.data);
  expect(engineerPreview.data.approvals).toEqual([]);
  expect(engineerPreview.data.missingApprovalParticipantIds).toEqual([
    "demo-designer",
    "demo-engineer",
  ]);
  const decisionHash = engineerPreview.data.decisionHash;
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
  await expect.poll(() => toolNames(engineer)).toEqual(["get_decision_record"]);

  const engineerRecord = JSON.parse(String(await executeTool(engineer, "get_decision_record", {})));
  const designerRecord = JSON.parse(String(await executeTool(designer, "get_decision_record", {})));
  expect(engineerRecord.ok).toBe(true);
  expect(designerRecord.data).toEqual(engineerRecord.data);
  expect(engineerRecord.data.decision.decisionHash).toBe(decisionHash);
  expect(engineerRecord.data.approvals).toHaveLength(2);

  const finalizedMutation = await engineer.evaluate(async ({ proposalId }) => {
    const storedSession = Object.values(localStorage)
      .map((value) => {
        try { return JSON.parse(value) as { access_token?: string }; } catch { return null; }
      })
      .find((value) => value?.access_token);
    if (!storedSession?.access_token) throw new Error("Supabase session not found.");
    const response = await fetch("/api/rooms/demo/votes", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${storedSession.access_token}`,
        "Content-Type": "application/json",
        "If-Match": "15",
      },
      body: JSON.stringify({ proposalId, choice: "oppose", comment: "Too late" }),
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
  await expect(page.getByTestId("room-version")).toHaveText("3");
  await expect(page.getByTestId("participant-kind-demo-product")).toContainText("Human Participant · Required approver");
  await expect(page.getByTestId("participant-kind-demo-engineer")).toHaveText("Simulated Participant");
  await expect(page.getByTestId("participant-kind-demo-designer")).toHaveText("Simulated Participant");
  await expect(page.getByTestId("participant-kind-demo-marketing")).toHaveText("Simulated Participant");

  await page.getByTestId("claim-demo-product").click();
  await expect(page.getByText("Your seat")).toBeVisible();
  await expect.poll(() => toolNames(page)).toEqual([
    "add_my_position",
    "get_meeting_context",
  ]);

  const position = JSON.parse(String(await executeTool(page, "add_my_position", {
    summary: "Improve onboarding completion and time to first value.",
    category: "outcome",
    priority: "high",
    constraints: [],
  })));
  expect(position).toMatchObject({ ok: true, roomVersion: 6 });
  await expect(page.getByTestId("room-phase")).toHaveText("proposals");
  await expect.poll(() => toolNames(page)).toEqual([
    "get_meeting_context",
    "list_positions",
    "submit_proposal",
  ]);

  const positions = JSON.parse(String(await executeTool(page, "list_positions", {})));
  expect(positions.data.participantPositions).toHaveLength(4);
  expect(positions.data.participantPositions.flatMap(
    (group: { positions: unknown[] }) => group.positions,
  )).toHaveLength(4);

  const proposal = JSON.parse(String(await executeTool(page, "submit_proposal", {
    title: "Custom personalized onboarding rebuild",
    summary: "Rebuild onboarding as a custom multi-step flow with new event tracking and expanded personalization before campaign launch.",
    rationale: "The broad rebuild aims to improve onboarding completion and first value.",
    expectedOutcomes: ["Higher completion"],
    referencedConstraintIds: ["constraint-product-completion", "constraint-product-value"],
  })));
  expect(proposal).toMatchObject({ ok: true, roomVersion: 10 });
  await expect(page.getByTestId("room-phase")).toHaveText("deliberation");
  await expect(page.getByTestId("conflicts")).toContainText("engineering capacity");
  await expect(page.getByTestId("conflicts")).toContainText("accessibility review scope");
  await expect(page.getByTestId("activity")).toContainText("objection.raised · simulation");

  const issues = JSON.parse(String(await executeTool(page, "get_open_issues", {})));
  expect(issues.data.openIssues).toHaveLength(2);
  const tradeoff = JSON.parse(String(await executeTool(page, "propose_tradeoff", {
    conflictIds: issues.data.openIssues.map((issue: { conflictId: string }) => issue.conflictId),
    description: "Reduce scope and reuse the existing authentication and onboarding flow.",
    expectedEffect: "Keep the two-week campaign launch while validating accessibility.",
    revisedProposal: {
      title: "Accessible incremental onboarding",
      summary: "Reuse the existing authentication and onboarding flow, limit scope to two accessible steps, and keep the campaign launch date.",
      rationale: "A thin two-week scope preserves existing auth while validating keyboard and screen reader accessibility and improving first value.",
      expectedOutcomes: ["Improve onboarding completion", "Faster first value"],
      referencedConstraintIds: [
        "constraint-engineering-auth",
        "constraint-engineering-capacity",
        "constraint-design-accessibility",
        "constraint-marketing-date",
      ],
    },
  })));
  expect(tradeoff).toMatchObject({ ok: true, roomVersion: 17 });
  await expect(page.getByTestId("room-phase")).toHaveText("voting");
  await expect(page.getByTestId("votes").locator("li")).toHaveCount(3);
  await expect(page.getByTestId("activity")).toContainText("conflict.resolved · simulation");
  await expect.poll(() => toolNames(page)).toEqual([
    "cast_my_vote",
    "get_meeting_context",
    "get_open_issues",
  ]);

  const votingContext = JSON.parse(String(await executeTool(page, "get_meeting_context", {})));
  const activeProposalId = votingContext.data.activeProposal.id;
  const vote = JSON.parse(String(await executeTool(page, "cast_my_vote", {
    proposalId: activeProposalId,
    choice: "support",
    comment: "Ready for exact human review.",
  })));
  expect(vote).toMatchObject({ ok: true, roomVersion: 19 });
  await expect(page.getByTestId("room-phase")).toHaveText("approval");
  await expect(page.getByTestId("approvals")).toBeEmpty();
  await expect.poll(() => toolNames(page)).toEqual([
    "approve_final_decision",
    "get_meeting_context",
    "preview_final_decision",
  ]);

  const preview = JSON.parse(String(await executeTool(page, "preview_final_decision", {})));
  expect(preview.data.requiredApprovalParticipantIds).toEqual(["demo-product"]);
  expect(preview.data.approvals).toEqual([]);
  const decisionHash = preview.data.decisionHash;
  await expect(page.getByTestId("decision-hash")).toHaveText(decisionHash);

  const approvalRequest = JSON.parse(String(await executeTool(
    page,
    "approve_final_decision",
    { decisionHash },
  )));
  expect(approvalRequest).toMatchObject({
    ok: false,
    error: { code: "HUMAN_CONFIRMATION_REQUIRED" },
    roomVersion: 19,
  });
  await page.getByLabel("I reviewed and confirm this exact final decision.").check();
  await page.getByTestId("confirm-approval").click();
  await expect(page.getByTestId("room-phase")).toHaveText("finalized");
  await expect(page.getByTestId("room-version")).toHaveText("20");
  await expect.poll(() => toolNames(page)).toEqual(["get_decision_record"]);

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
      event.origin === "simulation" && event.action === "vote.cast",
  )).toHaveLength(3);

  await page.getByTestId("start-solo-demo").click();
  await expect(page.getByTestId("room-phase")).toHaveText("input");
  await expect(page.getByTestId("room-version")).toHaveText("3");
  await expect(page.getByTestId("conflicts")).toBeEmpty();
  await expect(page.getByTestId("votes")).toBeEmpty();
  await expect.poll(() => toolNames(page)).toEqual([
    "add_my_position",
    "get_meeting_context",
  ]);

  await context.close();
});
