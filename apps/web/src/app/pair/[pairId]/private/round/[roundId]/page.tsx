import { notFound } from "next/navigation";

import PrivateRoundScreen from "@/features/private-conversation/components/private-round-screen";
import { getCurrentParticipant } from "@/server/auth/current-participant";
import { getPrivateRound } from "@/server/modules/private-rounds/private-round.service";

export default async function PrivateRoundPage({
  params,
}: {
  params: Promise<{ pairId: string; roundId: string }>;
}) {
  const { pairId, roundId } = await params;
  const currentParticipant = await getCurrentParticipant();
  if (!currentParticipant) notFound();
  try {
    const view = await getPrivateRound({
      participantId: currentParticipant.id,
      pairId,
      roundId,
    });
    // Keep ready-but-unopened answers out of the RSC payload until this participant chooses Reveal.
    if (view.state === "REVEAL_READY") {
      const { answers: _answers, reactions: _reactions, replies: _replies, ...safeView } = view;
      return <PrivateRoundScreen initialRound={safeView} />;
    }
    return <PrivateRoundScreen initialRound={view} />;
  } catch {
    notFound();
  }
}
