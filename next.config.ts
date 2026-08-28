import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // AGENTS.md is the shared integration contract for both workstreams; keep
  // `next dev` from appending framework notes to it.
  agentRules: false,
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
