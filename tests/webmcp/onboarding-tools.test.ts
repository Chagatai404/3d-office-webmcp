// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createOnboardingWebMcpTools } from "@/webmcp/onboarding-tools";
import { executeTool, fakeOnboardingWebMcpContext } from "./fake-context";

vi.mock("@/domain/rooms/operations", () => ({
  createRoom: vi.fn(),
  getMyJoinRequest: vi.fn(),
  requestJoinByInvite: vi.fn(),
  requestJoinByPasscode: vi.fn(),
}));

const operations = await import("@/domain/rooms/operations");

function allPropertyNames(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(allPropertyNames);
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, child]) => [key, ...allPropertyNames(child)]);
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...window.location, assign: vi.fn(), pathname: "/", origin: "http://localhost:3000" },
  });
  window.sessionStorage.clear();
});

describe("pre-membership WebMCP tools", () => {
  it("never accept trusted identity fields", () => {
    const tools = createOnboardingWebMcpTools(fakeOnboardingWebMcpContext());
    const forbidden = new Set(["participantId", "actorId", "authUserId", "userId", "ownerParticipantId", "origin"]);
    for (const tool of Object.values(tools)) {
      const names = allPropertyNames(tool.inputSchema);
      expect(names.filter((name) => forbidden.has(name)), tool.name).toEqual([]);
    }
  });

  it("create_meeting calls the domain operation and navigates into the created room", async () => {
    vi.mocked(operations.createRoom).mockResolvedValue({
      ok: true,
      data: { roomId: "rm_1", ownerParticipantId: "participant-owner", inviteUrl: "http://localhost:3000/room/rm_1/join?invite=tok", passcode: "ABCD1234" },
      roomVersion: 0,
      message: "Created.",
    });

    const result = await executeTool(createOnboardingWebMcpTools(fakeOnboardingWebMcpContext()).create_meeting!, {
      title: "Ship AI onboarding?",
      brief: "Decide whether to ship it next release.",
      creatorName: "Ata",
      creatorRole: "Founder",
    }) as { ok: boolean; data: { roomId: string } };

    expect(operations.createRoom).toHaveBeenCalledOnce();
    expect(result.ok).toBe(true);
    expect(result.data.roomId).toBe("rm_1");
    expect(window.location.assign).toHaveBeenCalledWith("/room/rm_1");
  });

  it("join_meeting (passcode) requests a join and never creates a participant directly", async () => {
    vi.mocked(operations.requestJoinByPasscode).mockResolvedValue({
      ok: true,
      data: { roomId: "rm_1", joinRequest: { id: "jr_1", roomId: "rm_1", displayName: "Maya", role: "Engineer", status: "waiting", createdAt: "2026-08-30T00:00:00.000Z", resolvedAt: null } },
      roomVersion: 0,
      message: "Requested.",
    });

    const result = await executeTool(createOnboardingWebMcpTools(fakeOnboardingWebMcpContext()).join_meeting!, {
      method: "passcode", roomId: "rm_1", passcode: "ABCD1234", displayName: "Maya", role: "Engineer",
    }) as { ok: boolean; data: { joinRequest: { status: string } } };

    expect(operations.requestJoinByPasscode).toHaveBeenCalledOnce();
    expect(result.ok).toBe(true);
    expect(result.data.joinRequest.status).toBe("waiting");
  });

  it("join_meeting (invite) extracts the token from a full invite URL", async () => {
    vi.mocked(operations.requestJoinByInvite).mockResolvedValue({
      ok: true,
      data: { roomId: "rm_1", joinRequest: { id: "jr_1", roomId: "rm_1", displayName: "Maya", role: "Engineer", status: "waiting", createdAt: "2026-08-30T00:00:00.000Z", resolvedAt: null } },
      roomVersion: 0,
      message: "Requested.",
    });

    await executeTool(createOnboardingWebMcpTools(fakeOnboardingWebMcpContext()).join_meeting!, {
      method: "invite", inviteToken: "http://localhost:3000/room/rm_1/join?invite=raw-token-1", displayName: "Maya", role: "Engineer",
    });

    const [, input] = vi.mocked(operations.requestJoinByInvite).mock.calls[0]!;
    expect(input.inviteToken).toBe("raw-token-1");
  });

  it("get_my_join_status reports only this session's own pending request", async () => {
    const tools = createOnboardingWebMcpTools(fakeOnboardingWebMcpContext());
    const noRequest = await executeTool(tools.get_my_join_status!, {}) as { ok: boolean };
    expect(noRequest.ok).toBe(false);

    window.sessionStorage.setItem("webmcp:pendingJoinRequest", JSON.stringify({ joinRequestId: "jr_1", roomId: "rm_1" }));
    vi.mocked(operations.getMyJoinRequest).mockResolvedValue({
      ok: true,
      data: { id: "jr_1", roomId: "rm_1", displayName: "Maya", role: "Engineer", status: "waiting", createdAt: "2026-08-30T00:00:00.000Z", resolvedAt: null },
      roomVersion: 0,
      message: "Loaded.",
    });
    const result = await executeTool(tools.get_my_join_status!, {}) as { ok: boolean; data: { status: string } };
    expect(result.ok).toBe(true);
    expect(result.data.status).toBe("waiting");
  });
});
