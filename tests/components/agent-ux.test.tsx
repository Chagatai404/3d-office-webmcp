// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActivityLedger } from "@/components/room/activity-ledger";
import { PositionsPanel } from "@/components/room/positions-panel";
import { RoomProvider } from "@/components/room/room-provider";
import { demoRoom, demoTimestamp } from "@/fixtures/demo-room";
import { MockRoomClient } from "@/room-client/mock-room-client";
import { setRoomClientForTests } from "@/room-client/room-client";
import type { RoomState } from "@/contracts/room";

vi.mock("@/webmcp/register-tools", () => ({
  useRoomWebMcpTools: () => undefined,
}));

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

let container: HTMLDivElement;
let root: Root;

async function mount(ui: React.ReactNode, room: RoomState = demoRoom) {
  setRoomClientForTests(new MockRoomClient(room));
  await act(async () => {
    root.render(<RoomProvider roomId={room.id}>{ui}</RoomProvider>);
  });
  await act(async () => {});
}

function roomWithWebMcpHistory(): RoomState {
  const room = structuredClone(demoRoom);
  room.activity.push(
    {
      id: "event-webmcp-product",
      actorType: "participant",
      actorId: "participant-product",
      origin: "webmcp",
      action: "proposal.submitted",
      entityType: "proposal",
      entityId: "proposal-1",
      sanitizedInput: {},
      result: { ok: true },
      previousRoomVersion: 4,
      resultingRoomVersion: 5,
      confirmationRequired: false,
      createdAt: demoTimestamp(5),
    },
    {
      id: "event-webmcp-product-latest",
      actorType: "participant",
      actorId: "participant-product",
      origin: "webmcp",
      action: "objection.raised",
      entityType: "conflict",
      entityId: "conflict-1",
      sanitizedInput: {},
      result: { ok: true },
      previousRoomVersion: 5,
      resultingRoomVersion: 6,
      confirmationRequired: false,
      createdAt: demoTimestamp(6),
    },
  );
  return room;
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  delete document.modelContext;
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
  delete document.modelContext;
});

describe("browser-agent UX", () => {
  it("keeps manual input available when document.modelContext is missing", async () => {
    await mount(<PositionsPanel />);

    expect(container.textContent).toContain(
      "WebMCP is unavailable in this browser. You can still participate manually.",
    );
    expect(container.textContent).toContain(
      "Read this meeting and help me express my engineering constraints.",
    );
    expect(
      container.querySelector<HTMLButtonElement>(
        'button[type="submit"]',
      )?.disabled,
    ).toBe(false);
  });

  it("announces browser-agent tools when document.modelContext exists", async () => {
    document.modelContext = {
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => true,
      registerTool: async () => undefined,
      getTools: async () => [],
      executeTool: async () => null,
    };

    await mount(<PositionsPanel />);

    expect(container.textContent).toContain(
      "Browser agent tools available for this phase",
    );
  });

  it("projects the latest WebMCP action per participant from canonical activity", async () => {
    await mount(<ActivityLedger />, roomWithWebMcpHistory());

    expect(container.textContent).toContain("Latest browser-agent actions");
    expect(container.textContent).toContain("Product Manager");
    expect(container.textContent).toContain("Objection raised");
    expect(container.textContent).not.toContain("Proposal submitted · 12:00:05 UTC");
    expect(container.textContent).toContain(
      "Marketing LeadTomas Reyes◆via browser agentPosition added",
    );
  });

  it("shows activity provenance with origin words, not color alone", async () => {
    await mount(<ActivityLedger />, roomWithWebMcpHistory());

    expect(container.textContent).toContain(
      "Marketing LeadTomas Reyesvia browser agent · Position addedParticipant",
    );
    expect(container.textContent).toContain(
      "Product ManagerMaya Okonkwovia manual · Position addedParticipant",
    );
    expect(container.textContent).toContain("Systemvia system · Room created");
  });
});
