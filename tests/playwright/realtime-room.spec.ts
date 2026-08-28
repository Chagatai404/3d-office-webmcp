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

  await engineerContext.close();
  await designerContext.close();
});
