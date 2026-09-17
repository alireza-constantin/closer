import AnonymousSession from "@/components/anonymous-session";
import { JoinInvitationFrame } from "@/components/join-invitation-frame";
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
      <div className="flex flex-1 items-center py-10">
        <JoinInvitationFrame kind="rejoin">
          <AnonymousSession>
            <JoinPairForm kind="rejoin" token={token} unavailable={!invite} />
          </AnonymousSession>
        </JoinInvitationFrame>
      </div>
    </CloserPageShell>
  );
}
