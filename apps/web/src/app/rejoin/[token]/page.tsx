import AnonymousSession from "@/components/anonymous-session";
import { CloserPageShell, CloserTopbar } from "@/components/closer/page-shell";
import JoinPairForm from "@/components/join-pair-form";
import { db, getRejoinInviteLanding } from "@Closer/auth/closer";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function RejoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = await getRejoinInviteLanding(db, token);

  return (
    <CloserPageShell className="flex flex-col">
      <CloserTopbar />
      <AnonymousSession>
        <JoinPairForm inviterDisplayName={null} kind="rejoin" token={token} unavailable={!invite} />
      </AnonymousSession>
    </CloserPageShell>
  );
}
