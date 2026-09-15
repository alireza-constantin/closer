import { db, getPrivateConversationForParticipant } from "@Closer/auth/closer";
import { notFound, redirect, unstable_rethrow } from "next/navigation";

import PrivateConversationScreen from "@/components/private-conversation-screen";
import { getCurrentParticipant } from "@/lib/closer-server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function PrivateConversationPage({ params }: { params: Promise<{ pairId: string; conversationId: string }> }) {
  const { pairId, conversationId } = await params;
  const currentParticipant = await getCurrentParticipant();
  if (!currentParticipant) notFound();
  try {
    const view = await getPrivateConversationForParticipant(db, { participantId: currentParticipant.id, pairId, conversationId });
    if (view.state === "CURRENT_ROUND") {
      redirect(`/pair/${pairId}/private/round/${view.roundId}` as never);
    }
    return <PrivateConversationScreen view={view} />;
  } catch (error) {
    unstable_rethrow(error);
    notFound();
  }
}
