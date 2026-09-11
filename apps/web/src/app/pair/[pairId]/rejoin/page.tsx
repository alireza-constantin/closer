import { db, getPairForParticipant } from "@Closer/auth/closer";
import { notFound } from "next/navigation";

import RejoinControls from "@/components/rejoin-controls";
import { getCurrentParticipant } from "@/lib/closer-server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function RejoinControlsPage({ params }: { params: Promise<{ pairId: string }> }) {
  const { pairId } = await params;
  const currentParticipant = await getCurrentParticipant();
  if (!currentParticipant) notFound();

  try {
    const pairView = await getPairForParticipant(db, currentParticipant.id, pairId);
    if (pairView.members.length !== 2) notFound();
    const target = pairView.members.find((member) => member.participantId !== currentParticipant.id);
    if (!target) notFound();
    return <RejoinControls pairId={pairId} targetName={target.displayName} />;
  } catch {
    notFound();
  }
}
