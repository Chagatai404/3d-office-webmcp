import { expect, test } from "@playwright/test";
import type { CreateRoomInput } from "@/contracts/room";
import {
  admitFromWaitingRoom,
  callTool,
  captureToolDefinition,
  createRoomThroughOnboarding,
  expectEnteredRoom,
  expectJoinRequestStatus,
  executeCapturedTool,
  newParticipantContext,
  requestJoinByPasscode,
} from "./helpers";

/**
 * Slice 4 end-to-end proof of the product rule: "Agents deliberate. Humans
 * intervene. Leaders decide." Alignment is shared through real WebMCP tool
 * calls (the same path `realtime-room.spec.ts` already exercises); the owner
 * lifecycle actions (decision policy, decision-role, phase advance, final
 * confirmation) go through `RoomE2EHarness`'s real controls, which call the
 * same `RoomActions` the production UI does.
 */

const roomInput: CreateRoomInput = {
  title: "Alignment and decision-policy journey",
  brief: "Should we ship the reduced-scope onboarding revision?",
  creatorName: "Ata",
  creatorRole: "Founder",
};

async function joinByPasscode(
  browser: Parameters<typeof newParticipantContext>[0],
  ownerPage: Parameters<typeof admitFromWaitingRoom>[0],
  roomId: string,
  passcode: string,
  displayName: string,
  role: string,
) {
  const session = await newParticipantContext(browser);
  await requestJoinByPasscode(session.page, { roomId, passcode, displayName, role });
  await expectJoinRequestStatus(session.page, "waiting");
  await admitFromWaitingRoom(ownerPage, displayName);
  await expectEnteredRoom(session.page, roomId);
  return session;
}

async function participantIdFor(page: import("@playwright/test").Page, displayName: string): Promise<string> {
  const id = await page.evaluate(async (name) => {
    const rows = [...document.querySelectorAll("[data-testid^='participant-kind-']")];
    const row = rows.find((el) => el.closest("article")?.textContent?.includes(name));
    return row?.getAttribute("data-testid")?.replace("participant-kind-", "") ?? null;
  }, displayName);
  if (!id) throw new Error(`No participant row found for ${displayName}.`);
  return id;
}

