import { db, getPairForParticipant } from "@Closer/auth/closer";
import { notFound } from "next/navigation";

import PrivatePicker from "@/components/private-picker";
import { getCurrentParticipant } from "@/lib/closer-server";

export default async function PrivatePickerPage({ params }: { params: Promise<{ pairId: string }> }) {
  const { pairId } = await params;
  const currentParticipant = await getCurrentParticipant();
  if (!currentParticipant) notFound();
  try {
    const pairView = await getPairForParticipant(db, currentParticipant.id, pairId);
    if (pairView.members.length !== 2) notFound();
    return <PrivatePicker pairId={pairId} relationshipType={pairView.pair.relationshipType} />;
  } catch {
    notFound();
  }
}
