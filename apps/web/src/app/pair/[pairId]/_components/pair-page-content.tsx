import { notFound } from "next/navigation";

import PairHome from "@/features/pair/components/pair-home";
import TerminatedPairScreen from "@/features/pair/components/terminated-pair-screen";
import { getCurrentParticipant } from "@/server/auth/current-participant";
import {
  getPairEntry,
  listPairPrivateConversations,
  listParticipantSpaces,
} from "@/server/modules/pairs/pair.service";

export default async function PairPageContent({ params }: { params: Promise<{ pairId: string }> }) {
  const { pairId } = await params;
  const currentParticipant = await getCurrentParticipant();
  if (!currentParticipant) notFound();

  try {
    const [entry, spaces] = await Promise.all([
      getPairEntry(currentParticipant.id, pairId),
      listParticipantSpaces(currentParticipant.id),
    ]);
    if (entry.state === "terminated") return <TerminatedPairScreen />;
    const pairView = entry;
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
