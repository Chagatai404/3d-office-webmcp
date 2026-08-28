"use client";

/**
 * How to move around the office.
 *
 * Every route listed here has a pointer form and a keyboard form, because the
 * canvas is hidden from assistive technology: the dock is the accessible path
 * to the same places.
 */

const CONTROLS: readonly { action: string; how: string }[] = [
  { action: "Move over the office", how: "Drag with the left button · W A S D or the arrow keys" },
  { action: "Turn the view", how: "Drag with the right button · Q and E" },
  { action: "Come closer", how: "Scroll wheel · + and −" },
  { action: "Visit a place", how: "Click a room in the office · pick it from the dock" },
  { action: "Step back out", how: "Click bare floor · the Whole office button" },
  { action: "Open a panel", how: "Its button in the dock, or click the place it describes" },
  { action: "Move a window", how: "Drag its title bar · focus the title bar and use the arrow keys" },
];

export function NavigationGuide() {
  return (
    <section className="panel-block" aria-labelledby="guide-heading">
      <h2 className="panel-heading" id="guide-heading">
        Getting around
      </h2>

      <dl className="guide-list">
        {CONTROLS.map((control) => (
          <div key={control.action} className="guide-row">
            <dt>{control.action}</dt>
            <dd>{control.how}</dd>
          </div>
        ))}
      </dl>

      <p className="panel-note">
        Keyboard camera control pauses while focus is inside a window, so typing
        into a form never moves the office.
      </p>
    </section>
  );
}