test("owner-decides: alignment informs but never decides, and the record preserves dissent", async ({ browser }) => {
  const ownerSession = await newParticipantContext(browser);
  const owner = ownerSession.page;
  const { roomId, passcode } = await createRoomThroughOnboarding(owner, roomInput);
  await owner.goto(`/room/${roomId}`);
  await expect(owner.getByTestId("connection-status")).toHaveText("Connected");
  await expect(owner.getByTestId("decision-policy")).toHaveText("owner_decides");

  const bobSession = await joinByPasscode(browser, owner, roomId, passcode, "Bob", "Engineer");
  const bob = bobSession.page;

  await callTool(owner, "share_my_context", {
    summary: "Ship a reduced onboarding scope on time.",
    category: "outcome",
    priority: "high",
    constraints: [],
  });
  // The WebMCP write reaches the database directly, bypassing ApiRoomClient's
  // own cached version; wait for the owner's own client to observe it via
  // realtime before a version-guarded harness action, exactly as a human
  // would (see owner-lifecycle.spec.ts's removal test for the same pattern).
  await expect(owner.getByTestId("positions")).toContainText("Ship a reduced onboarding scope on time.");
  await captureToolDefinition(owner, "share_my_context");
  await owner.getByTestId("mark-ready").click();
  await expect(owner.getByTestId("last-action")).toHaveText("Input marked ready.");
  await owner.getByTestId("advance-room-phase").click();
  await expect(owner.getByTestId("room-phase")).toHaveText("proposals");
  const staleInputTool = JSON.parse(String(await executeCapturedTool(owner, {
    summary: "Too late for Input.", category: null, priority: null, constraints: [],
  })));
  expect(staleInputTool).toMatchObject({ ok: false, error: { code: "WRONG_PHASE" } });

  const proposal = await callTool(owner, "suggest_option", {
    title: "Reduced scope onboarding",
    summary: "Ship the smallest complete onboarding scope.",
    rationale: "Fits the deadline without an authentication rewrite.",
    expectedOutcomes: ["Launch on time"],
    referencedConstraintIds: [],
  });
  expect(proposal.ok).toBe(true);
  await expect(owner.getByTestId("proposals")).toContainText("Reduced scope onboarding");

  await owner.getByTestId("advance-room-phase").click();
  await expect(owner.getByTestId("room-phase")).toHaveText("deliberation");
  await owner.getByTestId("advance-room-phase").click();
  await expect(owner.getByTestId("room-phase")).toHaveText("voting");
  await expect(bob.getByTestId("room-phase")).toHaveText("voting");

  const meetingContext = await callTool(bob, "get_meeting_context", {});
  const activeProposalId = meetingContext.data.untrustedRoomContent.activeProposal.id;

  await callTool(bob, "express_my_alignment", {
    proposalId: activeProposalId,
    choice: "strong_objection",
    comment: "We cannot safely ship this tracking scope.",
  });
  // Each WebMCP call's own version guard reads that browser tab's own
  // last-observed room state, so the owner's tab must see Bob's alignment
  // via realtime before the owner's own alignment call can carry a
  // non-stale version.
  await expect(owner.getByTestId("alignments").locator("li")).toHaveCount(1);
  await callTool(owner, "express_my_alignment", {
    proposalId: activeProposalId,
    choice: "support",
    comment: null,
  });
  await expect(owner.getByTestId("alignments").locator("li")).toHaveCount(2);
  await expect(owner.getByTestId("alignments")).toContainText("strong_objection");

  // Alignment is incomplete-agnostic: the owner may still open decision review.
  await owner.getByTestId("advance-room-phase").click();
  await expect(owner.getByTestId("room-phase")).toHaveText("approval");
  await expect(bob.getByTestId("room-phase")).toHaveText("approval");

  // Bob is present and can review the exact candidate, but is not the owner:
  // his confirmation is refused server-side, and the room stays unfinalized.
  await bob.getByLabel("I reviewed and confirm this exact final decision.").check();
  await bob.getByTestId("confirm-approval").click();
  await expect(bob.getByTestId("last-action")).toContainText("not required to approve");
  await expect(owner.getByTestId("room-phase")).toHaveText("approval");

  await owner.getByLabel("I reviewed and confirm this exact final decision.").check();
  await owner.getByTestId("confirm-approval").click();
  await expect(owner.getByTestId("room-phase")).toHaveText("finalized");
  await expect(bob.getByTestId("room-phase")).toHaveText("finalized");

  // The immutable record preserves Bob's strong objection as dissent, not a
  // vote that could have outweighed the owner's decision.
  const record = await callTool(owner, "get_decision_record", {});
  expect(record.ok).toBe(true);
  expect(record.data.alignments.some(
    (alignment: { choice: string }) => alignment.choice === "strong_objection",
  )).toBe(true);

  await ownerSession.context.close();
  await bobSession.context.close();
});
test("equal_authority_consensus: freezing requires every active decision-maker's own separate approval", async ({ browser }) => {
  const ownerSession = await newParticipantContext(browser);
  const owner = ownerSession.page;
  const { roomId, passcode, ownerParticipantId } = await createRoomThroughOnboarding(owner, roomInput);
  await owner.goto(`/room/${roomId}`);
  await expect(owner.getByTestId("connection-status")).toHaveText("Connected");

  const bobSession = await joinByPasscode(browser, owner, roomId, passcode, "Bob", "Engineer");
  const bob = bobSession.page;
  const bobParticipantId = await participantIdFor(bob, "Bob");

  await owner.getByTestId(`make-decision-maker-${bobParticipantId}`).click();
  await expect(owner.getByTestId(`participant-kind-${bobParticipantId}`)).toContainText("decision_maker");

  await owner.getByTestId("set-policy-consensus").click();
  await expect(owner.getByTestId("decision-policy")).toHaveText("equal_authority_consensus");
  await expect(bob.getByTestId("decision-policy")).toHaveText("equal_authority_consensus");

  await callTool(owner, "share_my_context", {
    summary: "Ship a reduced onboarding scope on time.",
    category: "outcome",
    priority: "high",
    constraints: [],
  });
  // The WebMCP write reaches the database directly, bypassing ApiRoomClient's
  // own cached version; wait for the owner's own client to observe it via
  // realtime before a version-guarded harness action, exactly as a human
  // would (see owner-lifecycle.spec.ts's removal test for the same pattern).
  await expect(owner.getByTestId("positions")).toContainText("Ship a reduced onboarding scope on time.");
  await owner.getByTestId("mark-ready").click();
  await expect(owner.getByTestId("last-action")).toHaveText("Input marked ready.");

  // Bob is now a required approver too (see `derive_owner_participant_authority`),
  // so -- like the owner -- he must publish a position and mark ready before
  // Input can advance.
  await callTool(bob, "share_my_context", {
    summary: "Support the reduced onboarding scope.",
    category: "outcome",
    priority: "high",
    constraints: [],
  });
  await expect(bob.getByTestId("positions")).toContainText("Support the reduced onboarding scope.");
  await bob.getByTestId("mark-ready").click();
  await expect(bob.getByTestId("last-action")).toHaveText("Input marked ready.");

  await owner.getByTestId("advance-room-phase").click();
  await expect(owner.getByTestId("room-phase")).toHaveText("proposals");
  const proposal = await callTool(owner, "suggest_option", {
    title: "Reduced scope onboarding",
    summary: "Ship the smallest complete onboarding scope.",
    rationale: "Fits the deadline without an authentication rewrite.",
    expectedOutcomes: ["Launch on time"],
    referencedConstraintIds: [],
  });
  expect(proposal.ok).toBe(true);
  await expect(owner.getByTestId("proposals")).toContainText("Reduced scope onboarding");
  await owner.getByTestId("advance-room-phase").click();
  await expect(owner.getByTestId("room-phase")).toHaveText("deliberation");
  await owner.getByTestId("advance-room-phase").click();
  await expect(owner.getByTestId("room-phase")).toHaveText("voting");

  const meetingContext = await callTool(bob, "get_meeting_context", {});
  const activeProposalId = meetingContext.data.untrustedRoomContent.activeProposal.id;
  await callTool(owner, "express_my_alignment", { proposalId: activeProposalId, choice: "support", comment: null });
  // Bob's tab must observe the owner's alignment via realtime before Bob's
  // own version-guarded WebMCP call can carry a non-stale version.
  await expect(bob.getByTestId("alignments").locator("li")).toHaveCount(1);
  await callTool(bob, "express_my_alignment", { proposalId: activeProposalId, choice: "support", comment: null });
  await expect(owner.getByTestId("alignments").locator("li")).toHaveCount(2);

  await owner.getByTestId("advance-room-phase").click();
  await expect(owner.getByTestId("room-phase")).toHaveText("approval");

  await owner.getByLabel("I reviewed and confirm this exact final decision.").check();
  await owner.getByTestId("confirm-approval").click();
  // One of two required decision-makers approved: the room does not finalize.
  await expect(owner.getByTestId("room-phase")).toHaveText("approval");
  // Bob's tab must observe the owner's approval via realtime -- confirmed by
  // the owner disappearing from Bob's own missing-approvals list -- before
  // Bob's own version-guarded approval click can carry a non-stale version.
  await expect(bob.getByTestId("missing-approvals")).not.toContainText(ownerParticipantId);
  await expect(bob.getByTestId("missing-approvals")).toContainText(bobParticipantId);

  await bob.getByLabel("I reviewed and confirm this exact final decision.").check();
  await bob.getByTestId("confirm-approval").click();
  await expect(owner.getByTestId("room-phase")).toHaveText("finalized");
  await expect(bob.getByTestId("room-phase")).toHaveText("finalized");

  await ownerSession.context.close();
  await bobSession.context.close();
});
