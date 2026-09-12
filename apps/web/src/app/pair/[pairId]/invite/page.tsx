import { db, getPairForParticipant } from "@Closer/auth/closer";
import { notFound, redirect } from "next/navigation";

import ConnectPerson from "@/components/connect-person";
import { getCurrentParticipant } from "@/lib/closer-server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function InvitePage({ params, searchParams }: { params: Promise<{ pairId: string }>; searchParams: Promise<{ reason?: string }> }) {
  const { pairId } = await params;
  const { reason } = await searchParams;
  const currentParticipant = await getCurrentParticipant();
  if (!currentParticipant) notFound();

  try {
    const pairView = await getPairForParticipant(db, currentParticipant.id, pairId);
    if (pairView.members.length === 2) redirect(`/pair/${pairId}`);
    return <ConnectPerson issueOnEntry={reason === "private"} pairId={pairId} />;
  } catch {
    notFound();
  }
}
