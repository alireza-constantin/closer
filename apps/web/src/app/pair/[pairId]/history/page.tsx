import { db, getFormerEraHistoryForParticipant } from "@Closer/auth/closer";
import { notFound } from "next/navigation";

import { HistoryScreen } from "@/components/history-screen";
import { getCurrentParticipant } from "@/lib/closer-server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function PairHistoryPage({ params }: { params: Promise<{ pairId: string }> }) {
  const { pairId } = await params;
  const currentParticipant = await getCurrentParticipant();
  if (!currentParticipant) notFound();
  try {
    const history = await getFormerEraHistoryForParticipant(db, {
      participantId: currentParticipant.id,
      pairId,
    });
    return <HistoryScreen history={history} pairId={pairId} />;
  } catch {
    notFound();
  }
}
