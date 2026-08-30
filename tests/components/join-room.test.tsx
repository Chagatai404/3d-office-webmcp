// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JoinRoom } from "@/components/onboarding/join-room";
import type { RoomOnboardingClient } from "@/clients/room-onboarding-client";
import type { ActionResult, JoinRequest, RoomInvitePreview } from "@/contracts/room";

const navigation = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: navigation.push }),
}));

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const validPreview: RoomInvitePreview = {
  inviteValid: true,
  roomId: "rm_join-room",
  title: "Choose our launch approach",
  brief: "Balance launch speed, quality, and reach.",
  ownerDisplayName: "Maya",
};

const waitingRequest: JoinRequest = {
  id: "join-request-1",
  roomId: "rm_join-room",
  displayName: "Emre",
  role: "Engineer",
  status: "waiting",
  createdAt: "2026-08-30T00:00:00.000Z",
  resolvedAt: null,
};

let container: HTMLDivElement;
let root: Root;

function makeClient(overrides: Partial<RoomOnboardingClient> = {}): RoomOnboardingClient {
  return {
    createRoom: async () => {
      throw new Error("Not used by join tests.");
    },
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
    ...overrides,
  };
}

async function mountJoin(client: RoomOnboardingClient, props: { roomId?: string; inviteToken?: string | null } = {}) {
  await act(async () => {
    root.render(<JoinRoom client={client} {...props} />);
  });
}

function field(name: string): HTMLInputElement {
  const element = container.querySelector<HTMLInputElement>(`[name="${name}"]`);
  if (!element) throw new Error(`No field named ${name}.`);
  return element;
}

function setValue(element: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

function submitButton(): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>("button[type=submit]");
  if (!button) throw new Error("Submit button missing.");
  return button;
}

