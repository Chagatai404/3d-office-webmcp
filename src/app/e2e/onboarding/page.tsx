import { notFound } from "next/navigation";
import { OnboardingE2EHarness } from "@/components/room/onboarding-e2e-harness";

/**
 * Browser-integration entry point for the pre-membership lane. Guarded by the
 * same flag as the room harness, so it exists only for Playwright and never in
 * a normal deployment.
 */
export const dynamic = "force-dynamic";

export default async function OnboardingE2EPage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string | string[] }>;
}) {
  if (process.env.E2E_ROOM_HARNESS !== "true") notFound();
  const { invite } = await searchParams;
  return (
    <OnboardingE2EHarness
      initialInviteToken={(Array.isArray(invite) ? invite[0] : invite) ?? ""}
    />
  );
}
