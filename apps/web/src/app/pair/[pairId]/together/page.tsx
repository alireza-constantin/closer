import { db, getPairForParticipant } from "@Closer/auth/closer";
import { notFound } from "next/navigation";

import TogetherPicker from "@/components/together-picker";
import { getCurrentParticipant } from "@/lib/closer-server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function TogetherPickerPage({ params }: { params: Promise<{ pairId: string }> }) {
  const { pairId } = await params;
  const currentParticipant = await getCurrentParticipant();
  if (!currentParticipant) notFound();
  try {
    const pairView = await getPairForParticipant(db, currentParticipant.id, pairId);
    return <TogetherPicker pairId={pairId} relationshipType={pairView.pair.relationshipType} />;
  } catch {
    notFound();
  }
}
