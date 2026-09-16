import { db, getPairForParticipant } from "@Closer/auth/closer";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import TogetherPicker from "@/components/together-picker";
import { TogetherPickerFrame } from "@/components/together-picker-frame";
import { TogetherPickerLoading } from "@/components/closer/route-loading";
import { getCurrentParticipant } from "@/lib/closer-server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function TogetherPickerContent({ pairId }: { pairId: string }) {
  const currentParticipant = await getCurrentParticipant();
  if (!currentParticipant) notFound();
  try {
    const pairView = await getPairForParticipant(db, currentParticipant.id, pairId);
    return <TogetherPicker pairId={pairId} relationshipType={pairView.pair.relationshipType} />;
  } catch {
    notFound();
  }
}

export default async function TogetherPickerPage({ params }: { params: Promise<{ pairId: string }> }) {
  const { pairId } = await params;

  return (
    <TogetherPickerFrame pairId={pairId}>
      <Suspense fallback={<TogetherPickerLoading />}>
        <TogetherPickerContent pairId={pairId} />
      </Suspense>
    </TogetherPickerFrame>
  );
}
