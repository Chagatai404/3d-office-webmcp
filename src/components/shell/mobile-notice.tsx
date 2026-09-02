"use client";

import { useState, useSyncExternalStore } from "react";

const DISMISSED_KEY = "mobile-notice-dismissed";
const NARROW_VIEWPORT_QUERY = "(max-width: 48rem)";

/**
 * The 3D room, phase-gated workspaces, and WebMCP tool surface all assume a
 * desktop browser with room to breathe -- and WebMCP itself currently only
 * runs behind a desktop Chrome flag. A judge or visitor who opens the link on
 * a phone should be told that up front, not left to conclude the product is
 * just broken.
 *
 * The viewport match is read via `useSyncExternalStore` rather than
 * `useState` + `useEffect`, so the client-only value (`window.matchMedia`)
 * is synchronized without a synchronous `setState` in an effect body, and
 * `getServerSnapshot` keeps server rendering deterministic (never showing
 * the notice in the initial HTML).
 */
function subscribeToViewport(onChange: () => void): () => void {
  const query = window.matchMedia(NARROW_VIEWPORT_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function getViewportSnapshot(): boolean {
  return window.matchMedia(NARROW_VIEWPORT_QUERY).matches;
}

function getServerViewportSnapshot(): boolean {
  return false;
}

function readDismissed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return sessionStorage.getItem(DISMISSED_KEY) === "true";
  } catch {
    return false;
  }
}

export function MobileNotice() {
  const isNarrowViewport = useSyncExternalStore(
    subscribeToViewport,
    getViewportSnapshot,
    getServerViewportSnapshot,
  );
  const [dismissed, setDismissed] = useState(readDismissed);

  if (!isNarrowViewport || dismissed) return null;

  function dismiss() {
    try {
      sessionStorage.setItem(DISMISSED_KEY, "true");
    } catch {
      // Ignore -- worst case the notice reappears next navigation.
    }
    setDismissed(true);
  }

  return (
    <div className="mobile-notice-backdrop" role="presentation">
      <div
        className="mobile-notice-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mobile-notice-title"
        aria-describedby="mobile-notice-body"
      >
        <h2 id="mobile-notice-title">Built for desktop</h2>
        <p id="mobile-notice-body">
          This room -- the 3D view, the workspaces, and the browser agent tools -- is designed
          for a desktop browser. For the full experience, open this link on a desktop, ideally in
          Chrome with WebMCP enabled.
        </p>
        <button
          type="button"
          className="button mobile-notice-dismiss"
          onClick={dismiss}
          autoFocus
        >
          Continue anyway
        </button>
      </div>
    </div>
  );
}
