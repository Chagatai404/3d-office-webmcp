"use client";

import { useId, useRef, type KeyboardEvent, type PointerEvent } from "react";
import { useShell } from "./shell-provider";
import { MIN_HEIGHT, MIN_WIDTH, type PlacedWindow } from "./window-state";
import { windowDefinition } from "./window-registry";

/**
 * Chrome around one of the room's panels.
 *
 * Drag the title bar with a pointer, or focus the move grip and use the arrow
 * keys; the same for resizing. Nothing about the panel inside changes because
 * it is in a window — it is the same component the tests mount on its own.
 */

/** Arrow-key step, in pixels. */
const NUDGE = 24;
const RESIZE_STEP = 32;

interface DragState {
  pointerId: number;
  offsetX: number;
  offsetY: number;
}

export function OsWindow({ window: state }: { window: PlacedWindow }) {
  const { placeWindow, closeWindow, focusWindow } = useShell();
  const definition = windowDefinition(state.id);
  const titleId = useId();
  const drag = useRef<DragState | null>(null);
  const resize = useRef<DragState | null>(null);
  const { frame } = state;

  function beginDrag(event: PointerEvent<HTMLElement>) {
    if (event.button !== 0) return;
    if (event.target instanceof Element && event.target.closest(".window-close")) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - frame.x,
      offsetY: event.clientY - frame.y,
    };
  }

  function onDragMove(event: PointerEvent<HTMLElement>) {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    placeWindow(state.id, {
      ...frame,
      x: event.clientX - active.offsetX,
      y: event.clientY - active.offsetY,
    });
  }

  function endDrag(event: PointerEvent<HTMLElement>) {
    if (drag.current?.pointerId !== event.pointerId) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    drag.current = null;
  }

  function beginResize(event: PointerEvent<HTMLElement>) {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    resize.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - frame.width,
      offsetY: event.clientY - frame.height,
    };
  }

  function onResizeMove(event: PointerEvent<HTMLElement>) {
    const active = resize.current;
    if (!active || active.pointerId !== event.pointerId) return;
    placeWindow(state.id, {
      ...frame,
      width: event.clientX - active.offsetX,
      height: event.clientY - active.offsetY,
    });
  }

  function endResize(event: PointerEvent<HTMLElement>) {
    if (resize.current?.pointerId !== event.pointerId) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    resize.current = null;
  }

  /** Arrow keys inside a window belong to the window, never to the camera. */
  function onGripKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const step: Record<string, [number, number]> = {
      ArrowUp: [0, -NUDGE],
      ArrowDown: [0, NUDGE],
      ArrowLeft: [-NUDGE, 0],
      ArrowRight: [NUDGE, 0],
    };
    const delta = step[event.key];
    if (!delta) return;
    event.preventDefault();
    event.stopPropagation();
    placeWindow(state.id, {
      ...frame,
      x: frame.x + delta[0],
      y: frame.y + delta[1],
    });
  }

  function onResizeKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const step: Record<string, [number, number]> = {
      ArrowUp: [0, -RESIZE_STEP],
      ArrowDown: [0, RESIZE_STEP],
      ArrowLeft: [-RESIZE_STEP, 0],
      ArrowRight: [RESIZE_STEP, 0],
    };
    const delta = step[event.key];
    if (!delta) return;
    event.preventDefault();
    event.stopPropagation();
    placeWindow(state.id, {
      ...frame,
      width: Math.max(MIN_WIDTH, frame.width + delta[0]),
      height: Math.max(MIN_HEIGHT, frame.height + delta[1]),
    });
  }

  return (
    <section
      className="os-window"
      aria-labelledby={titleId}
      style={{
        transform: `translate3d(${frame.x}px, ${frame.y}px, 0)`,
        width: `${frame.width}px`,
        height: `${frame.height}px`,
        zIndex: state.z,
      }}
      onPointerDownCapture={() => focusWindow(state.id)}
    >
      <header
        className="window-bar"
        onPointerDown={beginDrag}
        onPointerMove={onDragMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <button
          type="button"
          className="window-grip"
          aria-label={`Move ${definition.title}`}
          onKeyDown={onGripKeyDown}
        >
          <span aria-hidden="true">{definition.glyph}</span>
        </button>

        <h2 className="window-title" id={titleId}>
          {definition.title}
        </h2>

        <button
          type="button"
          className="window-close"
          aria-label={`Close ${definition.title}`}
          onClick={() => closeWindow(state.id)}
        >
          <span aria-hidden="true">×</span>
        </button>
      </header>

      <div className="window-body">{definition.render()}</div>

      <button
        type="button"
        className="window-resize"
        aria-label={`Resize ${definition.title}`}
        onPointerDown={beginResize}
        onPointerMove={onResizeMove}
        onPointerUp={endResize}
        onPointerCancel={endResize}
        onKeyDown={onResizeKeyDown}
      >
        <span aria-hidden="true">⁄⁄</span>
      </button>
    </section>
  );
}
