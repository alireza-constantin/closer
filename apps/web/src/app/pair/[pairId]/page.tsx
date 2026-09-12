import { db, getPairForParticipant, listActivePairsForParticipant, listActivePrivateConversations } from "@Closer/auth/closer";
import { notFound } from "next/navigation";

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
    const spaces = await listActivePairsForParticipant(db, currentParticipant.id);
    const firstMember = pairView.members.find((member) => member.slot === "first");
    const secondMember = pairView.members.find((member) => member.slot === "second");

    if (!firstMember) notFound();
    const activeConversations = secondMember
      ? await listActivePrivateConversations(db, { participantId: currentParticipant.id, pairId })
      : [];
    return (
      <PairHome
        activeConversations={activeConversations}
        hasMultipleSpaces={spaces.length > 1}
        intendedPersonName={pairView.pair.intendedPersonName}
        isComplete={Boolean(secondMember)}
        memberNames={[firstMember.displayName, secondMember?.displayName ?? null]}
        pairId={pairId}
      />
    );
  } catch {
    notFound();
  }
}
