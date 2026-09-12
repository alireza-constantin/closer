import { redirect } from "next/navigation";

import AnonymousSession from "@/components/anonymous-session";
import ParticipantOnboardingForm from "@/components/participant-onboarding-form";
import { CloserPageShell, CloserTopbar } from "@/components/closer/page-shell";
import { getCurrentParticipant } from "@/lib/closer-server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function OnboardingPage() {
  if (await getCurrentParticipant()) redirect("/");

  return (
    <CloserPageShell className="flex flex-col">
      <CloserTopbar />
      <AnonymousSession>
        <ParticipantOnboardingForm />
      </AnonymousSession>
    </CloserPageShell>
  );
}
