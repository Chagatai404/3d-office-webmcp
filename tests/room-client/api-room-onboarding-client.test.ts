import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiRoomOnboardingClient } from "@/clients/api-room-onboarding-client";

afterEach(() => { vi.unstubAllGlobals(); });

const supabase = {
  auth: {
    getSession: async () => ({
      data: { session: { access_token: "session-token" } },
    }),
  },
} as never;

describe("ApiRoomOnboardingClient creation", () => {
  it("posts the canonical creator-only DTO and parses the room, owner, invite URL, and passcode", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      json: async () => ({
        ok: true,
        data: {
          roomId: "rm_TESTROOM",
          ownerParticipantId: "owner-participant",
          inviteUrl: "https://app.example/room/rm_TESTROOM/join?invite=raw-capability",
          passcode: "AB12CD34",
        },
        roomVersion: 0,
        message: "Room created.",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new ApiRoomOnboardingClient(supabase);
    const input = {
      title: "Choose a launch",
      brief: "Pick the smallest credible launch scope.",
      creatorName: "Maya",
      creatorRole: "Founder",
    };

    await expect(client.createRoom(input)).resolves.toEqual({
      roomId: "rm_TESTROOM",
      ownerParticipantId: "owner-participant",
      inviteUrl: "https://app.example/room/rm_TESTROOM/join?invite=raw-capability",
      passcode: "AB12CD34",
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/rooms", {
      method: "POST",
      headers: {
        Authorization: "Bearer session-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    });
  });
});

describe("ApiRoomOnboardingClient join requests", () => {
  it("posts a passcode join request to the narrow endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      json: async () => ({
        ok: true,
        data: {
          roomId: "rm_TESTROOM",
          joinRequest: {
            id: "join-request-1",
            roomId: "rm_TESTROOM",
            displayName: "Emre",
            role: "Engineer",
            status: "waiting",
            createdAt: "2026-08-30T00:00:00.000Z",
            resolvedAt: null,
          },
        },
        roomVersion: 0,
        message: "Waiting for the meeting owner.",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new ApiRoomOnboardingClient(supabase);
    const input = {
      roomId: "rm_TESTROOM",
      passcode: "AB12CD34",
      displayName: "Emre",
      role: "Engineer",
    };

    const result = await client.requestJoinByPasscode(input);
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith("/api/join-requests/passcode", {
      method: "POST",
      headers: {
        Authorization: "Bearer session-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    });
  });

  it("posts an invite join request to the narrow endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      json: async () => ({
        ok: false,
        error: { code: "INVALID_JOIN_CREDENTIALS", message: "Invitation is invalid or unavailable." },
        roomVersion: 0,
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new ApiRoomOnboardingClient(supabase);
    const input = { inviteToken: "raw-capability", displayName: "Emre", role: "Engineer" };

    const result = await client.requestJoinByInvite(input);
    expect(result).toEqual({
      ok: false,
      error: { code: "INVALID_JOIN_CREDENTIALS", message: "Invitation is invalid or unavailable." },
      roomVersion: 0,
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/join-requests/invite", {
      method: "POST",
      headers: {
        Authorization: "Bearer session-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    });
  });

  it("reads a join request's own status by id", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      json: async () => ({
        ok: true,
        data: {
          id: "join-request-1",
          roomId: "rm_TESTROOM",
          displayName: "Emre",
          role: "Engineer",
          status: "admitted",
          createdAt: "2026-08-30T00:00:00.000Z",
          resolvedAt: "2026-08-30T00:05:00.000Z",
        },
        roomVersion: 1,
        message: "Join request loaded.",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new ApiRoomOnboardingClient(supabase);

    const result = await client.getMyJoinRequest("join-request-1");
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith("/api/join-requests/join-request-1", {
      headers: { Authorization: "Bearer session-token" },
      cache: "no-store",
    });
  });
});
