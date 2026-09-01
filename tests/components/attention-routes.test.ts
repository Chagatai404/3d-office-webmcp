import { describe, expect, it } from "vitest";
import type { AttentionItem, AttentionItemType, RoomPhase } from "@/contracts/room";
import { targetFor } from "@/components/shell/attention-routes";

/**
 * Reviewing an attention item has to land somewhere it can actually be dealt
 * with — and land in the same place whether it was reached from the drawer's
 * list or from the alert that appeared when it arrived. Both read this table,
 * so these cover the table itself.
 */

const TYPES: AttentionItemType[] = [
  "input_required",
  "admission_request",
  "conflict_requires_human",
  "alignment_required",
  "owner_decision_required",
  "consensus_approval_required",
  "expert_advice_needs_disposition",
  "owner_progress_required",
];

function item(type: AttentionItemType, phase: RoomPhase = "input"): AttentionItem {
  return {
    id: `attn:${type}:1`,
    type,
    priority: "high",
    title: "t",
    summary: "s",
    phase,
    relatedEntityId: null,
    requiresHumanConfirmation: false,
  } as AttentionItem;
}

describe("targetFor", () => {
  it("routes every attention type somewhere", () => {
    for (const type of TYPES) {
      const target = targetFor(item(type), "input");
      expect(
        target.drawer !== undefined || target.workspace !== undefined,
        `${type} routes nowhere`,
      ).toBe(true);
    }
  });

  it("sends a waiting joiner to the drawer that can admit them", () => {
    expect(targetFor(item("admission_request"), "input")).toEqual({ drawer: "participants" });
  });

  it("sends each decision item to the workspace that owns it", () => {
    expect(targetFor(item("input_required"), "input").workspace).toBe("constraints");
    expect(targetFor(item("conflict_requires_human"), "deliberation").workspace).toBe("issues");
    expect(targetFor(item("alignment_required"), "voting").workspace).toBe("alignment");
    expect(targetFor(item("owner_decision_required"), "approval").workspace).toBe("decision");
  });

  it("points Alignment's owner-progress item at Settings, home of the one manual transition left", () => {
    expect(targetFor(item("owner_progress_required", "voting"), "voting")).toEqual({
      drawer: "settings",
    });
  });

  it("falls back to the room for the phases that now advance themselves", () => {
    const cases: RoomPhase[] = ["input", "proposals", "deliberation"];
    for (const phase of cases) {
      expect(targetFor(item("owner_progress_required", phase), phase)).toEqual({
        workspace: "room",
      });
    }
  });
});
