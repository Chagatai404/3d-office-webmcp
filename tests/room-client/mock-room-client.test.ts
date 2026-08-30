import { beforeEach, describe, expect, it } from "vitest";
import { roomStateSchema, type RoomState } from "@/contracts/room";
import { demoRoom, DEMO_SELF_PARTICIPANT_ID } from "@/fixtures/demo-room";
import { MockRoomClient } from "@/room-client/mock-room-client";

const ENGINEER_POSITION = {
  summary: "Scope has to fit what one engineer can ship in two weeks.",
  category: "capacity",
  priority: "high",
  constraints: [
    {
      category: "capacity",
      text: "Implementation capacity is roughly one engineer for two weeks.",
      priority: "high",
    },
    {
      category: "architecture",
      text: "No authentication rewrite as part of this change.",
      priority: null,
    },
  ],
};

describe("MockRoomClient", () => {
  let client: MockRoomClient;

  beforeEach(() => {
    client = new MockRoomClient(demoRoom);
  });

  it("returns a snapshot that callers cannot mutate into the store", async () => {
    const first = await client.getRoom("demo");
    first.participants.length = 0;

    const second = await client.getRoom("demo");
    expect(second.participants).toHaveLength(demoRoom.participants.length);
  });

  it("rejects an unknown room", async () => {
    await expect(client.getRoom("does-not-exist")).rejects.toThrow(
      /Unknown room/,
    );
  });

  it("adds a position, its constraints, and one activity event", async () => {
    const before = await client.getRoom("demo");
    const result = await client.addMyPosition("demo", ENGINEER_POSITION);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const after = await client.getRoom("demo");

    expect(after.version).toBe(before.version + 1);
    expect(result.roomVersion).toBe(after.version);
    expect(after.positions).toHaveLength(before.positions.length + 1);
    expect(after.constraints).toHaveLength(before.constraints.length + 2);
    expect(after.activity).toHaveLength(before.activity.length + 1);

    const event = after.activity.at(-1);
    expect(event?.action).toBe("position.added");
    expect(event?.actorType).toBe("participant");
    expect(event?.actorId).toBe(DEMO_SELF_PARTICIPANT_ID);
    expect(event?.origin).toBe("manual_ui");
    expect(event?.previousRoomVersion).toBe(before.version);
    expect(event?.resultingRoomVersion).toBe(after.version);
  });

  it("keeps new constraints associated with the acting participant", async () => {
    await client.addMyPosition("demo", ENGINEER_POSITION);
    const after = await client.getRoom("demo");

    const added = after.constraints.filter(
      (constraint) => constraint.participantId === DEMO_SELF_PARTICIPANT_ID,
    );

    expect(added).toHaveLength(2);
    expect(added.map((constraint) => constraint.category)).toEqual([
      "capacity",
      "architecture",
    ]);
    expect(new Set(added.map((constraint) => constraint.id)).size).toBe(2);
    expect(
      after.constraints.every(
        (constraint) =>
          constraint.participantId !== DEMO_SELF_PARTICIPANT_ID ||
          added.some((entry) => entry.id === constraint.id),
      ),
    ).toBe(true);
  });

  it("emits the updated snapshot to subscribers", async () => {
    const received: RoomState[] = [];
    const unsubscribe = client.subscribe("demo", (state) => {
      received.push(state);
    });

    // The initial snapshot arrives the way a realtime client would deliver it.
    await Promise.resolve();
    expect(received).toHaveLength(1);
    expect(received[0]?.version).toBe(demoRoom.version);

    await client.addMyPosition("demo", ENGINEER_POSITION);

    expect(received).toHaveLength(2);
    expect(received[1]?.version).toBe(demoRoom.version + 1);
    expect(received[1]?.constraints).toHaveLength(
      demoRoom.constraints.length + 2,
    );

    unsubscribe();
    await client.addMyPosition("demo", ENGINEER_POSITION);
    expect(received).toHaveLength(2);
  });

  it("keeps every emitted snapshot valid against the canonical contract", async () => {
    await client.addMyPosition("demo", ENGINEER_POSITION);
    const after = await client.getRoom("demo");

    expect(roomStateSchema.parse(JSON.parse(JSON.stringify(after)))).toEqual(
      after,
    );
  });

  it("is deterministic across identical runs", async () => {
    const other = new MockRoomClient(demoRoom);
    await client.addMyPosition("demo", ENGINEER_POSITION);
    await other.addMyPosition("demo", ENGINEER_POSITION);

    expect(await client.getRoom("demo")).toEqual(await other.getRoom("demo"));
  });

  it("returns a structured failure for invalid input and changes nothing", async () => {
    const before = await client.getRoom("demo");
    const result = await client.addMyPosition("demo", {
      summary: "",
      category: null,
      priority: null,
      constraints: [],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    expect(result.error.recovery).toBeTruthy();
    expect(await client.getRoom("demo")).toEqual(before);
  });

  it("refuses to publish a position when no seat is held", async () => {
    const unseated = new MockRoomClient({
      ...demoRoom,
      selfParticipantId: null,
    });

    const result = await unseated.addMyPosition("demo", ENGINEER_POSITION);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("NOT_AUTHORIZED");
  });

  it("never accepts a caller-supplied participant identity", async () => {
    const result = await client.addMyPosition("demo", {
      ...ENGINEER_POSITION,
      // A browser trying to act as someone else must not be honoured.
      participantId: "participant-product",
    } as never);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });

  it("reports actions the room's phase does not allow", async () => {
    const result = await client.expressMyAlignment("demo");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("WRONG_PHASE");
  });

  it("seats a participant through claimSeat", async () => {
    const result = await client.claimSeat("demo", {
      seatId: "participant-product",
    });

    expect(result.ok).toBe(true);
    const after = await client.getRoom("demo");
    expect(after.selfParticipantId).toBe("participant-product");
    expect(after.activity.at(-1)?.action).toBe("seat.claimed");
  });
});
