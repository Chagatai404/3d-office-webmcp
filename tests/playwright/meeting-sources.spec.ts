import { expect, test, type Page } from "@playwright/test";
import type { CreateRoomInput } from "@/contracts/room";
import {
  admitFromWaitingRoom,
  callTool,
  createRoomThroughOnboarding,
  expectEnteredRoom,
  expectJoinRequestStatus,
  newParticipantContext,
  requestJoinByInvite,
  toolNames,
} from "./helpers";

const roomInput: CreateRoomInput = {
  title: "Source-Backed Onboarding Decision",
  brief: "Decide the onboarding scope using the attached product context.",
  creatorName: "Maya",
  creatorRole: "Product Manager",
};

const SHARED_TEXT =
  "Launch goal: improve onboarding completion without an authentication rewrite.";
const PRIVATE_TEXT =
  "Engineering note: only two developer-weeks are available before the campaign.";

async function attachSource(
  page: Page,
  file: { name: string; mimeType: string; text: string },
  visibility: "shared_room" | "private_to_participant",
) {
  await page
    .getByTestId("source-file")
    .setInputFiles({ name: file.name, mimeType: file.mimeType, buffer: Buffer.from(file.text) });
  await page.getByTestId("source-visibility").selectOption(visibility);
  await page.getByTestId("attach-source").click();
  await expect(page.getByTestId("sources").locator("li", { hasText: file.name })).toBeVisible();
}

async function visibleSourceIds(page: Page): Promise<string[]> {
  const result = await callTool(page, "get_meeting_sources");
  return (result.data.trustedContext.sources as Array<{ id: string }>).map((s) => s.id);
}

test("owner and participant attach sources; agents read only what they may see", async ({ browser }) => {
  const ownerSession = await newParticipantContext(browser);
  const participantSession = await newParticipantContext(browser);
  const owner = ownerSession.page;
  const participant = participantSession.page;

  const { roomId, inviteUrl } = await createRoomThroughOnboarding(owner, roomInput);

  await owner.goto(`/room/${roomId}`);
  await expect(owner.getByTestId("connection-status")).toHaveText("Connected");

  // 1. Owner attaches a shared source through the visible upload control.
  await attachSource(
    owner,
    { name: "launch-brief.md", mimeType: "text/markdown", text: SHARED_TEXT },
    "shared_room",
  );

  // 2. Owner's agent discovers and reads the shared source.
  await expect.poll(() => toolNames(owner)).toContain("get_meeting_sources");
  await expect.poll(async () => (await visibleSourceIds(owner)).length).toBe(1);
  const sharedId = (await visibleSourceIds(owner))[0]!;
  await expect(owner.getByTestId(`source-status-${sharedId}`)).toHaveText("ready");
  await expect(owner.getByTestId(`source-visibility-${sharedId}`)).toHaveText("shared_room");

  const read = await callTool(owner, "read_meeting_source", {
    sourceId: sharedId,
    cursor: null,
    maxChunks: 5,
  });
  expect(read.data.untrustedRoomContent.chunks[0].text).toContain(SHARED_TEXT);

  // 3. A second participant joins and is admitted.
  await requestJoinByInvite(participant, { inviteUrl, displayName: "Devi", role: "Engineer" });
  await expectJoinRequestStatus(participant, "waiting");
  await admitFromWaitingRoom(owner, "Devi");
  await expectEnteredRoom(participant, roomId);

  // 4. The participant attaches a private source.
  await attachSource(
    participant,
    { name: "eng-note.txt", mimeType: "text/plain", text: PRIVATE_TEXT },
    "private_to_participant",
  );

  // 5. Visibility boundary: the participant's agent sees both; the owner's still sees only the shared one.
  await expect.poll(() => toolNames(participant)).toContain("get_meeting_sources");
  await expect.poll(async () => (await visibleSourceIds(participant)).length).toBe(2);
  await expect.poll(async () => (await visibleSourceIds(owner)).length).toBe(1);

  const privateId = (await visibleSourceIds(participant)).find((id) => id !== sharedId)!;

  // 6. The owner's agent cannot read the participant's private source.
  const denied = await callTool(owner, "read_meeting_source", {
    sourceId: privateId,
    cursor: null,
    maxChunks: 5,
  });
  expect(denied.error.code).toBe("NOT_AUTHORIZED");

  // 7. The participant's agent can read the shared source as meeting evidence.
  const participantRead = await callTool(participant, "read_meeting_source", {
    sourceId: sharedId,
    cursor: null,
    maxChunks: 5,
  });
  expect(participantRead.data.untrustedRoomContent.chunks[0].text).toContain(SHARED_TEXT);
});
