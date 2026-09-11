import { db, getPairForParticipant, listActivePrivateConversations } from "@Closer/auth/closer";
import { notFound } from "next/navigation";

import PairConnection from "@/components/pair-connection";
import PairHome from "@/components/pair-home";
import { getCurrentParticipant } from "@/lib/closer-server";

// Pair membership can change in another browser while this route is open.
// Always resolve the current participant-relative state on navigation/refresh
// so an invite owner cannot remain on the pre-join waiting screen.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function PairPage({ params }: { params: Promise<{ pairId: string }> }) {
  const { pairId } = await params;
  const currentParticipant = await getCurrentParticipant();
  if (!currentParticipant) notFound();

  try {
    const pairView = await getPairForParticipant(db, currentParticipant.id, pairId);
    const firstMember = pairView.members.find((member) => member.slot === "first");
    const secondMember = pairView.members.find((member) => member.slot === "second");

    if (firstMember && secondMember) {
      const activeConversations = await listActivePrivateConversations(db, { participantId: currentParticipant.id, pairId });
      return (
        <PairHome
          activeConversations={activeConversations}
          memberNames={[firstMember.displayName, secondMember.displayName]}
          pairId={pairId}
        />
      );
    }

    return (
      <main className="closer-shell closer-connection-shell">
        <PairConnection
          initialMembers={[
            ...(firstMember ? [{ slot: "first" as const, displayName: firstMember.displayName }] : []),
            ...(secondMember ? [{ slot: "second" as const, displayName: secondMember.displayName }] : []),
          ]}
          pairId={pairId}
          relationshipType={pairView.pair.relationshipType}
        />
      </main>
    );
  } catch {
    notFound();
  }
}
