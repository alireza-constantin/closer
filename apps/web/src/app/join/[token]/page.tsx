import { Suspense } from "react";

import AnonymousSession from "@/components/anonymous-session";
import { JoinInvitationDetailsSkeleton, JoinInvitationFrame } from "@/components/join-invitation-frame";
import { CloserPageShell, CloserTopbar } from "@/components/closer/page-shell";
import JoinPairForm from "@/components/join-pair-form";
import { db, getInitialInviteLanding } from "@Closer/auth/closer";
import { getCurrentParticipant } from "@/lib/closer-server";

async function JoinInvitationDetails({ token }: { token: string }) {
  const [invite, claimant] = await Promise.all([getInitialInviteLanding(db, token), getCurrentParticipant()]);

  return (
    <JoinPairForm
      claimantDisplayName={claimant?.displayName ?? null}
      initialInvite={invite}
      token={token}
    />
  );
}

export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  return (
    <CloserPageShell className="flex flex-col">
      <CloserTopbar />
      <div className="flex flex-1 items-center py-10">
        <JoinInvitationFrame>
          <AnonymousSession>
            <Suspense fallback={<JoinInvitationDetailsSkeleton />}>
              <JoinInvitationDetails token={token} />
            </Suspense>
          </AnonymousSession>
        </JoinInvitationFrame>
      </div>
    </CloserPageShell>
  );
}
