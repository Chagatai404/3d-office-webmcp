"use client";

import { ZONE_LABEL, type SceneZoneId } from "@/visualization/scene/scene-focus";
import { useShell } from "./shell-provider";
import { WINDOW_DEFINITIONS } from "./window-registry";

/**
 * The keyboard route to everywhere the pointer can go in the office.
 *
 * The canvas is hidden from assistive technology, so every place worth
 * visiting and every panel worth reading is a real button here.
 */

const PLACES: readonly SceneZoneId[] = [
  "overview",
  "meeting-room",
  "constraint-wall",
  "common-area",
];

export function Dock() {
  const { windows, visitZone, selectedZone, toggleWindow, resetLayout } =
    useShell();

  return (
    <nav className="dock" aria-label="Office navigation">
      <div className="dock-group" role="group" aria-label="Places">
        {PLACES.map((zone) => {
          const current =
            zone === "overview" ? selectedZone === null : selectedZone === zone;
          return (
            <button
              key={zone}
              type="button"
              className="dock-button dock-place"
              aria-pressed={current}
              onClick={() => visitZone(zone)}
            >
              {ZONE_LABEL[zone as keyof typeof ZONE_LABEL]}
            </button>
          );
        })}
      </div>

      <div className="dock-group" role="group" aria-label="Panels">
        {WINDOW_DEFINITIONS.map((definition) => (
          <button
            key={definition.id}
            type="button"
            className="dock-button"
            title={definition.hint}
            aria-pressed={windows[definition.id].open}
            onClick={() => toggleWindow(definition.id)}
          >
            <span className="dock-glyph" aria-hidden="true">
              {definition.glyph}
            </span>
            {definition.title}
          </button>
        ))}
      </div>

      <button type="button" className="dock-button dock-reset" onClick={resetLayout}>
        Reset layout
      </button>
    </nav>
  );
}
