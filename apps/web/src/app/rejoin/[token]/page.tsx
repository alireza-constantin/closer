import AnonymousSession from "@/components/anonymous-session";
import JoinPairForm from "@/components/join-pair-form";
import { db, getRejoinInviteLanding } from "@Closer/auth/closer";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function RejoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = await getRejoinInviteLanding(db, token);

  return (
    <main className="closer-shell closer-onboarding-shell">
      <header className="closer-topbar"><span className="closer-wordmark">Closer <span aria-hidden="true">♥</span></span><span className="closer-pair-mark" aria-hidden="true"><i /> <i /></span></header>
      <AnonymousSession>
        <JoinPairForm inviterDisplayName={null} kind="rejoin" token={token} unavailable={!invite} />
      </AnonymousSession>
    </main>
  );
}
