import { db, getTogetherSessionPlaybackForParticipant } from "@Closer/auth/closer";
import { notFound, redirect } from "next/navigation";

import TogetherSessionScreen from "@/components/together-session-screen";
import { getCurrentParticipant } from "@/lib/closer-server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function TogetherSessionPage({
  params,
}: {
  params: Promise<{ pairId: string; sessionId: string }>;
}) {
  const { pairId, sessionId } = await params;
  const currentParticipant = await getCurrentParticipant();
  if (!currentParticipant) notFound();
  let view;
  try {
    view = await getTogetherSessionPlaybackForParticipant(db, {
      participantId: currentParticipant.id,
      pairId,
      sessionId,
    });
  } catch {
    notFound();
  }
  if (view.endedAt) redirect(`/pair/${pairId}/together/${view.relationshipType}`);
  const { endedAt: _endedAt, ...playback } = view;
  return <TogetherSessionScreen initialSession={playback} />;
}
