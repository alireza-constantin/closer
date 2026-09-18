import { notFound } from "next/navigation";

import { PairRealtimeProvider } from "@/features/pair/components/pair-realtime-provider";
import { getCurrentParticipant } from "@/server/auth/current-participant";
import { getPairEntry } from "@/server/modules/pairs/pair.service";

export default async function PairLayout({ children, params }: LayoutProps<"/pair/[pairId]">) {
  const { pairId } = await params;
  const participant = await getCurrentParticipant();
  if (!participant) notFound();

  try {
    const entry = await getPairEntry(participant.id, pairId);
    // A terminated Pair's root page owns its former-member state. Do not keep
    // active SSE infrastructure around it on direct navigation or refresh.
    if (entry.state === "terminated") return children;
  } catch {
    notFound();
  }

  return <PairRealtimeProvider pairId={pairId}>{children}</PairRealtimeProvider>;
}
