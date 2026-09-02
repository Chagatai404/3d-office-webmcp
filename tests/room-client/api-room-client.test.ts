import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiRoomClient } from "@/clients/api-room-client";
import { demoRoom } from "@/fixtures/demo-room";
import type { MeetingReport } from "@/contracts/room";

type SubscribeStatusCallback = (status: string) => void;

function createSupabaseStub() {
  let statusCallback: SubscribeStatusCallback | undefined;
  const channel = {
    on: vi.fn(),
    subscribe: vi.fn(),
  };
  channel.on.mockReturnValue(channel);
  channel.subscribe.mockImplementation((callback: SubscribeStatusCallback) => {
    statusCallback = callback;
    return channel;
  });

  const supabase = {
    auth: {
      getSession: vi.fn(async () => ({
        data: { session: { access_token: "session-token" } },
      })),
    },
    realtime: {
      setAuth: vi.fn(async () => undefined),
    },
    channel: vi.fn(() => channel),
    removeChannel: vi.fn(async () => "ok"),
  };

  return {
    channel,
    emitStatus(status: string) {
      statusCallback?.(status);
    },
    supabase,
  };
}

function roomResponse() {
  return new Response(JSON.stringify(demoRoom), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ApiRoomClient realtime loading", () => {
  it("waits for SUBSCRIBED before performing the single reconciliation refresh", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => roomResponse());
    vi.stubGlobal("fetch", fetchMock);
    const realtime = createSupabaseStub();
    const client = new ApiRoomClient(realtime.supabase as never);
    const callback = vi.fn();

    const initial = await client.getRoom(demoRoom.id);
    expect(initial).toEqual(demoRoom);

    const unsubscribe = client.subscribe(demoRoom.id, callback);
    await vi.waitFor(() => expect(realtime.channel.subscribe).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledTimes(1);

    realtime.emitStatus("SUBSCRIBED");
    await vi.waitFor(() => expect(callback).toHaveBeenCalledWith(demoRoom));
    expect(fetchMock).toHaveBeenCalledTimes(2);

    unsubscribe();
    expect(realtime.supabase.removeChannel).toHaveBeenCalledWith(realtime.channel);
  });

  it.each([401, 403, 404])(
    "treats HTTP %s during reconciliation as quiet terminal unavailability",
    async (status) => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(roomResponse())
        .mockResolvedValueOnce(new Response(null, { status }));
      vi.stubGlobal("fetch", fetchMock);
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const realtime = createSupabaseStub();
      const client = new ApiRoomClient(realtime.supabase as never);
      const onUnavailable = vi.fn();

      await client.getRoom(demoRoom.id);
      client.subscribe(demoRoom.id, vi.fn(), onUnavailable);
      await vi.waitFor(() => expect(realtime.channel.subscribe).toHaveBeenCalledOnce());
      realtime.emitStatus("SUBSCRIBED");

      await vi.waitFor(() => expect(onUnavailable).toHaveBeenCalledOnce());
      expect(realtime.supabase.removeChannel).toHaveBeenCalledWith(realtime.channel);
      expect(errorSpy).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["network failure", () => Promise.reject(new TypeError("offline"))],
    ["HTTP 500", () => Promise.resolve(new Response(null, { status: 500 }))],
    ["malformed RoomState", () => Promise.resolve(new Response(JSON.stringify({ id: demoRoom.id }), { status: 200 }))],
  ])("reports %s during a realtime refresh", async (_label, failingResponse) => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(roomResponse())
      .mockImplementationOnce(failingResponse);
    vi.stubGlobal("fetch", fetchMock);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const realtime = createSupabaseStub();
    const client = new ApiRoomClient(realtime.supabase as never);

    await client.getRoom(demoRoom.id);
    client.subscribe(demoRoom.id, vi.fn(), vi.fn());
    await vi.waitFor(() => expect(realtime.channel.subscribe).toHaveBeenCalledOnce());
    realtime.emitStatus("SUBSCRIBED");

    await vi.waitFor(() => {
      expect(errorSpy).toHaveBeenCalledWith("Room refresh failed", expect.anything());
    });
    expect(realtime.supabase.removeChannel).not.toHaveBeenCalled();
  });
});

describe("ApiRoomClient canonical report", () => {
  it("reads and validates the authenticated MeetingReport endpoint", async () => {
    const report: MeetingReport = {
      roomId: demoRoom.id,
      title: "Decision report",
      brief: "A finalized decision.",
      executiveSummary: "The room chose the accessible option.",
      finalDecision: { title: "Accessible option", summary: "Ship the accessible option." },
      rationale: "It satisfies the hard constraints.",
      participants: [],
      decisionPolicy: "owner_decides",
      keyInputs: [],
      constraints: [],
      proposalsConsidered: [],
      concernsRaised: [],
      resolvedConcerns: [],
      unresolvedWarnings: [],
      acceptedTradeoffs: [],
      alignment: [],
      dissent: [],
      expertAdvice: [],
      actionItems: [],
      owners: [],
      deadlines: [],
      requiredApprovalParticipantIds: [],
      approvals: [],
      decisionHash: "sha256:report",
      finalizedAt: "2026-09-01T00:00:00.000Z",
      provenanceSummary: { totalEvents: 0, byAction: {} },
      activityLog: [],
    };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      data: report,
      roomVersion: 17,
      message: "Final meeting report loaded.",
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const realtime = createSupabaseStub();
    const client = new ApiRoomClient(realtime.supabase as never);

    await expect(client.getMeetingReport(demoRoom.id)).resolves.toMatchObject({
      ok: true,
      data: { decisionHash: "sha256:report" },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/rooms/${encodeURIComponent(demoRoom.id)}/report`,
      expect.objectContaining({ headers: { Authorization: "Bearer session-token" } }),
    );
  });
});
