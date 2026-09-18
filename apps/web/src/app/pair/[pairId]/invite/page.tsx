import { Suspense } from "react";
import { db, getPairForParticipant } from "@Closer/auth/closer";
import { notFound, redirect, unstable_rethrow } from "next/navigation";

import { ConnectPageFrame } from "@/features/invite/components/connect-page-frame";
import ConnectPerson from "@/features/invite/components/connect-person";
import InviteControls, {
  InviteControlsSkeleton,
} from "@/features/invite/components/invite-controls";
import { getCurrentParticipant } from "@/server/auth/current-participant";

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function AuthorizedInviteControls({
  issueOnEntry,
  pairId,
}: {
  issueOnEntry: boolean;
  pairId: string;
}) {
  const currentParticipant = await getCurrentParticipant();
  if (!currentParticipant) notFound();

  try {
    const pairView = await getPairForParticipant(db, currentParticipant.id, pairId);
    // A stale unclaimed URL remains legitimate for an active member after a
    // remote claim. Preserve its intent without issuing or rotating an invite.
    if (pairView.members.length === 2)
      redirect(issueOnEntry ? `/pair/${pairId}/private` : `/pair/${pairId}`);
    return <InviteControls autoGenerate={issueOnEntry} kind="initial" pairId={pairId} />;
  } catch (error) {
    unstable_rethrow(error);
    notFound();
  }
}

export default async function InvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ pairId: string }>;
  searchParams: Promise<{ reason?: string }>;
}) {
  const { pairId } = await params;
  const { reason } = await searchParams;

  return (
    <ConnectPageFrame pairId={pairId}>
      <ConnectPerson pairId={pairId}>
        <Suspense fallback={<InviteControlsSkeleton />}>
          <AuthorizedInviteControls issueOnEntry={reason === "private"} pairId={pairId} />
        </Suspense>
      </ConnectPerson>
    </ConnectPageFrame>
  );
}