async function submit() {
  const form = container.querySelector("form");
  if (!form) throw new Error("Form missing.");
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

beforeEach(() => {
  window.sessionStorage.clear();
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  navigation.push.mockReset();
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

describe("room ID + passcode join", () => {
  it("requires room ID, passcode, name, and role before submitting", async () => {
    const requestJoinByPasscode = vi.fn();
    await mountJoin(makeClient({ requestJoinByPasscode }));
    await submit();
    expect(requestJoinByPasscode).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Complete all join details.");
  });

  it("submits the canonical passcode join contract", async () => {
    const result: ActionResult<{ roomId: string; joinRequest: JoinRequest }> = {
      ok: true,
      data: { roomId: "rm_join-room", joinRequest: waitingRequest },
      roomVersion: 0,
      message: "Waiting for the meeting owner.",
    };
    const requestJoinByPasscode = vi.fn().mockResolvedValue(result);
    await mountJoin(makeClient({ requestJoinByPasscode }));

    await act(async () => {
      setValue(field("roomId"), "rm_join-room");
      setValue(field("passcode"), "AB12CD34");
      setValue(field("displayName"), "Emre");
      setValue(field("role"), "Engineer");
    });
    await submit();

    expect(requestJoinByPasscode).toHaveBeenCalledWith({
      roomId: "rm_join-room",
      passcode: "AB12CD34",
      displayName: "Emre",
      role: "Engineer",
    });
    expect(container.textContent).toContain("Waiting for the meeting owner to admit you.");
  });

  it("shows the server's refusal without creating a waiting state", async () => {
    const requestJoinByPasscode = vi.fn().mockResolvedValue({
      ok: false,
      error: { code: "INVALID_JOIN_CREDENTIALS", message: "Room access details are invalid." },
      roomVersion: 0,
    });
    await mountJoin(makeClient({ requestJoinByPasscode }));

    await act(async () => {
      setValue(field("roomId"), "rm_join-room");
      setValue(field("passcode"), "WRONG");
      setValue(field("displayName"), "Emre");
      setValue(field("role"), "Engineer");
    });
    await submit();

    expect(container.textContent).toContain("Room access details are invalid.");
    expect(container.textContent).not.toContain("Waiting for the meeting owner");
  });
});

describe("invite link join", () => {
  it("previews the invitation automatically and disables submission until it resolves", async () => {
    let resolvePreview!: (preview: RoomInvitePreview) => void;
    const previewInvite = vi.fn(
      () =>
        new Promise<RoomInvitePreview>((resolve) => {
          resolvePreview = resolve;
        }),
    );
    await mountJoin(makeClient({ previewInvite }), { inviteToken: "opaque-token" });

    expect(previewInvite).toHaveBeenCalledWith("opaque-token");
    expect(submitButton().disabled).toBe(true);
    expect(container.querySelector('[name="roomId"]')).toBeNull();

    await act(async () => resolvePreview(validPreview));

    expect(container.textContent).toContain(validPreview.title);
    expect(container.textContent).toContain(validPreview.brief);
    expect(submitButton().disabled).toBe(false);
  });

  it("keeps an invalid invitation unusable", async () => {
    const previewInvite = vi.fn().mockResolvedValue({ inviteValid: false });
    await mountJoin(makeClient({ previewInvite }), { inviteToken: "opaque-token" });

    expect(container.textContent).toContain("This invitation can’t be used.");
    expect(container.querySelector("form")).toBeNull();
  });

  it("submits the canonical invite join contract", async () => {
    const previewInvite = vi.fn().mockResolvedValue(validPreview);
    const result: ActionResult<{ roomId: string; joinRequest: JoinRequest }> = {
      ok: true,
      data: { roomId: "rm_join-room", joinRequest: waitingRequest },
      roomVersion: 0,
      message: "Waiting for the meeting owner.",
    };
    const requestJoinByInvite = vi.fn().mockResolvedValue(result);
    await mountJoin(makeClient({ previewInvite, requestJoinByInvite }), { inviteToken: "opaque-token" });

    await act(async () => {
      setValue(field("displayName"), "Emre");
      setValue(field("role"), "Engineer");
    });
    await submit();

    expect(requestJoinByInvite).toHaveBeenCalledWith({
      inviteToken: "opaque-token",
      displayName: "Emre",
      role: "Engineer",
    });
    expect(container.textContent).toContain("Waiting for the meeting owner to admit you.");
  });
});

describe("waiting-room status transitions", () => {
  async function reachWaitingState(getMyJoinRequest: RoomOnboardingClient["getMyJoinRequest"]) {
    const result: ActionResult<{ roomId: string; joinRequest: JoinRequest }> = {
      ok: true,
      data: { roomId: "rm_join-room", joinRequest: waitingRequest },
      roomVersion: 0,
      message: "Waiting for the meeting owner.",
    };
    const requestJoinByPasscode = vi.fn().mockResolvedValue(result);
    await mountJoin(makeClient({ requestJoinByPasscode, getMyJoinRequest }));
    await act(async () => {
      setValue(field("roomId"), "rm_join-room");
      setValue(field("passcode"), "AB12CD34");
      setValue(field("displayName"), "Emre");
      setValue(field("role"), "Engineer");
    });
    await submit();
  }

  it("navigates into the room once the poll observes admission", async () => {
    vi.useFakeTimers();
    try {
      const getMyJoinRequest = vi.fn().mockResolvedValue({
        ok: true,
        data: { ...waitingRequest, status: "admitted", resolvedAt: "2026-08-30T00:05:00.000Z" },
        roomVersion: 1,
        message: "Join request loaded.",
      });
      await reachWaitingState(getMyJoinRequest);
      expect(navigation.push).not.toHaveBeenCalled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });

      expect(getMyJoinRequest).toHaveBeenCalledWith(waitingRequest.id);
      expect(navigation.push).toHaveBeenCalledWith("/room/rm_join-room");
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows a clear rejected state with a path back to the start", async () => {
    vi.useFakeTimers();
    try {
      const getMyJoinRequest = vi.fn().mockResolvedValue({
        ok: true,
        data: { ...waitingRequest, status: "rejected", resolvedAt: "2026-08-30T00:05:00.000Z" },
        roomVersion: 1,
        message: "Join request loaded.",
      });
      await reachWaitingState(getMyJoinRequest);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });

      expect(container.textContent).toContain("Your join request was declined.");
      expect(container.querySelector('a[href="/"]')).toBeTruthy();
      expect(navigation.push).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
