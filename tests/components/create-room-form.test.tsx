// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Home from "@/app/(flow)/page";
import { CreateRoomForm } from "@/components/onboarding/create-room-form";
import { clearCreatedRoomHandoff } from "@/components/onboarding/created-room-handoff";
import type { RoomOnboardingClient } from "@/clients/room-onboarding-client";
import type { CreatedRoom } from "@/contracts/room";

const navigation = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: navigation.push }),
}));

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const createdRoom: CreatedRoom = {
  roomId: "rm_created-room",
  participantInvites: [
    {
      participantId: "participant-engineer",
      role: "Engineer",
      inviteUrl: "/room/rm_created-room/join?invite=secret-capability",
    },
  ],
};

let container: HTMLDivElement;
let root: Root;

function makeClient(
  createRoom: RoomOnboardingClient["createRoom"],
): RoomOnboardingClient {
  return {
    createRoom,
    previewInvitation: async () => ({
      inviteValid: false,
      alreadyClaimed: false,
    }),
    claimInvitation: async () => ({
      ok: false,
      error: { code: "NOT_AUTHORIZED", message: "Not used by this test." },
      roomVersion: 0,
    }),
  };
}

async function mountForm(client: RoomOnboardingClient) {
  await act(async () => {
    root.render(<CreateRoomForm client={client} />);
  });
}

function requireField(
  name: string,
): HTMLInputElement | HTMLTextAreaElement {
  const field = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    `[name="${name}"]`,
  );
  if (!field) throw new Error(`No field named "${name}".`);
  return field;
}

function setValue(
  element: HTMLInputElement | HTMLTextAreaElement,
  value: string,
) {
  const prototype =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

async function fillValidForm() {
  await act(async () => {
    setValue(requireField("title"), "Choose our launch approach");
    setValue(
      requireField("brief"),
      "Decide how to launch while balancing speed, quality, and reach.",
    );
    ["Maya", "Emre", "Noor", "Lena"].forEach((name, index) => {
      setValue(requireField(`participant-${index}-name`), name);
    });
  });
}

async function submitForm() {
  const form = container.querySelector("form");
  if (!form) throw new Error("The create-room form is not rendered.");
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  navigation.push.mockReset();
  clearCreatedRoomHandoff();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

describe("product entry", () => {
  it("offers distinct create-room and demo paths", async () => {
    await act(async () => {
      root.render(<Home />);
    });

    const links = [...container.querySelectorAll("a")];
    expect(container.textContent).toContain(
      "Walk in with a question. Leave with a decision.",
    );
    expect(
      links.some(
        (link) =>
          link.textContent?.includes("Create a meeting") &&
          link.getAttribute("href") === "/new",
      ),
    ).toBe(true);
    expect(
      links.some(
        (link) =>
          /demo/i.test(link.textContent ?? "") &&
          link.getAttribute("href") === "/room/demo",
      ),
    ).toBe(true);
  });
});

describe("create-room form", () => {
  it("rejects an empty title", async () => {
    const createRoom = vi.fn<RoomOnboardingClient["createRoom"]>();
    await mountForm(makeClient(createRoom));

    await act(async () => {
      setValue(requireField("brief"), "A useful decision brief.");
      ["Maya", "Emre", "Noor", "Lena"].forEach((name, index) => {
        setValue(requireField(`participant-${index}-name`), name);
      });
    });
    await submitForm();

    expect(createRoom).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Enter a decision title.");
    expect(requireField("title").getAttribute("aria-invalid")).toBe("true");
  });

  it("rejects fewer than two participant seats", async () => {
    const createRoom = vi.fn<RoomOnboardingClient["createRoom"]>();
    await mountForm(makeClient(createRoom));

    const removeButtons = [
      ...container.querySelectorAll<HTMLButtonElement>(
        'button[aria-label^="Remove participant"]',
      ),
    ];
    await click(removeButtons[2]!);
    await click(removeButtons[1]!);
    await click(removeButtons[0]!);

    await act(async () => {
      setValue(requireField("title"), "Choose our launch approach");
      setValue(requireField("brief"), "A useful decision brief.");
      setValue(requireField("participant-0-name"), "Maya");
    });
    await submitForm();

    expect(createRoom).not.toHaveBeenCalled();
    expect(container.textContent).toContain(
      "Add at least two participants, including you.",
    );
  });

  it("submits only canonical creation fields", async () => {
    const createRoom = vi
      .fn<RoomOnboardingClient["createRoom"]>()
      .mockResolvedValue(createdRoom);
    await mountForm(makeClient(createRoom));
    await fillValidForm();
    await submitForm();

    expect(createRoom).toHaveBeenCalledTimes(1);
    const input = createRoom.mock.calls[0]?.[0];
    expect(input).toEqual({
      title: "Choose our launch approach",
      brief: "Decide how to launch while balancing speed, quality, and reach.",
      participants: [
        { name: "Maya", role: "Product Manager", requiredForApproval: false },
        { name: "Emre", role: "Engineer", requiredForApproval: false },
        { name: "Noor", role: "Designer", requiredForApproval: false },
        { name: "Lena", role: "Marketing Lead", requiredForApproval: false },
      ],
    });
    expect(Object.keys(input ?? {})).toEqual(["title", "brief", "participants"]);
    expect(JSON.stringify(input)).not.toMatch(
      /organizerUserId|actorId|participantId|userId|origin/,
    );
  });

  it("navigates to setup using the room ID returned by the client", async () => {
    const createRoom = vi
      .fn<RoomOnboardingClient["createRoom"]>()
      .mockResolvedValue(createdRoom);
    await mountForm(makeClient(createRoom));
    await fillValidForm();
    await submitForm();

    expect(navigation.push).toHaveBeenCalledTimes(1);
    expect(navigation.push).toHaveBeenCalledWith(
      "/room/rm_created-room/setup",
    );
  });

  it("shows useful failure feedback, stays put, and allows retry", async () => {
    const createRoom = vi
      .fn<RoomOnboardingClient["createRoom"]>()
      .mockRejectedValueOnce(new Error("internal details must stay hidden"))
      .mockResolvedValueOnce(createdRoom);
    await mountForm(makeClient(createRoom));
    await fillValidForm();

    await submitForm();
    expect(navigation.push).not.toHaveBeenCalled();
    expect(container.textContent).toContain("We couldn’t create the room.");
    expect(container.textContent).toContain("Your entries are still here.");
    expect(container.textContent).not.toContain("internal details");
    expect(requireField("title")).toHaveProperty(
      "value",
      "Choose our launch approach",
    );

    const submit = container.querySelector<HTMLButtonElement>(
      'button[type="submit"]',
    );
    if (!submit) throw new Error("No submit button after failure.");
    expect(submit.disabled).toBe(false);

    await submitForm();
    expect(createRoom).toHaveBeenCalledTimes(2);
    expect(navigation.push).toHaveBeenCalledWith(
      "/room/rm_created-room/setup",
    );
  });
});
