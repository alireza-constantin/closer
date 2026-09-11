import { db, getActivePairForParticipant } from "@Closer/auth/closer";
import { redirect } from "next/navigation";

import AnonymousSession from "@/components/anonymous-session";
import CreatePairForm from "@/components/create-pair-form";
import { getCurrentParticipant } from "@/lib/closer-server";

// Membership can be completed in another browser while this route is cached.
// Resolve it on every request so an active participant never sees onboarding.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function Home() {
  const currentParticipant = await getCurrentParticipant();
  if (currentParticipant) {
    const activePair = await getActivePairForParticipant(db, currentParticipant.id);
    if (activePair) redirect(`/pair/${activePair.pairId}`);
  }

  return (
    <main className="closer-shell closer-onboarding-shell">
      <header className="closer-topbar"><span className="closer-wordmark">Closer <span aria-hidden="true">♥</span></span><span className="closer-pair-mark" aria-hidden="true"><i /> <i /></span></header>
      <AnonymousSession>
        <CreatePairForm />
      </AnonymousSession>
    </main>
  );
}
