import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiRoomOnboardingClient } from "@/clients/api-room-onboarding-client";

afterEach(() => { vi.unstubAllGlobals(); });

describe("ApiRoomOnboardingClient creation", () => {
  it("posts the canonical creator-only DTO and parses the minimal result", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      json: async () => ({
        ok: true,
        data: { roomId: "rm_TESTROOM", ownerParticipantId: "owner-participant" },
        roomVersion: 0,
        message: "Room created.",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const supabase = {
      auth: {
        getSession: async () => ({
          data: { session: { access_token: "session-token" } },
        }),
      },
    };
    const client = new ApiRoomOnboardingClient(supabase as never);
    const input = {
      title: "Choose a launch",
      brief: "Pick the smallest credible launch scope.",
      creatorName: "Maya",
      creatorRole: "Founder",
    };

    await expect(client.createRoom(input)).resolves.toEqual({
      roomId: "rm_TESTROOM",
      ownerParticipantId: "owner-participant",
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
