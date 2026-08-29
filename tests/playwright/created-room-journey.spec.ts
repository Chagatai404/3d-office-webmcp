import { expect, test } from "@playwright/test";
import type { CreateRoomInput } from "@/contracts/room";
import {
  apiPost,
  callTool,
  claimAndEnterRoom,
  createRoomThroughOnboarding,
  expectRoomVersion,
  inviteTokenOf,
  newParticipantContext,
  openInviteLink,
  toolNames,
} from "./helpers";

/**
 * The organizer is deliberately *not* a required approver.
 *
 * Room authority and decision authority are different things: the organizer
 * moves the room forward, and only the required humans can approve. The first
 * listed participant becomes the organizer's own seat, so Maya is both.
 */
const roomInput: CreateRoomInput = {
  title: "Two-Week Onboarding Launch",
  brief: "Should we ship the onboarding update within two weeks, and at what scope?",
  participants: [
    { name: "Maya", role: "Product Manager", requiredForApproval: false },
    { name: "Emre", role: "Engineer", requiredForApproval: true },
    { name: "Lina", role: "Designer", requiredForApproval: true },
  ],
};

const CAPACITY_CONSTRAINT = "No authentication rewrite in this milestone.";
const ACCESSIBILITY_CONSTRAINT = "Keyboard and screen-reader order must be reviewed.";
const OBJECTION = "The hint focus order has not been reviewed for screen readers.";

interface ToolConstraint {
  id: string;
  text: string;
}

interface ToolPositionGroup {
  constraints: ToolConstraint[];
}

function constraintId(listPositionsResult: { data: { participantPositions: ToolPositionGroup[] } }, text: string) {
  const found = listPositionsResult.data.participantPositions
    .flatMap((group) => group.constraints)
    .find((constraint) => constraint.text === text);
  if (!found) throw new Error(`No constraint reads "${text}".`);
  return found.id;
}

/**
 * The cross-layer proof for a real, non-demo room.
 *
 * Nothing here is seeded: the room is created at runtime by an organizer whose
 * identity comes from their own anonymous session, the other two humans arrive
 * through single-use invitation capabilities, and the room reaches an immutable
 * decision without a single `/api/dev/...` call. Every authority boundary is
 * probed from both the WebMCP path and the plain HTTP path, because the server
 * is the only thing enforcing them.
 */
