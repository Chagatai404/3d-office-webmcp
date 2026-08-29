// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JoinRoom } from "@/components/onboarding/join-room";
import type { RoomOnboardingClient } from "@/clients/room-onboarding-client";
import type {
  ActionResult,
  ClaimInvitationResult,
  RoomInvitePreview,
} from "@/contracts/room";

const navigation = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: navigation.push }),
}));

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const validPreview: RoomInvitePreview = {
  inviteValid: true,
  alreadyClaimed: false,
  roomId: "rm_join-room",
  title: "Choose our launch approach",
  brief: "Balance launch speed, quality, and reach.",
  participant: {
    id: "participant-engineer",
    name: "Emre",
    role: "Engineer",
  },
};

const claimSuccess: ActionResult<ClaimInvitationResult> = {
  ok: true,
  data: {
    roomId: "rm_join-room",
    participantId: "participant-engineer",
  },
  roomVersion: 1,
  message: "Invitation claimed.",
};

let container: HTMLDivElement;
let root: Root;

function makeClient(options: {
  previewInvitation: RoomOnboardingClient["previewInvitation"];
  claimInvitation?: RoomOnboardingClient["claimInvitation"];
}): RoomOnboardingClient {
  return {
    createRoom: async () => {
      throw new Error("Not used by join tests.");
    },
    previewInvitation: options.previewInvitation,
    claimInvitation:
      options.claimInvitation ??
      (async () => ({
        ok: false,
        error: { code: "NOT_AUTHORIZED", message: "Not used by this test." },
        roomVersion: 0,
      })),
  };
}

async function mountJoin(client: RoomOnboardingClient, inviteToken = "opaque-token") {
  await act(async () => {
    root.render(
      <JoinRoom
        roomId="rm_join-room"
        inviteToken={inviteToken}
        client={client}
      />,
    );
  });
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function requireJoinButton(): HTMLButtonElement {
  const button = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) => candidate.textContent?.includes("Join as Engineer"),
  );
  if (!button) throw new Error("The explicit join button is missing.");
  return button;
}

beforeEach(() => {
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

describe("pre-membership invitation preview", () => {
  it("shows loading while the safe preview is pending", async () => {
    let resolvePreview!: (preview: RoomInvitePreview) => void;
    const previewInvitation = vi.fn(
      () =>
        new Promise<RoomInvitePreview>((resolve) => {
          resolvePreview = resolve;
        }),
    );
    await mountJoin(makeClient({ previewInvitation }));

    expect(container.textContent).toContain("Preparing your safe preview");
    expect(
      [...container.querySelectorAll("button")].some((button) =>
        button.textContent?.includes("Join as"),
      ),
    ).toBe(false);

    await act(async () => resolvePreview(validPreview));
  });

  it("renders only the safe valid preview and intended role without RoomProvider", async () => {
    const previewInvitation = vi.fn().mockResolvedValue(validPreview);
    await mountJoin(makeClient({ previewInvitation }));

    expect(container.textContent).toContain("Choose our launch approach");
    expect(container.textContent).toContain("Balance launch speed");
    expect(container.textContent).toContain("Emre");
    expect(container.textContent).toContain("Engineer");
    expect(requireJoinButton().textContent).toContain("Join as Engineer");
    expect(container.textContent).not.toContain("Room version");
    expect(previewInvitation).toHaveBeenCalledWith("opaque-token");
  });

  it.each(["invalid", "expired", "revoked"])(
    "keeps an %s invitation unavailable without a join action",
    async () => {
      await mountJoin(
        makeClient({
          previewInvitation: vi.fn().mockResolvedValue({
            inviteValid: false,
            alreadyClaimed: false,
          }),
        }),
      );

      expect(container.textContent).toContain("This invitation can’t be used.");
      expect(container.textContent).toContain("invalid, expired, revoked");
      expect(container.textContent).toContain("Contact the organizer");
      expect(
        [...container.querySelectorAll("button")].some((button) =>
          button.textContent?.includes("Join as"),
        ),
      ).toBe(false);
    },
  );

  it("treats an invitation already claimed by this session as recovery", async () => {
    await mountJoin(
      makeClient({
        previewInvitation: vi.fn().mockResolvedValue({
          ...validPreview,
          alreadyClaimed: true,
        }),
      }),
    );

    expect(container.textContent).toContain("You’ve already joined this room.");
    expect(container.querySelector('a[href="/room/rm_join-room"]')).toBeTruthy();
    expect(
      [...container.querySelectorAll("button")].some((button) =>
        button.textContent?.includes("Join as"),
      ),
    ).toBe(false);
  });

  it("refuses a valid token previewed for a different route room", async () => {
    await mountJoin(
      makeClient({
        previewInvitation: vi.fn().mockResolvedValue({
          ...validPreview,
          roomId: "rm_different-room",
        }),
      }),
    );

    expect(container.textContent).toContain(
      "This invitation can’t be used at this address.",
    );
    expect(navigation.push).not.toHaveBeenCalled();
  });
});

describe("invitation claim", () => {
  it("calls claim once and disables the action while it is pending", async () => {
    let resolveClaim!: (result: ActionResult<ClaimInvitationResult>) => void;
    const claimInvitation = vi.fn(
      () =>
        new Promise<ActionResult<ClaimInvitationResult>>((resolve) => {
          resolveClaim = resolve;
        }),
    );
    const client = makeClient({
      previewInvitation: vi.fn().mockResolvedValue(validPreview),
      claimInvitation,
    });
    await mountJoin(client);

    const joinButton = requireJoinButton();
    await click(joinButton);

    const pendingButton = container.querySelector<HTMLButtonElement>(
      "button[disabled]",
    );
    expect(pendingButton?.textContent).toContain("Joining");
    expect(pendingButton?.disabled).toBe(true);
    pendingButton?.click();
    expect(claimInvitation).toHaveBeenCalledTimes(1);
    expect(claimInvitation).toHaveBeenCalledWith({ inviteToken: "opaque-token" });

    await act(async () => resolveClaim(claimSuccess));
  });

  it("redirects to the canonical room only after a successful claim", async () => {
    const claimInvitation = vi.fn().mockResolvedValue(claimSuccess);
    await mountJoin(
      makeClient({
        previewInvitation: vi.fn().mockResolvedValue(validPreview),
        claimInvitation,
      }),
    );

    expect(navigation.push).not.toHaveBeenCalled();
    await click(requireJoinButton());

    expect(navigation.push).toHaveBeenCalledTimes(1);
    expect(navigation.push).toHaveBeenCalledWith("/room/rm_join-room");
  });

  it("renders a claim-race recovery without entering the room", async () => {
    await mountJoin(
      makeClient({
        previewInvitation: vi.fn().mockResolvedValue(validPreview),
        claimInvitation: vi.fn().mockResolvedValue({
          ok: false,
          error: {
            code: "NOT_AUTHORIZED",
            message: "Capability unavailable.",
            recovery: "Request another invitation.",
          },
          roomVersion: 0,
        }),
      }),
    );

    await click(requireJoinButton());

    expect(container.textContent).toContain(
      "This invitation was claimed before your join completed.",
    );
    expect(container.textContent).toContain("Request another invitation.");
    expect(navigation.push).not.toHaveBeenCalled();
  });
});
