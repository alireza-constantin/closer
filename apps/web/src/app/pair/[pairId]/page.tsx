import { notFound } from "next/navigation";

import PairHome from "@/features/pair/components/pair-home";
import { getCurrentParticipant } from "@/server/auth/current-participant";
import {
  getAuthorizedPair,
  listPairPrivateConversations,
  listParticipantSpaces,
} from "@/server/modules/pairs/pair.service";

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
    const [pairView, spaces] = await Promise.all([
      getAuthorizedPair(currentParticipant.id, pairId),
      listParticipantSpaces(currentParticipant.id),
    ]);
    const firstMember = pairView.members.find((member) => member.slot === "first");
    const secondMember = pairView.members.find((member) => member.slot === "second");

    if (!firstMember) notFound();
    const activeConversations = secondMember
      ? await listPairPrivateConversations(currentParticipant.id, pairId)
      : [];
    return (
      <PairHome
        activeConversations={activeConversations}
        hasMultipleSpaces={spaces.length > 1}
        intendedPersonName={pairView.pair.intendedPersonName}
        isComplete={Boolean(secondMember)}
        memberNames={[firstMember.displayName, secondMember?.displayName ?? null]}
        pairId={pairId}
        relationshipType={pairView.pair.relationshipType}
      />
    );
  } catch {
    notFound();
  }
}
