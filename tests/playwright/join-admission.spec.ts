import { expect, test } from "@playwright/test";
import type { CreateRoomInput } from "@/contracts/room";
import {
  admitFromWaitingRoom,
  createRoomThroughOnboarding,
  expectEnteredRoom,
  expectJoinRequestStatus,
  newParticipantContext,
  rejectFromWaitingRoom,
  requestJoinByInvite,
  requestJoinByPasscode,
} from "./helpers";

const roomInput: CreateRoomInput = {
  title: "Two-Week Onboarding Launch",
  brief: "Should we ship the onboarding update within two weeks, and at what scope?",
  creatorName: "Maya",
  creatorRole: "Product Manager",
};

test("passcode join: owner admits and both sessions see two participants", async ({ browser }) => {
  const ownerSession = await newParticipantContext(browser);
  const requesterSession = await newParticipantContext(browser);
  const owner = ownerSession.page;
  const requester = requesterSession.page;

  const { roomId, passcode, ownerParticipantId } = await createRoomThroughOnboarding(owner, roomInput);
  await owner.goto(`/room/${roomId}`);
  await expect(owner.getByTestId("connection-status")).toHaveText("Connected");

  // A wrong passcode must not create a waiting request.
  await requestJoinByPasscode(requester, {
    roomId,
    passcode: "WRONGCODE",
    displayName: "Jane",
    role: "Designer",
  });
  await expect(requester.getByTestId("join-error")).toBeVisible();
  await expect(requester.getByTestId("join-request")).toHaveCount(0);

  // The correct passcode creates a waiting request instead of a participant.
  await requestJoinByPasscode(requester, {
    roomId,
    passcode,
    displayName: "Jane",
    role: "Designer",
  });
  await expectJoinRequestStatus(requester, "waiting");

  await admitFromWaitingRoom(owner, "Jane");

  // The requester's page redirects into the room as soon as it observes
  // "admitted", so that intermediate status can be gone again by the next
  // poll -- the meaningful, stable outcome to assert is arriving in the room.
  await expectEnteredRoom(requester, roomId);

  const participantArticles = requester.locator('section[aria-label="Participant seats"] article');
  await expect(participantArticles).toHaveCount(2);

  const janeParticipant = requester.locator('section[aria-label="Participant seats"] article', {
    hasText: "Jane",
  });
  await expect(janeParticipant).toContainText("Human Participant · participant · contributor");
  await expect(janeParticipant).toContainText("Your seat");

  // The owner's own session converges to the same two-participant state.
  await expect(owner.locator('section[aria-label="Participant seats"] article')).toHaveCount(2);
  await expect(owner.getByTestId(`participant-kind-${ownerParticipantId}`)).toContainText("owner · decision_maker");

  await ownerSession.context.close();
  await requesterSession.context.close();
});

test("invite link join: a fresh browser is rejected and never enters the room", async ({ browser }) => {
  const ownerSession = await newParticipantContext(browser);
  const outsiderSession = await newParticipantContext(browser);
  const owner = ownerSession.page;
  const outsider = outsiderSession.page;

  const { roomId, inviteUrl } = await createRoomThroughOnboarding(owner, roomInput);
  await owner.goto(`/room/${roomId}`);
  await expect(owner.getByTestId("connection-status")).toHaveText("Connected");

  await requestJoinByInvite(outsider, {
    inviteUrl,
    displayName: "Alex",
    role: "Engineer",
  });
  await expect(outsider.getByTestId("preview-title")).toHaveText(roomInput.title);
  await expect(outsider.getByTestId("preview-owner-display-name")).toHaveText("Maya");
  await expectJoinRequestStatus(outsider, "waiting");

  await rejectFromWaitingRoom(owner, "Alex");

  await expectJoinRequestStatus(outsider, "rejected");
  expect(outsider.url()).not.toContain(`/room/${roomId}`);

  // Rejection must not have created a participant.
  await expect(owner.locator('section[aria-label="Participant seats"] article')).toHaveCount(1);

  await ownerSession.context.close();
  await outsiderSession.context.close();
});

test("an unknown or revoked invite token gives a safe, non-disclosing failure", async ({ browser }) => {
  const session = await newParticipantContext(browser);
  const page = session.page;

  await page.goto("/e2e/onboarding?invite=not-a-live-capability");
  await expect(page.getByTestId("invite-preview")).toBeVisible();
  await expect(page.getByTestId("invite-valid")).toHaveText("false");
  await expect(page.getByTestId("preview-title")).toHaveCount(0);

  await session.context.close();
});
