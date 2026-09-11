import AnonymousSession from "@/components/anonymous-session";
import { CloserPageShell, CloserTopbar } from "@/components/closer/page-shell";
import JoinPairForm from "@/components/join-pair-form";
import { db, getInitialInviteLanding } from "@Closer/auth/closer";

export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = await getInitialInviteLanding(db, token);

  return (
    <CloserPageShell className="flex flex-col">
      <CloserTopbar />
      <AnonymousSession>
        <JoinPairForm inviterDisplayName={invite?.inviterDisplayName ?? null} token={token} />
      </AnonymousSession>
    </CloserPageShell>
  );
}
