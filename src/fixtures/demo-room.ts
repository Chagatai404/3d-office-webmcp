import { roomStateSchema, type RoomState } from "@/contracts/room";

/**
 * Deterministic seed for `/room/demo`.
 *
 * The scenario is intentionally fixed so the mock client, the 2D shell, the
 * visualization adapter, and the tests all observe identical state.
 *
 * The Engineer seat is deliberately left without a position: the first
 * end-to-end mutation of the demo is the Engineer publishing their position
 * and capacity constraints through `RoomClient.addMyPosition`.
 */

const BASE_TIME_MS = Date.parse("2026-08-28T12:00:00.000Z");

/** One second per seeded step keeps ordering readable and reproducible. */
export const DEMO_CLOCK_STEP_MS = 1_000;

export function demoTimestamp(step: number): string {
  return new Date(BASE_TIME_MS + step * DEMO_CLOCK_STEP_MS).toISOString();
}

export const DEMO_ROOM_ID = "demo";

/** The browser session in the demo is seated as the Engineer. */
export const DEMO_SELF_PARTICIPANT_ID = "participant-engineering";

export const demoRoom: RoomState = roomStateSchema.parse({
  id: DEMO_ROOM_ID,
  title: "Onboarding Update Decision Room",
  brief:
    "Agree on a credible launch scope that balances customer value, delivery risk, design quality, and market timing.",
  demoMode: "multi_user",
  phase: "input",
  version: 4,
  ownerParticipantId: "participant-product",
  decisionPolicy: "equal_authority_consensus",
  selfParticipantId: DEMO_SELF_PARTICIPANT_ID,
  activeProposalId: null,
  finalizedAt: null,
  finalDecisionPreview: null,
  participants: [
    {
      id: "participant-product",
      name: "Maya Okonkwo",
      role: "Product Manager",
      kind: "human",
      meetingRole: "owner",
      decisionRole: "decision_maker",
      isClaimed: false,
      isReady: false,
      createdAt: demoTimestamp(0),
    },
    {
      id: "participant-engineering",
      name: "Emre Yilmaz",
      role: "Engineer",
      kind: "human",
      meetingRole: "participant",
      decisionRole: "decision_maker",
      isClaimed: true,
      isReady: false,
      createdAt: demoTimestamp(0),
    },
    {
      id: "participant-design",
      name: "Lina Duarte",
      role: "Designer",
      kind: "simulation",
      meetingRole: "participant",
      decisionRole: "advisor",
      isClaimed: true,
      isReady: false,
      createdAt: demoTimestamp(0),
    },
    {
      id: "participant-marketing",
      name: "Tomas Reyes",
      role: "Marketing Lead",
      kind: "human",
      meetingRole: "participant",
      decisionRole: "decision_maker",
      isClaimed: false,
      isReady: false,
      createdAt: demoTimestamp(0),
    },
  ],
  positions: [
    {
      id: "position-1",
      participantId: "participant-product",
      summary:
        "New users should reach first value faster, and onboarding completion should measurably improve.",
      category: "outcome",
      priority: "high",
      createdAt: demoTimestamp(1),
    },
    {
      id: "position-2",
      participantId: "participant-design",
      summary:
        "Any onboarding change has to stay accessible and consistent with the existing interaction patterns.",
      category: "quality",
      priority: "high",
      createdAt: demoTimestamp(2),
    },
    {
      id: "position-3",
      participantId: "participant-marketing",
      summary:
        "The product surface has to be stable before the campaign cutoff, and the campaign date cannot move.",
      category: "timing",
      priority: "high",
      createdAt: demoTimestamp(3),
    },
  ],
  constraints: [
    {
      id: "constraint-1",
      participantId: "participant-product",
      category: "outcome",
      text: "Onboarding completion rate must improve, not just change.",
      priority: "high",
      createdAt: demoTimestamp(1),
    },
    {
      id: "constraint-2",
      participantId: "participant-product",
      category: "outcome",
      text: "Time to first value should shorten for new accounts.",
      priority: "medium",
      createdAt: demoTimestamp(1),
    },
    {
      id: "constraint-3",
      participantId: "participant-design",
      category: "accessibility",
      text: "Every new onboarding step needs an accessibility review before release.",
      priority: "high",
      createdAt: demoTimestamp(2),
    },
    {
      id: "constraint-4",
      participantId: "participant-design",
      category: "consistency",
      text: "New screens must reuse the existing interaction and visual patterns.",
      priority: "medium",
      createdAt: demoTimestamp(2),
    },
    {
      id: "constraint-5",
      participantId: "participant-marketing",
      category: "timing",
      text: "The campaign date cannot move.",
      priority: "high",
      createdAt: demoTimestamp(3),
    },
    {
      id: "constraint-6",
      participantId: "participant-marketing",
      category: "timing",
      text: "The product surface must stabilize before the campaign cutoff.",
      priority: "high",
      createdAt: demoTimestamp(3),
    },
  ],
  proposals: [],
  conflicts: [],
  tradeoffs: [],
  votes: [],
  approvals: [],
  activity: [
    {
      id: "event-1",
      actorType: "system",
      actorId: null,
      origin: "system",
      action: "room.created",
      entityType: "room",
      entityId: DEMO_ROOM_ID,
      sanitizedInput: {},
      result: { ok: true },
      previousRoomVersion: 0,
      resultingRoomVersion: 1,
      confirmationRequired: false,
      createdAt: demoTimestamp(0),
    },
    {
      id: "event-2",
      actorType: "participant",
      actorId: "participant-product",
      origin: "manual_ui",
      action: "position.added",
      entityType: "position",
      entityId: "position-1",
      sanitizedInput: { constraintCount: 2 },
      result: { ok: true },
      previousRoomVersion: 1,
      resultingRoomVersion: 2,
      confirmationRequired: false,
      createdAt: demoTimestamp(1),
    },
    {
      id: "event-3",
      actorType: "participant",
      actorId: "participant-design",
      origin: "simulation",
      action: "position.added",
      entityType: "position",
      entityId: "position-2",
      sanitizedInput: { constraintCount: 2 },
      result: { ok: true },
      previousRoomVersion: 2,
      resultingRoomVersion: 3,
      confirmationRequired: false,
      createdAt: demoTimestamp(2),
    },
    {
      id: "event-4",
      actorType: "participant",
      actorId: "participant-marketing",
      origin: "webmcp",
      action: "position.added",
      entityType: "position",
      entityId: "position-3",
      sanitizedInput: { constraintCount: 2 },
      result: { ok: true },
      previousRoomVersion: 3,
      resultingRoomVersion: 4,
      confirmationRequired: false,
      createdAt: demoTimestamp(3),
    },
  ],
});
