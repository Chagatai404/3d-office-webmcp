"use client";

import { useEffect, useState } from "react";

/**
 * Whether this visitor has asked the OS for reduced motion.
 *
 * The pre-meeting flow choreographs a camera flight against a DOM fade, so
 * the stage and the flow layout have to agree on this answer; they read it
 * from here rather than each keeping their own copy. Starts `false` so the
 * server and first client render match, then syncs on mount.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    // Not every environment the flow renders in has media queries.
    if (typeof window.matchMedia !== "function") return;

    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  return reduced;
}
