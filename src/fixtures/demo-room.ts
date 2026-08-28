import { roomStateSchema, type RoomState } from "@/contracts/room";

const timestamp = "2026-08-28T12:00:00.000Z";

export const demoRoom: RoomState = roomStateSchema.parse({
  id: "demo",
  title: "Launch Plan Decision Room",
  brief:
    "Agree on a credible launch scope that balances customer value, delivery risk, design quality, and market timing.",
  phase: "input",
  version: 1,
  selfParticipantId: null,
  activeProposalId: null,
  participants: [
    {
      id: "participant-product",
      name: "Maya",
      role: "Product",
      kind: "human",
      requiredForApproval: true,
      createdAt: timestamp,
    },
    {
      id: "participant-engineering",
      name: "Emre",
      role: "Engineering",
      kind: "human",
      requiredForApproval: true,
      createdAt: timestamp,
    },
    {
      id: "participant-design",
      name: "Lina",
      role: "Design",
      kind: "simulation",
      requiredForApproval: false,
      createdAt: timestamp,
    },
  ],
  positions: [],
  constraints: [],
  proposals: [],
  conflicts: [],
  tradeoffs: [],
  votes: [],
  approvals: [],
  activity: [
    {
      id: "event-room-created",
      actorType: "system",
      actorId: null,
      origin: "system",
      action: "room.created",
      entityType: "room",
      entityId: "demo",
      sanitizedInput: {},
      result: { ok: true },
      previousRoomVersion: 0,
      resultingRoomVersion: 1,
      confirmationRequired: false,
      createdAt: timestamp,
    },
  ],
});
