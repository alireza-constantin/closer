import { db, getPairForParticipant } from "@Closer/auth/closer";
import { notFound } from "next/navigation";

import PairConnection from "@/components/pair-connection";
import { getCurrentParticipant } from "@/lib/closer-server";

export default async function PairPage({ params }: { params: Promise<{ pairId: string }> }) {
  const { pairId } = await params;
  const currentParticipant = await getCurrentParticipant();
  if (!currentParticipant) notFound();

  try {
    const pairView = await getPairForParticipant(db, currentParticipant.id, pairId);
    const firstMember = pairView.members.find((member) => member.slot === "first");
    const secondMember = pairView.members.find((member) => member.slot === "second");

    return (
      <main className="mx-auto w-full max-w-xl space-y-6 px-5 py-12">
        <PairConnection
          initialMembers={[
            ...(firstMember ? [{ slot: "first" as const, displayName: firstMember.displayName }] : []),
            ...(secondMember ? [{ slot: "second" as const, displayName: secondMember.displayName }] : []),
          ]}
          pairId={pairId}
          relationshipType={pairView.pair.relationshipType}
        />
      </main>
    );
  } catch {
    notFound();
  }
}
