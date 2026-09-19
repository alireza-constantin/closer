import { notFound, redirect, unstable_rethrow } from "next/navigation";

import PrivatePicker from "@/features/private-conversation/components/private-picker";
import { getCurrentParticipant } from "@/server/auth/current-participant";
import { getAuthorizedPair } from "@/server/modules/pairs/pair.service";

export default async function PrivatePickerPageContent({
  params,
}: {
  params: Promise<{ pairId: string }>;
}) {
  const { pairId } = await params;
  const currentParticipant = await getCurrentParticipant();
  if (!currentParticipant) notFound();
  try {
    const pairView = await getAuthorizedPair(currentParticipant.id, pairId);
    if (pairView.members.length !== 2) redirect(`/pair/${pairId}/invite?reason=private` as never);
    return <PrivatePicker pairId={pairId} relationshipType={pairView.pair.relationshipType} />;
  } catch (error) {
    unstable_rethrow(error);
    notFound();
  }
}
