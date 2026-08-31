import { describe, expect, it } from "vitest";
import { WORKSPACE_IDS } from "@/visualization/scene/camera-poses";
import { zoneLabel } from "@/visualization/scene/scene-focus";

/**
 * The room has no places besides the eight workspaces: the pointer and the
 * dock share one vocabulary of "where you are."
 */
describe("zoneLabel", () => {
  it("names every workspace", () => {
    expect(zoneLabel("room")).toBe("Room");
    expect(zoneLabel("constraints")).toBe("Constraints");
    expect(zoneLabel("decision")).toBe("Decision");
  });

  it("gives every workspace id a distinct label", () => {
    const labels = WORKSPACE_IDS.map((id) => zoneLabel(id));
    expect(new Set(labels).size).toBe(WORKSPACE_IDS.length);
  });
});
