import { redirect } from "next/navigation";

import AnonymousSession from "@/features/auth/components/anonymous-session";
import ParticipantOnboardingForm from "@/features/auth/components/participant-onboarding-form";
import { CloserPageShell, CloserTopbar } from "@/components/closer/page-shell";
import { getCurrentParticipant } from "@/server/auth/current-participant";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  if (await getCurrentParticipant()) redirect("/");
  const { next } = await searchParams;
  const returnTo = typeof next === "string" && next.startsWith("/join/") ? next : undefined;

  return (
    <CloserPageShell className="flex flex-col">
      <CloserTopbar />
      <AnonymousSession>
        <ParticipantOnboardingForm returnTo={returnTo} />
      </AnonymousSession>
    </CloserPageShell>
  );
}
