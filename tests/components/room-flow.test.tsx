// @vitest-environment jsdom
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ParticipantPanel } from "@/components/room/participant-panel";
import { PositionsPanel } from "@/components/room/positions-panel";
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

async function mountRoom() {
  await act(async () => {
    root.render(
      <RoomProvider roomId="demo">
        <VisualizationProbe />
        <ParticipantPanel />
        <PositionsPanel />
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
    await mountRoom();

    expect(container.textContent).toContain("Maya Okonkwo");
    expect(container.textContent).toContain("Emre Yilmaz");
    expect(container.textContent).toContain("Simulated participant");
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

    await act(async () => {
      setValue(
        requireSummaryField(),
        "Capacity is roughly one engineer for two weeks.",
      );
    });
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

    // The same snapshot reaches the DOM.
    expect(container.textContent).toContain(
      "Implementation capacity is roughly one engineer for two weeks.",
    );
    expect(container.textContent).toContain("Recorded");

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
