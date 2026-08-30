import { expect, test } from "@playwright/test";
import type { CreateRoomInput } from "@/contracts/room";
import {
  admitFromWaitingRoom,
  callTool,
  createRoomThroughOnboarding,
  expectEnteredRoom,
  expectJoinRequestStatus,
  newParticipantContext,
  requestJoinByPasscode,
} from "./helpers";

const roomInput: CreateRoomInput = {
  title: "Owner lifecycle journey",
  brief: "Should we ship the reduced-scope onboarding revision?",
  creatorName: "Maya",
  creatorRole: "Founder",
};

/** Admits `displayName` by passcode and returns their page + participant id. */
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

test("ownership transfer: old owner loses controls live, new owner gains them", async ({ browser }) => {
  const ownerSession = await newParticipantContext(browser);
  const owner = ownerSession.page;
  const { roomId, passcode } = await createRoomThroughOnboarding(owner, roomInput);
  await owner.goto(`/room/${roomId}`);
  await expect(owner.getByTestId("connection-status")).toHaveText("Connected");

  const bobSession = await joinByPasscode(browser, owner, roomId, passcode, "Bob", "Engineer");
  const bob = bobSession.page;

  const bobParticipantId = await bob.evaluate(async () => {
    const rows = [...document.querySelectorAll("[data-testid^='participant-kind-']")];
    const row = rows.find((el) => el.closest("article")?.textContent?.includes("Bob"));
    return row?.getAttribute("data-testid")!.replace("participant-kind-", "");
  });

  await owner.getByTestId(`transfer-owner-${bobParticipantId}`).click();

  // Both sessions converge on the new owner via realtime.
  await expect(owner.getByTestId(`participant-kind-${bobParticipantId}`)).toContainText("owner · decision_maker");

  // Old owner loses owner-only controls live, without a page reload.
  await expect(owner.getByTestId("lock-controls")).toHaveCount(0);
  await expect(owner.locator("[data-testid^='remove-']")).toHaveCount(0);
  await expect(owner.locator("[data-testid^='transfer-owner-']")).toHaveCount(0);

  // New owner gains them in the same live session.
  await expect(bob.getByTestId("lock-controls")).toBeVisible();
  await bob.getByTestId("lock-meeting").click();
  await expect(bob.getByTestId("room-locked")).toHaveText("true");

  await ownerSession.context.close();
  await bobSession.context.close();
});

test("removal: the removed participant loses room access; their history remains for the owner", async ({ browser }) => {
  const ownerSession = await newParticipantContext(browser);
  const owner = ownerSession.page;
  const { roomId, passcode } = await createRoomThroughOnboarding(owner, roomInput);
  await owner.goto(`/room/${roomId}`);
  await expect(owner.getByTestId("connection-status")).toHaveText("Connected");

  const aliceSession = await joinByPasscode(browser, owner, roomId, passcode, "Alice", "Designer");
  const alice = aliceSession.page;

  // Publish a position through WebMCP so there is real history to preserve.
  await callTool(alice, "add_my_position", {
    summary: "Preserve the existing interaction pattern.",
    category: "quality",
    priority: "high",
    constraints: [],
  });
  // Wait for the owner's own client to observe that mutation via realtime
  // before removing Alice: otherwise the owner's cached room version is
  // stale and the removal is correctly refused with STALE_ROOM_STATE instead
  // of applying -- the same optimistic-concurrency guard every mutation uses.
  await expect(owner.getByTestId("positions")).toContainText("Preserve the existing interaction pattern.");

  const aliceParticipantId = await alice.evaluate(async () => {
    const rows = [...document.querySelectorAll("[data-testid^='participant-kind-']")];
    const row = rows.find((el) => el.closest("article")?.textContent?.includes("Alice"));
    return row?.getAttribute("data-testid")!.replace("participant-kind-", "");
  });

  await owner.getByTestId(`remove-${aliceParticipantId}`).click();

  // Alice disappears from the owner's active participant roster live.
  await expect(owner.getByTestId(`participant-kind-${aliceParticipantId}`)).toHaveCount(0);

  // Alice's own session can no longer load or mutate the room.
  await alice.reload();
  await expect(alice.getByTestId("e2e-room-harness")).toHaveCount(0);

  // Historical contributions remain visible to the owner.
  await expect(owner.getByTestId("positions")).toContainText("Preserve the existing interaction pattern.");
  await expect(owner.getByTestId("activity")).toContainText("participant.removed");

  await ownerSession.context.close();
  await aliceSession.context.close();
});

test("meeting lock: refuses a new join request while locked, and allows one again after unlocking", async ({ browser }) => {
  const ownerSession = await newParticipantContext(browser);
  const owner = ownerSession.page;
  const { roomId, passcode } = await createRoomThroughOnboarding(owner, roomInput);
  await owner.goto(`/room/${roomId}`);
  await expect(owner.getByTestId("connection-status")).toHaveText("Connected");

  await owner.getByTestId("lock-meeting").click();
  await expect(owner.getByTestId("room-locked")).toHaveText("true");

  const outsiderSession = await newParticipantContext(browser);
  await requestJoinByPasscode(outsiderSession.page, {
    roomId,
    passcode,
    displayName: "Cara",
    role: "Marketing",
  });
  await expect(outsiderSession.page.getByTestId("join-error")).toBeVisible();
  await expect(outsiderSession.page.getByTestId("join-request")).toHaveCount(0);

  await owner.getByTestId("unlock-meeting").click();
  await expect(owner.getByTestId("room-locked")).toHaveText("false");

  await requestJoinByPasscode(outsiderSession.page, {
    roomId,
    passcode,
    displayName: "Cara",
    role: "Marketing",
  });
  await expectJoinRequestStatus(outsiderSession.page, "waiting");

  await ownerSession.context.close();
  await outsiderSession.context.close();
});
