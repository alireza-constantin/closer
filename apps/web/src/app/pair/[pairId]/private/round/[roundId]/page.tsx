import { db, getPrivateRoundForParticipant } from "@Closer/auth/closer";
import { notFound } from "next/navigation";

import PrivateRoundScreen from "@/components/private-round-screen";
import { getCurrentParticipant } from "@/lib/closer-server";

export default async function PrivateRoundPage({
  params,
}: {
  params: Promise<{ pairId: string; roundId: string }>;
}) {
  const { pairId, roundId } = await params;
  const currentParticipant = await getCurrentParticipant();
  if (!currentParticipant) notFound();
  try {
    const view = await getPrivateRoundForParticipant(db, {
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
