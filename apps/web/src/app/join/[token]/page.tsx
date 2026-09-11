import AnonymousSession from "@/components/anonymous-session";
import JoinPairForm from "@/components/join-pair-form";
import { db, getInitialInviteLanding } from "@Closer/auth/closer";

export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = await getInitialInviteLanding(db, token);

  return (
    <main className="closer-shell closer-onboarding-shell">
      <header className="closer-topbar"><span className="closer-wordmark">Closer <span aria-hidden="true">♥</span></span><span className="closer-pair-mark" aria-hidden="true"><i /> <i /></span></header>
      <AnonymousSession>
        <JoinPairForm inviterDisplayName={invite?.inviterDisplayName ?? null} token={token} />
      </AnonymousSession>
    </main>
  );
}
