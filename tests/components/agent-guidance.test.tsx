// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentPromptExamples } from "@/components/room/agent-prompt-examples";
import { agentPromptGroups, leadAgentPrompt } from "@/components/room/agent-prompts";
import { RoomProvider } from "@/components/room/room-provider";
import { demoRoom } from "@/fixtures/demo-room";
import { MockRoomClient } from "@/room-client/mock-room-client";
import { setRoomClientForTests } from "@/room-client/room-client";
import type { RoomPhase, RoomState } from "@/contracts/room";

/**
 * B5: guidance, not a script.
 *
 * The demo used to hand a judge one numbered sequence, which taught everyone
 * that the room understood exactly that sequence. These pin the two
 * properties that keep it honest: the examples follow the phase the room is
 * actually in, and none of them ever tells an agent to go and look at the
 * page.
 */

vi.mock("@/webmcp/register-tools", () => ({
  useRoomWebMcpTools: () => undefined,
}));

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

let container: HTMLDivElement;
let root: Root;

const PHASES: readonly RoomPhase[] = [
  "input",
  "proposals",
  "deliberation",
  "voting",
  "approval",
  "finalized",
];

/** Words that would send an agent looking at the DOM instead of the protocol. */
const DOM_WORDS = [
  "click",
  "button",
  "page",
  "screen",
  "dom",
  "scroll",
  "tab",
  "panel",
  "drawer",
];

async function mountInPhase(phase: RoomPhase) {
  const seed: RoomState = structuredClone(demoRoom);
  seed.phase = phase;
  setRoomClientForTests(new MockRoomClient(seed));
  await act(async () => {
    root.render(
      <RoomProvider roomId={seed.id}>
        <AgentPromptExamples />
      </RoomProvider>,
    );
  });
  await act(async () => {});
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

describe("agent prompt examples", () => {
  it("offers the checklist's phase examples for the phase the room is in", () => {
    expect(agentPromptGroups("input")[0]!.prompts).toContain(
      "What has everyone shared so far?",
    );
    expect(agentPromptGroups("input")[0]!.prompts).toContain(
      "Share my constraints and mark me ready.",
    );
    expect(agentPromptGroups("deliberation")[0]!.prompts).toContain(
      "What is still blocking us?",
    );
    expect(agentPromptGroups("voting")[0]!.prompts).toContain(
      "Show me where everyone stands.",
    );
    expect(agentPromptGroups("approval")[0]!.prompts).toContain(
      "Prepare the final decision for my review.",
    );
  });

  it("keeps the waiting questions available in every phase", () => {
    for (const phase of PHASES) {
      const always = agentPromptGroups(phase).at(-1)!.prompts;
      expect(always).toContain("Are we ready to move on?");
      expect(always).toContain("Who are we still waiting for?");
      expect(always).toContain("What changed since my last action?");
    }
  });

  it("never tells an agent to inspect the page", () => {
    for (const phase of PHASES) {
      for (const group of agentPromptGroups(phase)) {
        for (const prompt of group.prompts) {
          // Whole words only: "on the table" is the meeting's own language,
          // and it must not trip the check for "tab".
          const words = prompt.toLowerCase().split(/[^a-z]+/).filter(Boolean);
          for (const banned of DOM_WORDS) {
            expect(words).not.toContain(banned);
          }
        }
      }
    }
  });

  it("has a lead example for every phase, for tight spaces", () => {
    for (const phase of PHASES) {
      expect(leadAgentPrompt(phase).length).toBeGreaterThan(0);
    }
  });

  it("renders the current phase's examples and says they are optional", async () => {
    await mountInPhase("deliberation");

    expect(container.textContent).toContain("These are examples, not commands");
    expect(container.textContent).toContain("no exact wording is required");
    expect(container.textContent).toContain("What is still blocking us?");
    // Not a numbered sequence: nothing here implies an order.
    expect(container.querySelector("ol")).toBeNull();
  });

  it("follows the room into its next phase", async () => {
    await mountInPhase("approval");

    expect(container.textContent).toContain("Prepare the final decision for my review.");
    expect(container.textContent).not.toContain("What has everyone shared so far?");
  });
});
