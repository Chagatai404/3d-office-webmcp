import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import type { CreateRoomInput } from "@/contracts/room";

/**
 * Shared browser-integration helpers.
 *
 * The demo journey and the created-room journey need the same four things: a
 * WebMCP host to register tools into, a way to call those tools the way an
 * agent would, a way to reach the HTTP API directly with the context's own
 * session, and independent browser contexts that each carry their own
 * anonymous identity.
 */

/**
 * A minimal in-page `navigator`-style WebMCP host.
 *
 * Real browser agents provide `document.modelContext`; this stands in for one
 * so registration, discovery and execution are exercised for real.
 */
export async function installWebMcpShim(context: BrowserContext) {
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
        input: Record<string, unknown> = {},
        options?: { signal?: AbortSignal },
      ) {
        const definition = this.tools.get(tool.name);
        if (!definition) throw new Error(`Tool ${tool.name} is unavailable.`);
        return definition.execute(input, {
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

export async function toolNames(page: Page) {
  return page.evaluate(async () =>
    (await document.modelContext!.getTools()).map((tool) => tool.name),
  );
}

/**
 * A tool that was present a moment ago (an `expect.poll` on `toolNames`
 * already confirmed it) can still be momentarily absent from the very next
 * `getTools()` snapshot: React's registration effect unregisters the old
 * tool set and re-registers the new one as two separate steps, and a
 * capability-changing action (claiming a seat, admitting someone, a phase
 * advance) can land in between them. This is the same "snapshot goes stale"
 * timing `docs/webmcp-demo.md` documents for the real Chrome implementation,
 * reproduced here by the test shim. A short retry rides out that gap without
 * masking a tool that is genuinely never registered.
 */
async function hasTool(page: Page, name: string): Promise<boolean> {
  return page.evaluate(
    async (toolName) => (await document.modelContext!.getTools()).some((candidate) => candidate.name === toolName),
    name,
  );
}

export async function executeTool(page: Page, name: string, input: unknown) {
  const deadline = Date.now() + 2000;
  while (!(await hasTool(page, name)) && Date.now() < deadline) {
    await page.waitForTimeout(100);
  }
  return page.evaluate(async ({ toolName, toolInput }) => {
    const modelContext = document.modelContext!;
    const tool = (await modelContext.getTools()).find((candidate) => candidate.name === toolName);
    if (!tool) throw new Error(`Tool ${toolName} was not discovered.`);
    return modelContext.executeTool(tool, toolInput as Record<string, unknown>);
  }, { toolName: name, toolInput: input });
}

/** Capture the page-owned definition so a test can exercise a stale reference after unregistration. */
export async function captureToolDefinition(page: Page, name: string) {
  await page.evaluate((toolName) => {
    const host = document.modelContext as unknown as { tools: Map<string, WebMcpToolDefinition> };
    const definition = host.tools.get(toolName);
    if (!definition) throw new Error(`Tool ${toolName} was not registered.`);
    (globalThis as unknown as { __capturedWebMcpTool: WebMcpToolDefinition }).__capturedWebMcpTool = definition;
  }, name);
}

export async function executeCapturedTool(page: Page, input: Record<string, unknown> = {}) {
  return page.evaluate(async (toolInput) => {
    const definition = (globalThis as unknown as { __capturedWebMcpTool?: WebMcpToolDefinition }).__capturedWebMcpTool;
    if (!definition) throw new Error("No WebMCP tool definition has been captured.");
    return definition.execute(toolInput, { signal: new AbortController().signal });
  }, input);
}

/** A tool result, already parsed out of its JSON transport envelope. */
export async function callTool(page: Page, name: string, input: unknown = {}) {
  return JSON.parse(String(await executeTool(page, name, input)));
}

/**
 * The same mutation without WebMCP, from the page's own anonymous session.
 *
 * Used to prove that the manual HTTP path is no weaker than the agent path:
 * every authority check lives on the server, so both are refused identically.
 */
export async function apiPost(
  page: Page,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return page.evaluate(async ({ path, body, headers }) => {
    const storedSession = Object.values(localStorage)
      .map((value) => {
        try { return JSON.parse(value) as { access_token?: string }; } catch { return null; }
      })
      .find((value) => value?.access_token);
    if (!storedSession?.access_token) throw new Error("Supabase session not found.");
    const response = await fetch(path, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${storedSession.access_token}`,
        "Content-Type": "application/json",
        ...headers,
      },
      body: JSON.stringify(body),
    });
    return response.json();
  }, { path, body, headers });
}

/**
 * Waits until a context has observed a given room version.
 *
 * A WebMCP write reaches the database directly rather than through
 * `ApiRoomClient`, so every context — the writer included — learns the
 * resulting version through realtime. Anything carrying a version guard has to
 * wait for that first, exactly as a human would.
 */
export async function expectRoomVersion(page: Page, version: number) {
  await expect(page.getByTestId("room-version")).toHaveText(String(version));
}

/**
 * One browser context per human. Storage is isolated, so each gets its own
 * anonymous auth session and therefore its own participant authority.
 */
export async function newParticipantContext(browser: Browser) {
  const context = await browser.newContext();
  await installWebMcpShim(context);
  const page = await context.newPage();
  return { context, page };
}

/**
 * Drives the onboarding harness the way an organizer drives the product's own
 * creation form: `ApiRoomOnboardingClient.createRoom()` over `POST /api/rooms`,
 * with the organizer derived from this context's session.
 */
export async function createRoomThroughOnboarding(
  page: Page,
  input: CreateRoomInput,
): Promise<{ roomId: string; ownerParticipantId: string; passcode: string; inviteUrl: string }> {
  await page.goto("/e2e/onboarding");
  await page.getByTestId("create-room-input").fill(JSON.stringify(input));
  await page.getByTestId("create-room").click();
  await expect(page.getByTestId("created-room")).toBeVisible();

  const roomId = (await page.getByTestId("created-room-id").innerText()).trim();
  const ownerParticipantId = (
    await page.getByTestId("created-owner-participant-id").innerText()
  ).trim();
  const passcode = (await page.getByTestId("created-passcode").innerText()).trim();
  const inviteUrl = (await page.getByTestId("created-invite-url").innerText()).trim();
  return { roomId, ownerParticipantId, passcode, inviteUrl };
}

/** The raw capability an invite link carries. */
export function inviteTokenOf(inviteUrl: string): string {
  const token = new URL(inviteUrl).searchParams.get("invite");
  if (!token) throw new Error(`No invite token in ${inviteUrl}.`);
  return token;
}

type JoinDetails = { displayName: string; role: string };

/**
 * Submits a waiting-room request by room ID and passcode, the way the
 * product `/join` form does with the same credentials.
 */
export async function requestJoinByPasscode(
  page: Page,
  details: JoinDetails & { roomId: string; passcode: string },
) {
  await page.goto("/e2e/onboarding");
  await page.getByTestId("join-room-id").fill(details.roomId);
  await page.getByTestId("join-passcode").fill(details.passcode);
  await page.getByTestId("join-display-name").fill(details.displayName);
  await page.getByTestId("join-role").fill(details.role);
  await page.getByTestId("request-join-by-passcode").click();
}

/**
 * Opens an invite link, waits for its pre-membership preview, and submits a
 * waiting-room request with the same capability -- the first two steps the
 * product join route takes for an invite URL.
 */
export async function requestJoinByInvite(
  page: Page,
  details: JoinDetails & { inviteUrl: string },
) {
  await page.goto(`/e2e/onboarding?invite=${encodeURIComponent(inviteTokenOf(details.inviteUrl))}`);
  await expect(page.getByTestId("invite-preview")).toBeVisible();
  await page.getByTestId("join-display-name").fill(details.displayName);
  await page.getByTestId("join-role").fill(details.role);
  await page.getByTestId("request-join-by-invite").click();
}

/** Waits for the requester's private join-request status to reach a value. */
export async function expectJoinRequestStatus(page: Page, status: "waiting" | "admitted" | "rejected") {
  await expect(page.getByTestId("join-request-status")).toHaveText(status, { timeout: 15_000 });
}

/** Waits until a session's admitted redirect lands it inside the room. */
export async function expectEnteredRoom(page: Page, roomId: string) {
  await page.waitForURL(`**/room/${roomId}`, { timeout: 15_000 });
  await expect(page.getByTestId("connection-status")).toHaveText("Connected");
}

/**
 * Locates one waiting-room row on the owner's session by requester display
 * name. The owner harness polls `listJoinRequests` on its own, so this waits
 * for the row to appear rather than requiring the caller to refresh anything.
 */
export function waitingRequestRow(ownerPage: Page, displayName: string) {
  return ownerPage.locator('[data-testid="waiting-room"] article', { hasText: displayName });
}

export async function admitFromWaitingRoom(ownerPage: Page, displayName: string) {
  const row = waitingRequestRow(ownerPage, displayName);
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.getByRole("button", { name: "Admit" }).click();
}

export async function rejectFromWaitingRoom(ownerPage: Page, displayName: string) {
  const row = waitingRequestRow(ownerPage, displayName);
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.getByRole("button", { name: "Reject" }).click();
}
