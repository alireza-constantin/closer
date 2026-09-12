import { db, getPairForParticipant } from "@Closer/auth/closer";
import { notFound, redirect } from "next/navigation";

import ConnectPerson from "@/components/connect-person";
import { getCurrentParticipant } from "@/lib/closer-server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function InvitePage({ params }: { params: Promise<{ pairId: string }> }) {
  const { pairId } = await params;
  const currentParticipant = await getCurrentParticipant();
  if (!currentParticipant) notFound();

  try {
    const pairView = await getPairForParticipant(db, currentParticipant.id, pairId);
    if (pairView.members.length === 2) redirect(`/pair/${pairId}`);
    return <ConnectPerson pairId={pairId} />;
  } catch {
    notFound();
  }
}
