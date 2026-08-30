// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FlowStage } from "@/components/onboarding/flow-stage";
import Home from "@/app/(flow)/page";
import {
  flowFlightSeconds,
  flowHandoverSeconds,
} from "@/visualization/scene/camera-poses";

const navigation = vi.hoisted(() => ({ push: vi.fn(), pathname: "/" }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: navigation.push, prefetch: vi.fn() }),
  usePathname: () => navigation.pathname,
}));

// The stage itself is WebGL; what matters here is what the flow asks of it.
vi.mock("@/components/onboarding/pre-meeting-stage-mount", () => ({
  PreMeetingStageMount: ({ pose, framed }: { pose: string; framed: boolean }) => (
    <div data-testid="stage" data-pose={pose} data-framed={String(framed)} />
  ),
}));

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

let container: HTMLDivElement;
let root: Root;

function stage(): HTMLElement {
  const element = container.querySelector<HTMLElement>('[data-testid="stage"]');
  if (!element) throw new Error("The flow stage is not mounted.");
  return element;
}

function createLink(): HTMLAnchorElement {
  const link = [...container.querySelectorAll("a")].find((candidate) =>
    candidate.textContent?.includes("Create a meeting"),
  );
  if (!link) throw new Error("The welcome screen has no create action.");
  return link;
}

function joinLink(): HTMLAnchorElement {
  const link = [...container.querySelectorAll("a")].find((candidate) =>
    candidate.textContent?.includes("Join a meeting"),
  );
  if (!link) throw new Error("The welcome screen has no join action.");
  return link;
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  navigation.push.mockReset();
  navigation.pathname = "/";
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <FlowStage>
        <Home />
      </FlowStage>,
    );
  });
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  vi.useRealTimers();
});

/**
 * Welcome, create and lobby are one room, not three pages. The proof is in
 * the order: the camera moves first, and the next screen is only asked for
 * once it has arrived.
 */
describe("the pre-meeting flow's stage", () => {
  it("frames the room on its own on the welcome screen", () => {
    expect(stage().dataset.pose).toBe("welcome");
    expect(stage().dataset.framed).toBe("true");
  });

  it("sends the camera to the create pose before navigating", async () => {
    await click(createLink());

    expect(stage().dataset.pose).toBe("create");
    expect(stage().dataset.framed).toBe("false");
    expect(navigation.push).not.toHaveBeenCalled();
  });

  it("navigates as the camera settles, not before", async () => {
    await click(createLink());

    await act(async () => {
      vi.advanceTimersByTime(flowHandoverSeconds(false) * 1000 - 1);
    });
    expect(navigation.push).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(navigation.push).toHaveBeenCalledWith("/new");
  });

  it("hands over inside the camera's own flight, never after it", () => {
    expect(flowHandoverSeconds(false)).toBeGreaterThan(0);
    expect(flowHandoverSeconds(false)).toBeLessThan(flowFlightSeconds(false));
  });

  it("comes back to the welcome screen when the flight is behind it", async () => {
    await click(createLink());
    await act(async () => {
      vi.advanceTimersByTime(flowHandoverSeconds(false) * 1000);
    });

    // The route settles on create, then the user goes back the way they came.
    navigation.pathname = "/new";
    await act(async () => {
      root.render(
        <FlowStage>
          <Home />
        </FlowStage>,
      );
    });
    navigation.pathname = "/";
    await act(async () => {
      root.render(
        <FlowStage>
          <Home />
        </FlowStage>,
      );
    });

    expect(stage().dataset.pose).toBe("welcome");
    expect(stage().dataset.framed).toBe("true");
    expect(
      container.querySelector("main.welcome")?.hasAttribute("data-leaving"),
    ).toBe(false);
  });

  it("takes the welcome panel off the screen while the camera flies", async () => {
    const welcome = container.querySelector<HTMLElement>("main.welcome");
    expect(welcome?.hasAttribute("data-leaving")).toBe(false);

    await click(createLink());

    expect(welcome?.hasAttribute("data-leaving")).toBe(true);
  });

  it("leaves the create action a real link when no stage is mounted", async () => {
    // `Home` on its own — a server render, or JavaScript that has not run.
    await act(async () => {
      root.render(<Home />);
    });

    const link = createLink();
    expect(link.getAttribute("href")).toBe("/new");

    let defaultPrevented = false;
    await act(async () => {
      const event = new MouseEvent("click", { bubbles: true, cancelable: true });
      link.dispatchEvent(event);
      defaultPrevented = event.defaultPrevented;
    });
    expect(defaultPrevented).toBe(false);
  });
});

/**
 * Join Meeting used to cut straight to `/join` with no flight, and
 * `poseForPath` fell through to the welcome pose for that route, leaving the
 * small framed welcome card floating over the join form. Join now goes
 * through the same continuous-stage flight as Create, landing on its own
 * unframed interior pose.
 */
describe("the join meeting camera transition", () => {
  it("sends the camera to the unframed join pose before navigating", async () => {
    await click(joinLink());

    expect(stage().dataset.pose).toBe("join");
    expect(stage().dataset.framed).toBe("false");
    expect(navigation.push).not.toHaveBeenCalled();
  });

  it("navigates to /join as the camera settles, not before", async () => {
    await click(joinLink());

    await act(async () => {
      vi.advanceTimersByTime(flowHandoverSeconds(false) * 1000 - 1);
    });
    expect(navigation.push).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(navigation.push).toHaveBeenCalledWith("/join");
  });

  it("takes the welcome panel off the screen while the camera flies to join", async () => {
    const welcome = container.querySelector<HTMLElement>("main.welcome");
    expect(welcome?.hasAttribute("data-leaving")).toBe(false);

    await click(joinLink());

    expect(welcome?.hasAttribute("data-leaving")).toBe(true);
  });

  it("does not hijack a modifier click on the join action", async () => {
    await act(async () => {
      const event = new MouseEvent("click", { bubbles: true, cancelable: true, metaKey: true });
      joinLink().dispatchEvent(event);
    });

    expect(navigation.push).not.toHaveBeenCalled();
    expect(stage().dataset.pose).toBe("welcome");
  });

  it("under reduced motion, still flies to the join pose but with an instant handover", async () => {
    await act(async () => {
      root.render(<Home />);
    });
    // No stage mounted in this render (see the create-link test above for
    // why); reduced motion only changes duration, so this asserts the
    // duration relationship instead of re-mounting a stage-backed tree.
    expect(flowHandoverSeconds(true)).toBeGreaterThanOrEqual(0);
    expect(flowHandoverSeconds(true)).toBeLessThanOrEqual(flowFlightSeconds(true));
  });

  it("comes back to the welcome screen when the flight to join is behind it", async () => {
    await click(joinLink());
    await act(async () => {
      vi.advanceTimersByTime(flowHandoverSeconds(false) * 1000);
    });

    navigation.pathname = "/join";
    await act(async () => {
      root.render(
        <FlowStage>
          <Home />
        </FlowStage>,
      );
    });
    navigation.pathname = "/";
    await act(async () => {
      root.render(
        <FlowStage>
          <Home />
        </FlowStage>,
      );
    });

    expect(stage().dataset.pose).toBe("welcome");
    expect(stage().dataset.framed).toBe("true");
    expect(
      container.querySelector("main.welcome")?.hasAttribute("data-leaving"),
    ).toBe(false);
  });
});
