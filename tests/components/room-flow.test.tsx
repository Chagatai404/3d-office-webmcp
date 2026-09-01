// @vitest-environment jsdom
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ParticipantPanel } from "@/components/room/participant-panel";
import { PositionsPanel, type PositionsPanelTab } from "@/components/room/positions-panel";
import { RoomProvider, useRoom } from "@/components/room/room-provider";
import { setRoomClientForTests } from "@/room-client/room-client";
import { MockRoomClient } from "@/room-client/mock-room-client";
import { demoRoom } from "@/fixtures/demo-room";
import type { RoomVisualizationState } from "@/visualization/room-view-model";

/**
 * Proves the architecture checkpoint end to end in a browser environment:
 *
 *   form submit -> RoomClient -> new snapshot -> DOM update
 *                                            -> visualization state update
 *
 * The 3D canvas is deliberately not mounted. What matters here is that the
 * scene's only input changes, which is exactly what the canvas consumes.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

let container: HTMLDivElement;
let root: Root;
const seenVisualizations: RoomVisualizationState[] = [];

function VisualizationProbe() {
  const { visualization } = useRoom();
  useEffect(() => {
    seenVisualizations.push(visualization);
  }, [visualization]);
  return null;
}

async function mountRoom(tab: PositionsPanelTab = "input") {
  await act(async () => {
    root.render(
      <RoomProvider roomId="demo">
        <VisualizationProbe />
        <ParticipantPanel />
        <PositionsPanel tab={tab} />
      </RoomProvider>,
    );
  });
}

function latestVisualization(): RoomVisualizationState {
  const latest = seenVisualizations.at(-1);
  if (!latest) throw new Error("The provider never produced a projection.");
  return latest;
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

function requireSummaryField(): HTMLTextAreaElement {
  const field = container.querySelector<HTMLTextAreaElement>(
    'textarea[name="summary"]',
  );
  if (!field) throw new Error("The position form is not rendered.");
  return field;
}

function requireForm(): HTMLFormElement {
  const form = container.querySelector("form");
  if (!form) throw new Error("The position form is not rendered.");
  return form;
}

/**
 * Opens one more row under "Add structured detail" and fills it in, the way
 * someone reaching for the advanced path would.
 */
async function addHardLimit(category: string, text: string) {
  const addButton = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "Add a hard limit",
  );
  if (!addButton) throw new Error("The structured-detail disclosure is not rendered.");
  await act(async () => {
    addButton.click();
  });

  const fieldset = container.querySelector(".constraint-fieldset");
  const rows = [...(fieldset?.querySelectorAll(".constraint-draft") ?? [])];
  const row = rows.at(-1);
  if (!row) throw new Error("The new limit row is not rendered.");

  const inputs = [...row.querySelectorAll<HTMLInputElement>("input")];
  await act(async () => {
    setValue(inputs[0]!, category);
    setValue(inputs[1]!, text);
  });
}

async function submitForm() {
  await act(async () => {
    requireForm().dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
  });
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  seenVisualizations.length = 0;
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

describe("adding a constraint through the room client", () => {
  it("renders the seeded room from the client, not from fixtures", async () => {
    // participant-design (Lina Duarte) owns the constraint this test looks for.
    await mountRoom("participant-design");

    expect(container.textContent).toContain("Maya Okonkwo");
    expect(container.textContent).toContain("Emre Yilmaz");
    expect(container.textContent).toContain("Simulated teammate");
    expect(container.textContent).toContain(
      "Every new onboarding step needs an accessibility review",
    );
    expect(latestVisualization().constraints).toHaveLength(6);
  });

  it("moves a new constraint into the DOM and the visualization state", async () => {
    await mountRoom();

    const before = latestVisualization();
    expect(
      before.constraints.filter(
        (constraint) => constraint.participantId === "participant-engineering",
      ),
    ).toHaveLength(0);

    // B1: the primary surface is one box. The structured limits still exist
    // behind "Add structured detail" and still travel in the same canonical
    // `addMyPosition` input, which is what this asserts.
    await act(async () => {
      setValue(
        requireSummaryField(),
        "Capacity is roughly one engineer for two weeks.",
      );
    });
    await addHardLimit(
      "capacity",
      "Implementation capacity is roughly one engineer for two weeks.",
    );
    await addHardLimit("architecture", "No authentication rewrite as part of this change.");
    await submitForm();

    const after = latestVisualization();

    // The room advanced through the client, not through component state.
    expect(after.version).toBe(before.version + 1);
    expect(after.constraints).toHaveLength(before.constraints.length + 2);

    const engineerConstraints = after.constraints.filter(
      (constraint) => constraint.participantId === "participant-engineering",
    );
    expect(engineerConstraints).toHaveLength(2);
    expect(engineerConstraints[0]?.category).toBe("capacity");

    // "Recorded" is the input tab's own submit feedback; the new constraint
    // itself reaches the DOM under its owner's own tab.
    expect(container.textContent).toContain("Recorded");
    await mountRoom("participant-engineering");
    expect(container.textContent).toContain(
      "Implementation capacity is roughly one engineer for two weeks.",
    );

    // And the activity ledger's source gained exactly one event.
    expect(after.recentActivity.at(-1)?.action).toBe("position.added");
    expect(after.recentActivity.at(-1)?.actorName).toBe("Emre Yilmaz");
  });

  it("shows recovery guidance when the client rejects the input", async () => {
    await mountRoom();

    await act(async () => {
      setValue(requireSummaryField(), "   ");
    });
    await submitForm();

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "VALIDATION_ERROR",
    );
    expect(latestVisualization().version).toBe(4);
  });
});
