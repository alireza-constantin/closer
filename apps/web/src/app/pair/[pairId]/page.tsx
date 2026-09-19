import { Suspense } from "react";

import PairPageContent from "./_components/pair-page-content";
import { CloserRouteLoading } from "@/components/closer/route-loading";

// Pair membership can change in another browser while this route is open.
// Always resolve the current participant-relative state on navigation/refresh
// so an invite owner cannot remain on the pre-join waiting screen.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function PairPage({ params }: { params: Promise<{ pairId: string }> }) {
  return (
    <Suspense fallback={<CloserRouteLoading variant="home" />}>
      <PairPageContent params={params} />
    </Suspense>
  );
}
