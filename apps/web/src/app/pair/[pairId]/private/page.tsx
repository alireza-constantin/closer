import { Suspense } from "react";

import PrivatePickerPageContent from "./_components/private-picker-page-content";
import { PrivatePickerSkeleton } from "@/features/private-conversation/components/private-route-skeletons";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function PrivatePickerPage({ params }: { params: Promise<{ pairId: string }> }) {
  return (
    <Suspense fallback={<PrivatePickerSkeleton />}>
      <PrivatePickerPageContent params={params} />
    </Suspense>
  );
}
