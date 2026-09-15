import { db, getPairForParticipant } from "@Closer/auth/closer";
import { notFound, redirect, unstable_rethrow } from "next/navigation";

import PrivatePicker from "@/components/private-picker";
import { getCurrentParticipant } from "@/lib/closer-server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function PrivatePickerPage({ params }: { params: Promise<{ pairId: string }> }) {
  const { pairId } = await params;
  const currentParticipant = await getCurrentParticipant();
  if (!currentParticipant) notFound();
  try {
    const pairView = await getPairForParticipant(db, currentParticipant.id, pairId);
    if (pairView.members.length !== 2) redirect(`/pair/${pairId}/invite?reason=private` as never);
    return <PrivatePicker pairId={pairId} relationshipType={pairView.pair.relationshipType} />;
  } catch (error) {
    unstable_rethrow(error);
    notFound();
  }
}
