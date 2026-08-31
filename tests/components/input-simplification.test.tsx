// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PositionsPanel } from "@/components/room/positions-panel";
import { ProposalsWorkspace } from "@/components/room/proposals-workspace";
import { RoomProvider } from "@/components/room/room-provider";
import { demoRoom } from "@/fixtures/demo-room";
import { MockRoomClient } from "@/room-client/mock-room-client";
import { setRoomClientForTests } from "@/room-client/room-client";
import type { RoomPhase, RoomState } from "@/contracts/room";

/**
 * B1: the primary surface is a question, not a record.
 *
 * The structured fields are not gone — a manual participant can still say
 * everything the canonical input can carry — but nothing that mirrors the DTO
 * is on screen until someone asks for it, and no field opens pre-filled with
 * a scenario the person did not write.
 */

vi.mock("@/webmcp/register-tools", () => ({
  useRoomWebMcpTools: () => undefined,
}));

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

let container: HTMLDivElement;
let root: Root;

async function mount(ui: React.ReactNode, phase: RoomPhase) {
  const seed: RoomState = structuredClone(demoRoom);
  seed.phase = phase;
  setRoomClientForTests(new MockRoomClient(seed));
  await act(async () => {
    root.render(<RoomProvider roomId={seed.id}>{ui}</RoomProvider>);
  });
  await act(async () => {});
}

/** The controls a person sees without opening anything. */
function primaryControls(): Element[] {
  return [...container.querySelectorAll("form input, form select, form textarea")].filter(
    (element) => element.closest("details") === null,
  );
}

function disclosureControls(): Element[] {
  return [...container.querySelectorAll("details input, details select, details textarea")];
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  setRoomClientForTests(null);
});

describe("input phase", () => {
  it("asks one question with one box", async () => {
    await mount(<PositionsPanel />, "input");

    expect(container.textContent).toContain("What should the team know from you?");
    expect(
      [...container.querySelectorAll("button")].some(
        (button) => button.textContent === "Share with meeting",
      ),
    ).toBe(true);

    const primary = primaryControls();
    expect(primary).toHaveLength(1);
    expect((primary[0] as HTMLTextAreaElement).name).toBe("summary");
    expect((primary[0] as HTMLTextAreaElement).value).toBe("");
  });

  it("keeps the structured fields reachable, behind a disclosure", async () => {
    await mount(<PositionsPanel />, "input");

    const details = container.querySelector("details");
    expect(details).not.toBeNull();
    expect(details?.open).toBe(false);
    expect(details?.querySelector("summary")?.textContent).toContain(
      "Add structured detail",
    );

    const names = disclosureControls().map((element) => (element as HTMLInputElement).name);
    expect(names).toContain("category");
    expect(names).toContain("priority");
  });
});

describe("proposals phase", () => {
  it("asks for the option in the proposer's own words", async () => {
    await mount(<ProposalsWorkspace />, "proposals");

    expect(container.textContent).toContain("Describe your proposed option");
    expect(
      [...container.querySelectorAll("button")].some(
        (button) => button.textContent === "Propose",
      ),
    ).toBe(true);

    const primary = primaryControls();
    expect(primary).toHaveLength(1);
    expect((primary[0] as HTMLTextAreaElement).name).toBe("description");
    expect((primary[0] as HTMLTextAreaElement).value).toBe("");
  });

  it("moves title, rationale and outcomes into the optional refinement", async () => {
    await mount(<ProposalsWorkspace />, "proposals");

    const details = container.querySelector("details");
    expect(details?.open).toBe(false);
    expect(details?.querySelector("summary")?.textContent).toContain("Refine this proposal");

    const names = disclosureControls().map((element) => (element as HTMLInputElement).name);
    expect(names).toContain("title");
    expect(names).toContain("rationale");
    expect(names).toContain("expectedOutcomes");
  });
});
