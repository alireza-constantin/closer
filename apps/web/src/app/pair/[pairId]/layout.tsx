import { PairRealtimeProvider } from "@/components/pair-realtime-provider";

export default async function PairLayout({ children, params }: LayoutProps<"/pair/[pairId]">) {
  const { pairId } = await params;
  return <PairRealtimeProvider pairId={pairId}>{children}</PairRealtimeProvider>;
}
