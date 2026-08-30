import { expect, test } from "@playwright/test";
import type { CreateRoomInput } from "@/contracts/room";
import {
  callTool,
  createRoomThroughOnboarding,
  newParticipantContext,
  toolNames,
} from "./helpers";

const roomInput: CreateRoomInput = {
  title: "Two-Week Onboarding Launch",
  brief: "Should we ship the onboarding update within two weeks, and at what scope?",
  creatorName: "Maya",
  creatorRole: "Product Manager",
};

test("normal creation binds one authenticated owner and creates no seats", async ({ browser }) => {
  const creatorSession = await newParticipantContext(browser);
  const outsiderSession = await newParticipantContext(browser);
  const creator = creatorSession.page;
  const outsider = outsiderSession.page;

  const { roomId, ownerParticipantId, passcode, inviteUrl } = await createRoomThroughOnboarding(
    creator,
    roomInput,
  );
  expect(roomId).toMatch(/^rm_[23456789ABCDEFGHJKMNPQRSTVWXYZ]{8}$/);
  expect(ownerParticipantId).toBeTruthy();
  // Exactly one generic, reusable invite capability -- never a per-seat list.
  expect(passcode).toMatch(/^[0-9A-Z]{6,}$/);
  expect(inviteUrl).toMatch(new RegExp(`^http://127\\.0\\.0\\.1:3000/room/${roomId}/join\\?invite=.+`));

  await creator.goto(`/room/${roomId}`);
  await expect(creator.getByTestId("connection-status")).toHaveText("Connected");
  await expect(creator.getByTestId("room-phase")).toHaveText("input");
  await expect(creator.getByTestId("room-version")).toHaveText("0");
  await expect(creator.getByTestId("demo-controls")).toHaveCount(0);

  const participantArticles = creator.locator('section[aria-label="Participant seats"] article');
  await expect(participantArticles).toHaveCount(1);
  await expect(creator.getByTestId(`participant-kind-${ownerParticipantId}`)).toHaveText(
    "Human Participant · owner · decision_maker",
  );
  await expect(creator.getByTestId(`participant-status-${ownerParticipantId}`)).toHaveText(
    "Your seat",
  );

  await expect.poll(() => toolNames(creator)).toContain("get_meeting_context");
  const orientation = await callTool(creator, "get_meeting_context");
  expect(orientation.data).toMatchObject({
    roomId,
    phase: "input",
    roomVersion: 0,
    ownerParticipantId,
    decisionPolicy: "owner_decides",
    currentParticipant: {
      participantId: ownerParticipantId,
      name: "Maya",
      role: "Product Manager",
      kind: "human",
      meetingRole: "owner",
      decisionRole: "decision_maker",
    },
  });
  expect(orientation.data.participantRoles).toHaveLength(1);
  expect(JSON.stringify(orientation)).not.toContain("userId");
  expect(JSON.stringify(orientation)).not.toContain("requiredForApproval");

  await outsider.goto(`/room/${roomId}`);
  await expect(outsider.getByRole("heading", { name: "This room could not be opened" }))
    .toBeVisible();

  await creatorSession.context.close();
  await outsiderSession.context.close();
});
