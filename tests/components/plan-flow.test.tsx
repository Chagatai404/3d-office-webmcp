// @vitest-environment jsdom
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FloorPlanShell } from "@/components/plan/plan-shell";
import { RoomProvider, useRoom } from "@/components/room/room-provider";
import {
  createFloorPlanState,
  type FloorPlanState,
} from "@/floorplan/floorplan-view-model";
import { setRoomClientForTests } from "@/room-client/room-client";
import { MockRoomClient } from "@/room-client/mock-room-client";
import { demoRoom } from "@/fixtures/demo-room";

/**
 * Proves the 2D surface rides the same architecture as the 3D one:
 *
 *   form submit -> RoomClient -> new snapshot -> plan DOM update
 *                                            -> floor plan projection update
 *
 * The plan never mutates room state. It calls the client and redraws whatever
 * snapshot comes back.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

let container: HTMLDivElement;
let root: Root;
const seen: FloorPlanState[] = [];

function PlanProbe() {
  const { room } = useRoom();
  useEffect(() => {
    seen.push(createFloorPlanState(room));
  }, [room]);
  return null;
}

async function mountPlan() {
  await act(async () => {
    root.render(
      <RoomProvider roomId="demo">
        <PlanProbe />
        <FloorPlanShell />
      </RoomProvider>,
    );
  });
}

function latest(): FloorPlanState {
  const view = seen.at(-1);
  if (!view) throw new Error("The provider never produced a projection.");
  return view;
}

function buttonLabelled(text: string): HTMLButtonElement {
  const match = [...container.querySelectorAll("button")].find(
    (button) => button.textContent?.trim() === text,
  );
  if (!match) throw new Error(`No button labelled "${text}".`);
  return match;
}

/** A sidebar nav row, found by its label rather than by its badge counts. */
function navButton(label: string): HTMLButtonElement {
  const match = [...container.querySelectorAll<HTMLButtonElement>(".nav-item")].find(
    (button) =>
      button.querySelector(".nav-item-label")?.textContent?.trim() === label,
  );
  if (!match) throw new Error(`No navigation row labelled "${label}".`);
  return match;
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.click();
  });
}

/** Sets a controlled field the way a user typing into it would. */
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

async function submitDialog() {
  const form = container.querySelector<HTMLFormElement>(".plan-modal form");
  if (!form) throw new Error("The position dialog is not open.");
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  seen.length = 0;
  setRoomClientForTests(new MockRoomClient(demoRoom));
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

describe("the floor plan", () => {
  it("renders the seeded room from the client, not from fixtures", async () => {
    await mountPlan();

    expect(container.textContent).toContain("Onboarding Update Decision Room");
    expect(container.textContent).toContain("Maya Okonkwo");
    expect(container.textContent).toContain("Emre Yilmaz");
    expect(container.textContent).toContain("Simulated participant");
    expect(latest().constraintCards).toHaveLength(6);
  });

  it("draws ten offices, four of them occupied", async () => {
    await mountPlan();

    expect(container.querySelectorAll(".room-office")).toHaveLength(10);
    expect(container.querySelectorAll(".room-office.is-occupied")).toHaveLength(4);
    expect(container.querySelectorAll(".room-office.is-reserved")).toHaveLength(6);
    expect(container.textContent).toContain("6 reserved offices");
  });

  it("gives every place on the plan a button outside the drawing too", async () => {
    await mountPlan();

    // Ten offices plus the three shared places, reachable by pointer...
    expect(container.querySelectorAll('.plan-hits [role="button"]')).toHaveLength(13);
    // ...and the sidebar carries the same places as ordinary buttons.
    expect(navButton("Meeting room")).toBeDefined();
    expect(navButton("Constraint wall")).toBeDefined();
    expect(navButton("Common area")).toBeDefined();
  });

  it("follows the selection into the detail rail", async () => {
    await mountPlan();

    await click(navButton("Constraint wall"));

    const rail = container.querySelector(".plan-rail");
    expect(rail?.textContent).toContain("Every published constraint");
    expect(rail?.textContent).toContain("The campaign date cannot move.");
  });

  it("moves a published position into the DOM and the plan projection", async () => {
    await mountPlan();

    const before = latest();
    expect(
      before.constraintCards.filter(
        (card) => card.participantId === "participant-engineering",
      ),
    ).toHaveLength(0);
    expect(
      before.participants.find((p) => p.id === "participant-engineering")?.place,
    ).toBe("office");

    await click(buttonLabelled("Publish your position"));
    const field = container.querySelector<HTMLTextAreaElement>(
      '.plan-modal textarea[name="summary"]',
    );
    if (!field) throw new Error("The position dialog is not open.");

    await act(async () => {
      setValue(field, "Capacity is roughly one engineer for two weeks.");
    });
    await submitDialog();

    const after = latest();

    // The room advanced through the client, not through component state.
    expect(after.version).toBe(before.version + 1);
    expect(after.constraintCards).toHaveLength(before.constraintCards.length + 2);

    const engineerCards = after.constraintCards.filter(
      (card) => card.participantId === "participant-engineering",
    );
    expect(engineerCards).toHaveLength(2);
    expect(engineerCards[0]?.category).toBe("capacity");
    expect(engineerCards[0]?.ownerName).toBe("Emre Yilmaz");

    // Publishing moves the Engineer out of their office and onto the floor.
    expect(
      after.participants.find((p) => p.id === "participant-engineering")?.place,
    ).toBe("corridor");

    // The same snapshot reaches the drawing and the DOM.
    expect(container.querySelectorAll(".constraint-card")).toHaveLength(8);
    expect(container.textContent).toContain(
      "Implementation capacity is roughly one engineer for two weeks.",
    );
    expect(container.textContent).toContain("Recorded");

    // And exactly one activity event was recorded for it.
    expect(after.activity).toHaveLength(before.activity.length + 1);
    expect(after.activity.at(-1)?.action).toBe("position.added");
    expect(after.activity.at(-1)?.actorName).toBe("Emre Yilmaz");
  });

  it("shows recovery guidance when the client rejects the input", async () => {
    await mountPlan();

    await click(buttonLabelled("Publish your position"));
    const field = container.querySelector<HTMLTextAreaElement>(
      '.plan-modal textarea[name="summary"]',
    );
    if (!field) throw new Error("The position dialog is not open.");

    await act(async () => {
      setValue(field, "   ");
    });
    await submitDialog();

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "VALIDATION_ERROR",
    );
    expect(latest().version).toBe(4);
  });
});
