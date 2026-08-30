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

export async function toolNames(page: Page) {
  return page.evaluate(async () =>
    (await document.modelContext!.getTools()).map((tool) => tool.name),
  );
}

export async function executeTool(page: Page, name: string, input: unknown) {
  return page.evaluate(async ({ toolName, toolInput }) => {
    const modelContext = document.modelContext!;
    const tool = (await modelContext.getTools()).find((candidate) => candidate.name === toolName);
    if (!tool) throw new Error(`Tool ${toolName} was not discovered.`);
    return modelContext.executeTool(tool, JSON.stringify(toolInput));
  }, { toolName: name, toolInput: input });
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
): Promise<{ roomId: string; ownerParticipantId: string }> {
  await page.goto("/e2e/onboarding");
  await page.getByTestId("create-room-input").fill(JSON.stringify(input));
  await page.getByTestId("create-room").click();
  await expect(page.getByTestId("created-room")).toBeVisible();

  const roomId = (await page.getByTestId("created-room-id").innerText()).trim();
  const ownerParticipantId = (
    await page.getByTestId("created-owner-participant-id").innerText()
  ).trim();
  return { roomId, ownerParticipantId };
}

/** The raw capability an invite link carries. */
export function inviteTokenOf(inviteUrl: string): string {
  const token = new URL(inviteUrl).searchParams.get("invite");
  if (!token) throw new Error(`No invite token in ${inviteUrl}.`);
  return token;
}

/**
 * Opens an invite link and waits for its pre-membership preview — the first
 * step the product join route takes with the same capability.
 */
export async function openInviteLink(page: Page, inviteUrl: string) {
  await page.goto(`/e2e/onboarding?invite=${encodeURIComponent(inviteTokenOf(inviteUrl))}`);
  await expect(page.getByTestId("invite-preview")).toBeVisible();
}

/** Spends the previewed capability and follows the redirect into the room. */
export async function claimAndEnterRoom(page: Page, roomId: string) {
  await page.getByTestId("claim-invitation").click();
  await page.waitForURL(`**/room/${roomId}`);
  await expect(page.getByTestId("connection-status")).toHaveText("Connected");
}
