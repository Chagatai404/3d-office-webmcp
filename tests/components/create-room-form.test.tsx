// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Home from "@/app/(flow)/page";
import { CreateRoomForm } from "@/components/onboarding/create-room-form";
import type { RoomOnboardingClient } from "@/clients/room-onboarding-client";
import type { CreatedRoom } from "@/contracts/room";

declare global { var IS_REACT_ACT_ENVIRONMENT: boolean; }

const createdRoom: CreatedRoom = {
  roomId: "rm_created-room",
  ownerParticipantId: "participant-owner",
  inviteUrl: "https://app.example/room/rm_created-room/join?invite=raw-capability",
  passcode: "AB12CD34",
};

let container: HTMLDivElement;
let root: Root;

function makeClient(createRoom: RoomOnboardingClient["createRoom"]): RoomOnboardingClient {
  return {
    createRoom,
    previewInvite: async () => ({ inviteValid: false }),
    requestJoinByPasscode: async () => {
      throw new Error("Not used by this test.");
    },
    requestJoinByInvite: async () => {
      throw new Error("Not used by this test.");
    },
    getMyJoinRequest: async () => {
      throw new Error("Not used by this test.");
    },
  };
}

function field(name: string): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  const element = container.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
    `[name="${name}"]`,
  );
  if (!element) throw new Error(`No field named ${name}.`);
  return element;
}

function setValue(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const prototype = element instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : element instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(element, value);
  element.dispatchEvent(new Event("change", { bubbles: true }));
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

async function mount(client: RoomOnboardingClient) {
  await act(async () => { root.render(<CreateRoomForm client={client} />); });
}

async function fillValidForm() {
  await act(async () => {
    setValue(field("title"), "Choose our launch approach");
    setValue(field("brief"), "Balance speed, quality, and reach.");
    setValue(field("creatorName"), "Maya");
    setValue(field("creatorRole"), "Product Manager");
  });
}

async function submit() {
  const form = container.querySelector("form");
  if (!form) throw new Error("Form missing.");
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

describe("product entry", () => {
  it("offers distinct create-room, join-meeting, and demo paths", async () => {
    await act(async () => { root.render(<Home />); });
    const links = [...container.querySelectorAll("a")];
    expect(links.some((link) => link.getAttribute("href") === "/new")).toBe(true);
    expect(links.some((link) => link.getAttribute("href") === "/join")).toBe(true);
    expect(links.some((link) => link.getAttribute("href") === "/room/demo")).toBe(true);
  });
});

describe("creator-only room form", () => {
  it("requires meeting and creator details without participant seats", async () => {
    const createRoom = vi.fn<RoomOnboardingClient["createRoom"]>();
    await mount(makeClient(createRoom));
    await submit();
    expect(createRoom).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Enter a decision title.");
    expect(container.textContent).toContain("Enter your display name.");
    expect(container.querySelector('[name^="participant-"]')).toBeNull();
    expect(container.textContent).not.toContain("Required approver");
  });

  it("sends only the new canonical creation DTO", async () => {
    const createRoom = vi.fn<RoomOnboardingClient["createRoom"]>().mockResolvedValue(createdRoom);
    await mount(makeClient(createRoom));
    await fillValidForm();
    await submit();

    expect(createRoom).toHaveBeenCalledWith({
      title: "Choose our launch approach",
      brief: "Balance speed, quality, and reach.",
      creatorName: "Maya",
      creatorRole: "Product Manager",
    });
    expect(JSON.stringify(createRoom.mock.calls[0]?.[0])).not.toMatch(
      /participants|ownerParticipantId|userId|meetingRole|decisionRole|origin|passcode|inviteUrl/,
    );
  });

  it("shows the room ID, plaintext passcode, and generic invite link only once, after creation", async () => {
    const createRoom = vi.fn<RoomOnboardingClient["createRoom"]>().mockResolvedValue(createdRoom);
    await mount(makeClient(createRoom));
    await fillValidForm();
    await submit();

    expect(container.textContent).toContain(createdRoom.roomId);
    expect(container.textContent).toContain(createdRoom.passcode);
    const inviteField = container.querySelector<HTMLInputElement>(
      'input[aria-label="Generic invite link"]',
    );
    expect(inviteField?.value).toBe(createdRoom.inviteUrl);

    const enterLink = container.querySelector<HTMLAnchorElement>(
      `a[href="/room/${createdRoom.roomId}"]`,
    );
    expect(enterLink?.textContent).toContain("Enter meeting");
  });

  it("keeps entries after a failed request and allows retry", async () => {
    const createRoom = vi.fn<RoomOnboardingClient["createRoom"]>()
      .mockRejectedValueOnce(new Error("private detail"))
      .mockResolvedValueOnce(createdRoom);
    await mount(makeClient(createRoom));
    await fillValidForm();
    await submit();
    expect(container.textContent).toContain("We couldn’t create the room.");
    expect(container.textContent).not.toContain("private detail");
    expect(field("creatorName")).toHaveProperty("value", "Maya");
    await submit();
    expect(createRoom).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain(createdRoom.roomId);
  });
});
