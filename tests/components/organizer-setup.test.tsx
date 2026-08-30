// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OrganizerSetup } from "@/components/onboarding/organizer-setup";

declare global { var IS_REACT_ACT_ENVIRONMENT: boolean; }

let container: HTMLDivElement;
let root: Root;

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

describe("legacy organizer setup route", () => {
  it("contains no predetermined invitations and points owners to the room", async () => {
    await act(async () => { root.render(<OrganizerSetup roomId="rm_setup-room" />); });
    expect(container.textContent).toContain("already its owner and decision-maker");
    expect(container.querySelector('a[href="/room/rm_setup-room"]')).toBeTruthy();
    expect(container.querySelectorAll('button[aria-label^="Copy invite"]')).toHaveLength(0);
    expect(container.textContent).not.toContain("seat");
  });
});
