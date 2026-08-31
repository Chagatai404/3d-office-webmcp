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
  const outsiderRefreshErrors: string[] = [];
  outsider.on("console", (message) => {
    if (message.type() === "error" && message.text().includes("Room refresh failed")) {
      outsiderRefreshErrors.push(message.text());
    }
  });

  const { roomId, ownerParticipantId, passcode, inviteUrl } = await createRoomThroughOnboarding(
    creator,
    roomInput,
  );
  expect(roomId).toMatch(/^rm_[23456789ABCDEFGHJKMNPQRSTVWXYZ]{8}$/);
  expect(ownerParticipantId).toBeTruthy();
  // Exactly one generic, reusable invite capability -- never a per-seat list.
  expect(passcode).toMatch(/^[0-9A-Z]{6,}$/);
  expect(inviteUrl).toMatch(new RegExp(`^http://127\\.0\\.0\\.1:\\d+/room/${roomId}/join\\?invite=.+`));

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
  expect(orientation.data.trustedContext).toMatchObject({
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
    },
  );
  expect(orientation.data.trustedContext.participantRoles).toHaveLength(1);
  expect(JSON.stringify(orientation)).not.toContain("userId");
  expect(JSON.stringify(orientation)).not.toContain("requiredForApproval");

  await outsider.goto(`/room/${roomId}`);
  await expect(outsider.getByRole("heading", { name: "This room could not be opened" }))
    .toBeVisible();
  expect(outsiderRefreshErrors).toEqual([]);

  await creatorSession.context.close();
  await outsiderSession.context.close();
});

test("WebMCP creates a real room, requests admission, and lets the owner admit the waiting browser", async ({ browser }) => {
  test.setTimeout(90_000);
  const ownerSession = await newParticipantContext(browser);
  const mayaSession = await newParticipantContext(browser);
  const owner = ownerSession.page;
  const maya = mayaSession.page;

  await owner.goto("/");
  await expect.poll(() => toolNames(owner)).toEqual(["create_meeting", "join_meeting"]);
  const created = await callTool(owner, "create_meeting", {
    title: "Ship AI-assisted onboarding?",
    brief: "Decide whether the reduced scope can ship next release.",
    creatorName: "Ata",
    creatorRole: "Founder",
    decisionPolicy: "owner_decides",
  });
  expect(created).toMatchObject({ ok: true, data: { roomId: expect.any(String), passcode: expect.any(String) } });
  const { roomId, passcode } = created.data;
  await expect(owner).toHaveURL(`/room/${roomId}`);
  await expect(owner.getByTestId("connection-status")).toHaveText("Connected");

  await maya.goto("/join");
  await expect.poll(() => toolNames(maya)).toContain("join_meeting");
  const requested = await callTool(maya, "join_meeting", {
    method: "passcode",
    roomId,
    passcode,
    displayName: "Maya",
    role: "Engineer",
  });
  expect(requested).toMatchObject({ ok: true, data: { joinRequest: { status: "waiting" } } });
  await expect.poll(() => toolNames(maya)).toContain("get_my_join_status");
  expect(await callTool(maya, "get_my_join_status")).toMatchObject({
    ok: true,
    data: { status: "waiting", roomId },
  });

  await expect.poll(() => toolNames(owner)).toContain("get_waiting_participants");
  const waiting = await callTool(owner, "get_waiting_participants");
  const mayaRequest = waiting.data.find((request: { displayName: string }) => request.displayName === "Maya");
  expect(mayaRequest).toBeTruthy();
  expect(await callTool(owner, "admit_participant", { joinRequestId: mayaRequest.id })).toMatchObject({ ok: true });

  await expect(maya).toHaveURL(`/room/${roomId}`);
  await expect(maya.getByTestId("connection-status")).toHaveText("Connected");
  await expect.poll(() => toolNames(maya)).toContain("share_my_context");

  await ownerSession.context.close();
  await mayaSession.context.close();
});

test("two rooms stay isolated across reads, writes, WebMCP, and realtime", async ({ browser }) => {
  const ownerSession = await newParticipantContext(browser);
  const roomAPage = ownerSession.page;
  const roomA = await createRoomThroughOnboarding(roomAPage, {
    ...roomInput,
    title: "Isolation room A",
    brief: "Only room A should receive its delivery constraint.",
  });
  const roomB = await createRoomThroughOnboarding(roomAPage, {
    ...roomInput,
    title: "Isolation room B",
    brief: "Room B must remain unchanged.",
  });
  expect(roomA.roomId).not.toBe(roomB.roomId);

  const roomBPage = await ownerSession.context.newPage();
  await Promise.all([
    roomAPage.goto(`/room/${roomA.roomId}`),
    roomBPage.goto(`/room/${roomB.roomId}`),
  ]);
  await expect(roomAPage.getByTestId("connection-status")).toHaveText("Connected");
  await expect(roomBPage.getByTestId("connection-status")).toHaveText("Connected");
  await expect.poll(() => toolNames(roomAPage)).toContain("share_my_context");
  await expect.poll(() => toolNames(roomBPage)).toContain("share_my_context");

  const beforeA = await callTool(roomAPage, "get_meeting_context");
  const beforeB = await callTool(roomBPage, "get_meeting_context");
  expect(beforeA.data.trustedContext.roomId).toBe(roomA.roomId);
  expect(beforeB.data.trustedContext.roomId).toBe(roomB.roomId);

  expect(await callTool(roomAPage, "share_my_context", {
    summary: "Room A owns this context.",
    category: "delivery",
    priority: "high",
    constraints: [{
      category: "scope",
      text: "ROOM_A_ONLY_SENTINEL",
      priority: "high",
      referencedSourceIds: [],
    }],
    referencedSourceIds: [],
  })).toMatchObject({ ok: true, roomVersion: 1 });

  await expect(roomAPage.getByTestId("room-version")).toHaveText("1");
  await expect(roomBPage.getByTestId("room-version")).toHaveText("0");
  const afterB = await callTool(roomBPage, "get_meeting_context");
  expect(afterB.data.trustedContext.roomId).toBe(roomB.roomId);
  expect(afterB.data.trustedContext.stateSummary).toMatchObject({
    positionCount: 0,
    constraintCount: 0,
  });
  expect(JSON.stringify(afterB)).not.toContain("ROOM_A_ONLY_SENTINEL");
  await expect(roomBPage.getByTestId("constraints")).not.toContainText("ROOM_A_ONLY_SENTINEL");

  await ownerSession.context.close();
});
