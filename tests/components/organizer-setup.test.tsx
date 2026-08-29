// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OrganizerSetup } from "@/components/onboarding/organizer-setup";
import {
  clearCreatedRoomHandoff,
  stageCreatedRoomForSetup,
} from "@/components/onboarding/created-room-handoff";
import type { CreateRoomInput, CreatedRoom } from "@/contracts/room";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const roomInput: CreateRoomInput = {
  title: "Choose our launch approach",
  brief: "Balance launch speed, quality, and reach.",
  participants: [
    { name: "Maya", role: "Product Manager", requiredForApproval: false },
    { name: "Emre", role: "Engineer", requiredForApproval: true },
    { name: "Noor", role: "Designer", requiredForApproval: false },
  ],
};

const createdRoom: CreatedRoom = {
  roomId: "rm_setup-room",
  participantInvites: [
    {
      participantId: "participant-engineer",
      role: "Engineer",
      inviteUrl: "/room/rm_setup-room/join?invite=engineer-secret",
    },
    {
      participantId: "participant-designer",
      role: "Designer",
      inviteUrl: "/room/rm_setup-room/join?invite=designer-secret",
    },
  ],
};

let container: HTMLDivElement;
let root: Root;
let writeText: ReturnType<typeof vi.fn>;
let storageSetItem: ReturnType<typeof vi.spyOn>;

async function mountSetup() {
  await act(async () => {
    root.render(<OrganizerSetup roomId="rm_setup-room" />);
  });
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  clearCreatedRoomHandoff();
  writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  storageSetItem = vi.spyOn(Storage.prototype, "setItem");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  clearCreatedRoomHandoff();
  vi.restoreAllMocks();
});

describe("organizer setup", () => {
  it("renders the organizer and invitation seats from the volatile handoff", async () => {
    stageCreatedRoomForSetup(createdRoom, roomInput);
    await mountSetup();

    expect(container.textContent).toContain("Maya");
    expect(container.textContent).toContain("Product Manager");
    expect(container.textContent).toContain("You · Organizer");
    expect(container.textContent).toContain("Joined");
    expect(container.textContent).toContain("Emre");
    expect(container.textContent).toContain("Engineer");
    expect(container.textContent).toContain("Required approver");
    expect(container.textContent).toContain("Noor");

    const copyButtons = container.querySelectorAll(
      'button[aria-label^="Copy invite link"]',
    );
    expect(copyButtons).toHaveLength(2);
    expect(container.querySelector('[aria-label*="Maya"]')).toBeNull();
    expect(container.textContent).not.toContain("engineer-secret");
    expect(container.textContent).not.toContain("designer-secret");
  });

  it("copies the distinct canonical URL for each invitation seat", async () => {
    stageCreatedRoomForSetup(createdRoom, roomInput);
    await mountSetup();

    const engineerCopy = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Copy invite link for Emre, Engineer"]',
    );
    const designerCopy = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Copy invite link for Noor, Designer"]',
    );
    if (!engineerCopy || !designerCopy) throw new Error("Copy controls are missing.");

    await click(engineerCopy);
    expect(writeText).toHaveBeenLastCalledWith(
      "/room/rm_setup-room/join?invite=engineer-secret",
    );
    expect(container.textContent).toContain("Invitation for Emre copied.");

    await click(designerCopy);
    expect(writeText).toHaveBeenLastCalledWith(
      "/room/rm_setup-room/join?invite=designer-secret",
    );
    expect(writeText).toHaveBeenCalledTimes(2);
    expect(storageSetItem).not.toHaveBeenCalled();
  });

  it("renders a graceful recovery state when the volatile handoff is gone", async () => {
    await mountSetup();

    expect(container.textContent).toContain("The room is safe. The links are gone.");
    expect(container.textContent).toContain("they can’t be recovered here");
    expect(container.querySelector('a[href="/room/rm_setup-room"]')).toBeTruthy();
    expect(container.querySelectorAll('button[aria-label^="Copy invite link"]')).toHaveLength(0);
    expect(storageSetItem).not.toHaveBeenCalled();
  });
});
