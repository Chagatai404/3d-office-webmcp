"use client";

import dynamic from "next/dynamic";

/**
 * Client-only mount point for the pre-meeting 3D backdrop.
 *
 * The onboarding routes are server components; this boundary keeps the R3F
 * canvas out of the server bundle and off the first paint, so the DOM panels
 * render immediately and the stage fades in behind them.
 */
export const PreMeetingStageMount = dynamic(
  () => import("./pre-meeting-stage").then((module) => module.PreMeetingStage),
  { ssr: false, loading: () => null },
);