test("a runtime-created room carries three humans from invitation to an immutable decision", async ({ browser }) => {
  test.setTimeout(240_000);

  const organizerSession = await newParticipantContext(browser);
  const engineerSession = await newParticipantContext(browser);
  const designerSession = await newParticipantContext(browser);
  const bystanderSession = await newParticipantContext(browser);
  const organizer = organizerSession.page;
  const engineer = engineerSession.page;
  const designer = designerSession.page;
  const bystander = bystanderSession.page;

  // A-501/A-502 — creation returns an opaque room id and one distinct
  // capability per invited seat.
  const { roomId, invites } = await createRoomThroughOnboarding(organizer, roomInput);
  expect(roomId).toMatch(/^rm_[23456789ABCDEFGHJKMNPQRSTVWXYZ]{8}$/);
  expect(invites.map((invite) => invite.role)).toEqual(["Engineer", "Designer"]);

  const engineerInvite = invites[0]!;
  const designerInvite = invites[1]!;
  const engineerToken = inviteTokenOf(engineerInvite.inviteUrl);
  const designerToken = inviteTokenOf(designerInvite.inviteUrl);
  for (const invite of invites) {
    expect(new URL(invite.inviteUrl).pathname).toBe(`/room/${roomId}/join`);
  }
  expect(engineerToken).toMatch(/^[0-9a-f]{64}$/);
  expect(designerToken).toMatch(/^[0-9a-f]{64}$/);
  expect(engineerToken).not.toBe(designerToken);

  await organizer.goto(`/room/${roomId}`);
  await expect(organizer.getByTestId("connection-status")).toHaveText("Connected");
  await expect(organizer.getByTestId("room-id")).toHaveText(roomId);
  await expect(organizer.getByTestId("room-phase")).toHaveText("input");
  await expectRoomVersion(organizer, 0);
  // A real room offers no demo controls, because the demo endpoints refuse it.
  await expect(organizer.getByTestId("demo-controls")).toHaveCount(0);

  const organizerOrientation = await callTool(organizer, "get_meeting_context");
  expect(organizerOrientation.data.currentParticipant).toMatchObject({
    name: "Maya",
    role: "Product Manager",
    requiredForApproval: false,
  });
  const organizerSeat: string = organizerOrientation.data.currentParticipant.participantId;
  await expect(organizer.getByTestId(`participant-status-${organizerSeat}`)).toHaveText("Your seat");
  await expect(organizer.getByTestId(`participant-status-${engineerInvite.participantId}`))
    .toHaveText("Available");
  await expect(organizer.getByTestId(`participant-status-${designerInvite.participantId}`))
    .toHaveText("Available");

  // SEC-10 — a session that holds no seat cannot open the private room at all.
  await bystander.goto(`/room/${roomId}`);
  await expect(bystander.getByRole("heading", { name: "This room could not be opened" }))
    .toBeVisible();

  // A-503 — the invite link previews exactly the safe pre-membership fields
  // and nothing else, then claims its one predetermined seat and redirects.
  await openInviteLink(engineer, engineerInvite.inviteUrl);
  await expect(engineer.getByTestId("invite-valid")).toHaveText("true");
  await expect(engineer.getByTestId("invite-already-claimed")).toHaveText("false");
  await expect(engineer.getByTestId("preview-room-id")).toHaveText(roomId);
  await expect(engineer.getByTestId("preview-title")).toHaveText(roomInput.title);
  await expect(engineer.getByTestId("preview-participant-name")).toHaveText("Emre");
  await expect(engineer.getByTestId("preview-participant-role")).toHaveText("Engineer");
  const previewPayload = JSON.parse(
    await engineer.getByTestId("invite-preview-json").innerText(),
  );
  expect(Object.keys(previewPayload).sort()).toEqual([
    "alreadyClaimed",
    "brief",
    "inviteValid",
    "participant",
    "roomId",
    "title",
  ]);
  expect(Object.keys(previewPayload.participant).sort()).toEqual(["id", "name", "role"]);
  await claimAndEnterRoom(engineer, roomId);
  await expectRoomVersion(engineer, 1);

  // A-504 — the second capability opens a different seat in the same room.
  await openInviteLink(designer, designerInvite.inviteUrl);
  await expect(designer.getByTestId("preview-participant-role")).toHaveText("Designer");
  await claimAndEnterRoom(designer, roomId);

  // A-505 — the organizer learns about both joins through realtime alone.
  await expect(organizer.getByTestId(`participant-status-${engineerInvite.participantId}`))
    .toHaveText("Claimed");
  await expect(organizer.getByTestId(`participant-status-${designerInvite.participantId}`))
    .toHaveText("Claimed");
  await expectRoomVersion(organizer, 2);
  await expect(organizer.getByTestId("activity")).toContainText("participant.seat_claimed · manual_ui · v2");

  // A-411 for a created room — three contexts, three participant authorities.
  const engineerOrientation = await callTool(engineer, "get_meeting_context");
  const designerOrientation = await callTool(designer, "get_meeting_context");
  expect(engineerOrientation.data.currentParticipant.participantId)
    .toBe(engineerInvite.participantId);
  expect(designerOrientation.data.currentParticipant.participantId)
    .toBe(designerInvite.participantId);
  expect(engineerOrientation.data.roomId).toBe(roomId);
  expect(designerOrientation.data.roomId).toBe(roomId);
  // SEC-07 — the raw capability never reaches canonical room state.
  expect(JSON.stringify(engineerOrientation)).not.toContain(engineerToken);
  expect(JSON.stringify(engineerOrientation)).not.toContain(designerToken);

  // SEC-03 — the organizer cannot write into another participant's seat, even
  // over plain HTTP: the position schema is strict and carries no participant.
  const impersonatedPosition = await apiPost(organizer, `/api/rooms/${roomId}/positions`, {
    summary: "Written into the Engineer's seat by the organizer.",
    category: null,
    priority: null,
    constraints: [],
    participantId: engineerInvite.participantId,
  }, { "If-Match": "2" });
  expect(impersonatedPosition).toMatchObject({
    ok: false,
    error: { code: "VALIDATION_ERROR" },
    roomVersion: 2,
  });
  await expect(engineer.getByTestId("positions")).toBeEmpty();

  // A-506 — one agent's write becomes every other context's canonical state.
  const engineerPosition = await callTool(engineer, "add_my_position", {
    summary: "Ship an accessible thin slice inside the two-week window.",
    category: "delivery",
    priority: "critical",
    constraints: [{ category: "capacity", text: CAPACITY_CONSTRAINT, priority: "critical" }],
  });
  expect(engineerPosition).toMatchObject({ ok: true, roomVersion: 3 });
  await expect(organizer.getByTestId("constraints")).toContainText(CAPACITY_CONSTRAINT);
  await expect(designer.getByTestId("constraints")).toContainText(CAPACITY_CONSTRAINT);
  await expect(organizer.getByTestId("activity")).toContainText("position.added · webmcp · v3");

  await expectRoomVersion(designer, 3);
  const designerPosition = await callTool(designer, "add_my_position", {
    summary: "Keep the onboarding change accessible from the first release.",
    category: "quality",
    priority: "critical",
    constraints: [{
      category: "accessibility",
      text: ACCESSIBILITY_CONSTRAINT,
      priority: "critical",
    }],
  });
  expect(designerPosition).toMatchObject({ ok: true, roomVersion: 4 });
  await expect(engineer.getByTestId("constraints")).toContainText(ACCESSIBILITY_CONSTRAINT);

  await expectRoomVersion(organizer, 4);
  const organizerPosition = await callTool(organizer, "add_my_position", {
    summary: "Improve onboarding completion without moving the launch date.",
    category: "outcome",
    priority: "high",
    constraints: [],
  });
  expect(organizerPosition).toMatchObject({ ok: true, roomVersion: 5 });
  // The organizer's legitimate write landed on the organizer's own seat.
  const positionsAfterInput: Array<{ participantId: string }> =
    (await callTool(organizer, "get_meeting_context")).data.positions;
  expect(positionsAfterInput.filter((position) => position.participantId === organizerSeat))
    .toHaveLength(1);
  expect(positionsAfterInput.filter(
    (position) => position.participantId === engineerInvite.participantId,
  )).toHaveLength(1);

  // A WebMCP write reaches the database directly, so every context — including
  // the writer's own — learns the new version through realtime. Each UI-driven
  // mutation below waits for that to land, exactly as a human would.
  await expectRoomVersion(organizer, 5);
  await expectRoomVersion(engineer, 5);
  await expectRoomVersion(designer, 5);

  // A-318 for a created room — the organizer cannot start proposals before
  // every required participant has declared their input complete.
  await organizer.getByTestId("advance-room-phase").click();
  await expect(organizer.getByTestId("last-action")).toHaveText(
    "Every required participant must mark their input ready before proposals begin.",
  );
  await expect(organizer.getByTestId("room-phase")).toHaveText("input");
  await expectRoomVersion(organizer, 5);

  // A-317 for a created room — a seated non-organizer cannot advance the room.
  await engineer.getByTestId("advance-room-phase").click();
  await expect(engineer.getByTestId("last-action")).toHaveText(
    "Only the room organizer may advance the room phase.",
  );
  await expectRoomVersion(engineer, 5);

  // A-507 — readiness, then the organizer starts proposals through the
  // production route.
  await engineer.getByTestId("mark-ready").click();
  await expect(organizer.getByTestId(`participant-ready-${engineerInvite.participantId}`))
    .toHaveText("Ready");
  await expectRoomVersion(organizer, 6);
  await designer.getByTestId("mark-ready").click();
  await expect(organizer.getByTestId(`participant-ready-${designerInvite.participantId}`))
    .toHaveText("Ready");
  await expectRoomVersion(organizer, 7);

  await organizer.getByTestId("advance-room-phase").click();
  await expect(organizer.getByTestId("room-phase")).toHaveText("proposals");
  await expect(engineer.getByTestId("room-phase")).toHaveText("proposals");
  await expectRoomVersion(designer, 8);
  await expect(organizer.getByTestId("activity")).toContainText("room.phase_advanced · manual_ui · v8");

  // The demo-only endpoint is enabled in this environment and still refuses a
  // real room, so nothing above could have come from `/api/dev/...`.
  const devPhaseAttempt = await apiPost(
    organizer,
    `/api/dev/rooms/${roomId}/phase`,
    { phase: "deliberation" },
    { "If-Match": "8" },
  );
  expect(devPhaseAttempt).toMatchObject({
    ok: false,
    error: { code: "NOT_AUTHORIZED" },
    roomVersion: 8,
  });
  await expect(organizer.getByTestId("room-phase")).toHaveText("proposals");

  await expect.poll(() => toolNames(engineer)).toEqual([
    "get_meeting_context",
    "list_positions",
    "submit_proposal",
  ]);
  await expectRoomVersion(engineer, 8);
  const listed = await callTool(engineer, "list_positions");
  const capacityConstraintId = constraintId(listed, CAPACITY_CONSTRAINT);
  const accessibilityConstraintId = constraintId(listed, ACCESSIBILITY_CONSTRAINT);

  // SEC-13 — a constraint belonging to another room is rejected inside the
  // same transaction, so nothing is written.
  const crossRoomProposal = await callTool(engineer, "submit_proposal", {
    title: "Proposal referencing another room",
    summary: "References a constraint that belongs to the seeded demo room.",
    rationale: "Cross-room reference attempt.",
    expectedOutcomes: ["Should never be recorded"],
    referencedConstraintIds: [capacityConstraintId, "constraint-engineering-auth"],
  });
  expect(crossRoomProposal).toMatchObject({
    ok: false,
    error: { code: "VALIDATION_ERROR" },
    roomVersion: 8,
  });
  await expect(designer.getByTestId("proposals")).not.toContainText(
    "Proposal referencing another room",
  );

  // A-508 — a proposal from one context reaches the others.
  const proposalResult = await callTool(engineer, "submit_proposal", {
    title: "Progressive onboarding hints",
    summary: "Add two hints to the existing onboarding flow.",
    rationale: "Fits the two-week capacity without an authentication rewrite.",
    expectedOutcomes: ["Faster first value"],
    referencedConstraintIds: [capacityConstraintId, accessibilityConstraintId],
  });
  expect(proposalResult).toMatchObject({ ok: true, roomVersion: 9 });
  await expect(designer.getByTestId("proposals")).toContainText("Progressive onboarding hints");
  await expect(organizer.getByTestId("activity")).toContainText("proposal.submitted · webmcp · v9");
  const originalProposalId: string =
    (await callTool(engineer, "get_meeting_context")).data.activeProposal.id;

  await expectRoomVersion(organizer, 9);
  await organizer.getByTestId("advance-room-phase").click();
  await expect(designer.getByTestId("room-phase")).toHaveText("deliberation");
  await expectRoomVersion(designer, 10);

  // A-509 — a different participant objects, through the visible UI.
  await designer.getByTestId("objection-form").getByLabel("Related constraint")
    .selectOption(accessibilityConstraintId);
  await designer.getByTestId("objection-form").getByLabel("Reason").fill(OBJECTION);
  await designer.getByTestId("objection-form").getByRole("button").click();
  await expect(engineer.getByTestId("conflicts")).toContainText(OBJECTION);
  await expect(organizer.getByTestId("activity")).toContainText("objection.raised · manual_ui · v11");

  await expectRoomVersion(engineer, 11);
  const openIssues = await callTool(engineer, "get_open_issues");
  expect(openIssues.data.openIssues).toHaveLength(1);
  expect(openIssues.data.openIssues[0]).toMatchObject({
    proposal: { title: "Progressive onboarding hints" },
    constraint: { id: accessibilityConstraintId },
    raisedBy: { actorId: designerInvite.participantId, displayName: "Lina" },
    severity: "blocking",
    status: "open",
  });

  // A-510 — the revision is a child of the proposal it supersedes.
  const tradeoffResult = await callTool(engineer, "propose_tradeoff", {
    conflictIds: [openIssues.data.openIssues[0].conflictId],
    description: "Keep the thin slice and document the accessible focus order.",
    expectedEffect: "Answers the objection without extending the two-week scope.",
    revisedProposal: {
      title: "Accessible progressive onboarding hints",
      summary: "Add two hints with a documented keyboard and screen-reader order.",
      rationale: "Preserves the delivery scope and satisfies the accessibility concern.",
      expectedOutcomes: ["Faster first value", "Accessible navigation"],
      referencedConstraintIds: [capacityConstraintId, accessibilityConstraintId],
    },
  });
  expect(tradeoffResult).toMatchObject({ ok: true, roomVersion: 12 });
  await expect(designer.getByTestId("proposal-lineage"))
    .toContainText("Progressive onboarding hints ← root");
  await expect(designer.getByTestId("proposal-lineage"))
    .toContainText("Accessible progressive onboarding hints ← Progressive onboarding hints");
  await expect(designer.getByTestId("proposals")).toContainText("(superseded)");
  await expect(organizer.getByTestId("tradeoffs")).toContainText("document the accessible focus order");

  // A-511 — a revision is not a resolution: voting stays closed until the
  // objection is explicitly resolved by a participant.
  await expectRoomVersion(organizer, 12);
  await organizer.getByTestId("advance-room-phase").click();
  await expect(organizer.getByTestId("last-action")).toHaveText("A blocking conflict prevents voting.");
  await expect(organizer.getByTestId("room-phase")).toHaveText("deliberation");
  await expectRoomVersion(organizer, 12);

  await expectRoomVersion(designer, 12);
  await designer.getByTestId("resolution-controls").getByRole("button").click();
  await expectRoomVersion(organizer, 13);
  await expect(organizer.getByTestId("conflicts")).toBeEmpty();
  await expect(organizer.getByTestId("activity")).toContainText("conflict.resolved · manual_ui · v13");

  await organizer.getByTestId("advance-room-phase").click();
  await expect(engineer.getByTestId("room-phase")).toHaveText("voting");
  await expectRoomVersion(designer, 14);

  // A-512 — voting is scoped to the caller's own seat on both paths.
  await expect.poll(() => toolNames(organizer)).toEqual([
    "cast_my_vote",
    "get_meeting_context",
    "get_open_issues",
  ]);
  await expectRoomVersion(organizer, 14);
  await expectRoomVersion(engineer, 14);
  const votingContext = await callTool(organizer, "get_meeting_context");
  const activeProposalId: string = votingContext.data.activeProposal.id;
  expect(activeProposalId).not.toBe(originalProposalId);

  // SEC-04 — through WebMCP…
  const impersonatedVote = await callTool(organizer, "cast_my_vote", {
    proposalId: activeProposalId,
    choice: "oppose",
    comment: null,
    participantId: designerInvite.participantId,
  });
  expect(impersonatedVote).toMatchObject({
    ok: false,
    error: { code: "VALIDATION_ERROR" },
    roomVersion: 14,
  });
  // …and through plain HTTP, which is no weaker.
  const impersonatedHttpVote = await apiPost(organizer, `/api/rooms/${roomId}/votes`, {
    proposalId: activeProposalId,
    choice: "oppose",
    comment: null,
    participantId: designerInvite.participantId,
  }, { "If-Match": "14" });
  expect(impersonatedHttpVote).toMatchObject({
    ok: false,
    error: { code: "VALIDATION_ERROR" },
    roomVersion: 14,
  });
  await expect(organizer.getByTestId("votes")).toBeEmpty();

  // SEC-14 — a mutation carrying a stale version writes nothing.
  const staleVote = await apiPost(engineer, `/api/rooms/${roomId}/votes`, {
    proposalId: activeProposalId,
    choice: "support",
    comment: null,
  }, { "If-Match": "9" });
  expect(staleVote).toMatchObject({
    ok: false,
    error: { code: "STALE_ROOM_STATE" },
    roomVersion: 14,
  });
  await expect(engineer.getByTestId("votes")).toBeEmpty();

  expect(await callTool(engineer, "cast_my_vote", {
    proposalId: activeProposalId,
    choice: "support",
    comment: "Fits the remaining capacity.",
  })).toMatchObject({ ok: true, roomVersion: 15 });
  await expectRoomVersion(designer, 15);
  expect(await callTool(designer, "cast_my_vote", {
    proposalId: activeProposalId,
    choice: "support",
    comment: "The documented focus order is acceptable.",
  })).toMatchObject({ ok: true, roomVersion: 16 });
  await expectRoomVersion(organizer, 16);
  expect(await callTool(organizer, "cast_my_vote", {
    proposalId: activeProposalId,
    choice: "support",
    comment: "Ready for the required approvals.",
  })).toMatchObject({ ok: true, roomVersion: 17 });

  await expect(designer.getByTestId("votes").locator("li")).toHaveCount(3);
  await expect(designer.getByTestId("votes"))
    .toContainText(`${engineerInvite.participantId}: support`);
  await expect(designer.getByTestId("votes"))
    .toContainText(`${designerInvite.participantId}: support`);
  // SEC-16 — three support votes are still not an approval.
  await expect(designer.getByTestId("approvals")).toBeEmpty();

  await expectRoomVersion(organizer, 17);
  await organizer.getByTestId("advance-room-phase").click();
  await expect(organizer.getByTestId("room-phase")).toHaveText("approval");
  await expectRoomVersion(engineer, 18);
  await expect(engineer.getByTestId("approvals")).toBeEmpty();

  // A-513 — every context reviews the identical decision under one hash.
  await expect.poll(() => toolNames(engineer)).toEqual([
    "approve_final_decision",
    "get_meeting_context",
    "preview_final_decision",
  ]);
  await expectRoomVersion(organizer, 18);
  const engineerPreview = await callTool(engineer, "preview_final_decision");
  const designerPreview = await callTool(designer, "preview_final_decision");
  const organizerPreview = await callTool(organizer, "preview_final_decision");
  expect(engineerPreview.ok).toBe(true);
  expect(designerPreview.data).toEqual(engineerPreview.data);
  expect(organizerPreview.data).toEqual(engineerPreview.data);
  expect(engineerPreview.data.proposal.title).toBe("Accessible progressive onboarding hints");
  expect(engineerPreview.data.proposal.parentProposalId).toBe(originalProposalId);
  expect(engineerPreview.data.approvals).toEqual([]);
  expect([...engineerPreview.data.requiredApprovalParticipantIds].sort()).toEqual(
    [engineerInvite.participantId, designerInvite.participantId].sort(),
  );
  const decisionHash: string = engineerPreview.data.decisionHash;
  await expect(engineer.getByTestId("decision-hash")).toHaveText(decisionHash);
  await expect(designer.getByTestId("decision-hash")).toHaveText(decisionHash);
  await expect(organizer.getByTestId("decision-hash")).toHaveText(decisionHash);

  // SEC-05 — the organizer is not a required approver and cannot approve at
  // all, with or without a confirmation header, for themselves or anyone else.
  expect(await callTool(organizer, "approve_final_decision", { decisionHash })).toMatchObject({
    ok: false,
    error: { code: "NOT_AUTHORIZED" },
    roomVersion: 18,
  });
  expect(await apiPost(
    organizer,
    `/api/rooms/${roomId}/approval`,
    { decisionHash },
    { "If-Match": "18", "X-Human-Confirmed": "true" },
  )).toMatchObject({ ok: false, error: { code: "NOT_AUTHORIZED" }, roomVersion: 18 });
  expect(await apiPost(
    organizer,
    `/api/rooms/${roomId}/approval`,
    { decisionHash, participantId: engineerInvite.participantId },
    { "If-Match": "18", "X-Human-Confirmed": "true" },
  )).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" }, roomVersion: 18 });

  // SEC-17 — approval is bound to the exact decision that was reviewed.
  expect(await callTool(engineer, "approve_final_decision", {
    decisionHash: "0".repeat(decisionHash.length),
  })).toMatchObject({ ok: false, error: { code: "DECISION_CHANGED" }, roomVersion: 18 });

  // A-514 — each required human approves independently, and SEC-18: WebMCP
  // cannot supply the confirmation, only the visible checkbox can.
  expect(await callTool(engineer, "approve_final_decision", { decisionHash })).toMatchObject({
    ok: false,
    error: { code: "HUMAN_CONFIRMATION_REQUIRED" },
    roomVersion: 18,
  });
  await expectRoomVersion(engineer, 18);
  await engineer.getByLabel("I reviewed and confirm this exact final decision.").check();
  await engineer.getByTestId("confirm-approval").click();
  await expectRoomVersion(designer, 19);
  await expect(designer.getByTestId("room-phase")).toHaveText("approval");
  await expect(designer.getByTestId("approvals")).toContainText(engineerInvite.participantId);
  await expect(designer.getByTestId("missing-approvals")).toContainText(designerInvite.participantId);

  expect(await callTool(designer, "approve_final_decision", { decisionHash })).toMatchObject({
    ok: false,
    error: { code: "HUMAN_CONFIRMATION_REQUIRED" },
    roomVersion: 19,
  });
  await designer.getByLabel("I reviewed and confirm this exact final decision.").check();
  await designer.getByTestId("confirm-approval").click();

  // A-515 — the last required approval finalizes, and nothing can move after.
  await expect(organizer.getByTestId("room-phase")).toHaveText("finalized");
  await expect(engineer.getByTestId("room-phase")).toHaveText("finalized");
  await expectRoomVersion(designer, 20);
  await expect(organizer.getByTestId("finalized-at")).toBeVisible();
  await expect.poll(() => toolNames(engineer)).toEqual(["get_decision_record"]);

  const engineerRecord = await callTool(engineer, "get_decision_record");
  const designerRecord = await callTool(designer, "get_decision_record");
  const organizerRecord = await callTool(organizer, "get_decision_record");
  expect(engineerRecord.ok).toBe(true);
  expect(designerRecord.data).toEqual(engineerRecord.data);
  expect(organizerRecord.data).toEqual(engineerRecord.data);
  expect(engineerRecord.data.roomId).toBe(roomId);
  expect(engineerRecord.data.decision.decisionHash).toBe(decisionHash);
  expect(engineerRecord.data.decision.proposal.parentProposalId).toBe(originalProposalId);
  expect(engineerRecord.data.votes).toHaveLength(3);
  expect(engineerRecord.data.approvals.map(
    (approval: { participantId: string }) => approval.participantId,
  ).sort()).toEqual([engineerInvite.participantId, designerInvite.participantId].sort());

  const provenance: Array<{ action: string; origin: string }> = engineerRecord.data.provenance;
  expect(provenance.some((event) => event.action === "room.created")).toBe(true);
  expect(provenance.filter((event) => event.action === "participant.seat_claimed")).toHaveLength(2);
  expect(provenance.filter((event) => event.action === "participant.input_ready")).toHaveLength(2);
  expect(provenance.filter((event) => event.action === "room.phase_advanced")).toHaveLength(4);
  // Nothing in a real room was simulated.
  expect(provenance.every((event) => event.origin !== "simulation")).toBe(true);

  // SEC-15 — the finalized room is immutable on every path.
  expect(await apiPost(engineer, `/api/rooms/${roomId}/votes`, {
    proposalId: activeProposalId,
    choice: "oppose",
    comment: "Too late",
  }, { "If-Match": "20" })).toMatchObject({
    ok: false,
    error: { code: "ALREADY_FINALIZED" },
    roomVersion: 20,
  });
  expect(await apiPost(organizer, `/api/rooms/${roomId}/phase`, {
    phase: "finalized",
  }, { "If-Match": "20" })).toMatchObject({
    ok: false,
    error: { code: "ALREADY_FINALIZED" },
    roomVersion: 20,
  });
  await expectRoomVersion(organizer, 20);

  await Promise.all([
    organizerSession.context.close(),
    engineerSession.context.close(),
    designerSession.context.close(),
    bystanderSession.context.close(),
  ]);
});
