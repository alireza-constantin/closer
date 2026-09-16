import { db, getPairForParticipant } from "@Closer/auth/closer";
import { notFound, redirect } from "next/navigation";

import { getCurrentParticipant } from "@/lib/closer-server";
import { togetherPickerPath } from "@/lib/together-picker-path";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function LegacyTogetherPickerPage({ params }: { params: Promise<{ pairId: string }> }) {
  const { pairId } = await params;
  const currentParticipant = await getCurrentParticipant();
  if (!currentParticipant) notFound();

  const pairView = await getPairForParticipant(db, currentParticipant.id, pairId).catch(notFound);
  redirect(togetherPickerPath(pairId, pairView.pair.relationshipType) as never);
}
