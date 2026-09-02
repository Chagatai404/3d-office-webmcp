import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // AGENTS.md is the shared integration contract for both workstreams; keep
  // `next dev` from appending framework notes to it.
  agentRules: false,
  allowedDevOrigins: ["127.0.0.1"],
  // Next's dev server lock (`.next/dev/lock`) is keyed by build directory, not
  // port, so a second `next dev` for this same project refuses to start next
  // to an already-running one even on a different port. Playwright's own
  // `webServer` sets this so its instance gets its own build output and lock,
  // and can run alongside a dev server someone already has open.
  ...(process.env.PLAYWRIGHT_DIST_DIR ? { distDir: process.env.PLAYWRIGHT_DIST_DIR } : {}),
};

export default nextConfig;
