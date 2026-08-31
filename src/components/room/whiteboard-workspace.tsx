"use client";

/**
 * The Whiteboard workspace.
 *
 * Shared notes and trade-off sketches are part of the target design, but
 * nothing in the canonical room model persists them yet — so this panel says
 * that plainly instead of inventing local-only state that would vanish on
 * reload and look like a real recorded note. Wiring this to canonical state
 * is tracked as follow-up work, not shipped here as a fake feature.
 */
export function WhiteboardWorkspace() {
  return (
    <section className="panel-block" aria-labelledby="whiteboard-heading" data-testid="whiteboard-workspace">
      <h2 className="panel-heading" id="whiteboard-heading">
        Whiteboard
      </h2>
      <p className="panel-note">Working notes, not the record.</p>
      <p className="panel-empty">
        Shared notes are not wired to canonical room state yet — this workspace is a placeholder for
        that surface. Agents will be able to read this board once it exists; only people will be able
        to pin to it.
      </p>
    </section>
  );
}
