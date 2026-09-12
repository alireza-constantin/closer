import AnonymousSession from "@/components/anonymous-session";
import { CloserPageShell, CloserTopbar } from "@/components/closer/page-shell";
import JoinPairForm from "@/components/join-pair-form";
import { db, getInitialInviteLanding } from "@Closer/auth/closer";
import { getCurrentParticipant } from "@/lib/closer-server";

export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [invite, claimant] = await Promise.all([getInitialInviteLanding(db, token), getCurrentParticipant()]);

  return (
    <CloserPageShell className="flex flex-col">
      <CloserTopbar />
      <AnonymousSession>
        <JoinPairForm
          claimantDisplayName={claimant?.displayName ?? null}
          initialInvite={invite}
          inviterDisplayName={invite?.inviterDisplayName ?? null}
          token={token}
        />
      </AnonymousSession>
    </CloserPageShell>
  );
}
