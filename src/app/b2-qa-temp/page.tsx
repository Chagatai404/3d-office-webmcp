import { B2QaHarness } from "@/components/onboarding/b2-qa-harness";

export default async function B2QaPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  const { mode = "setup" } = await searchParams;
  return <B2QaHarness mode={mode} />;
}
