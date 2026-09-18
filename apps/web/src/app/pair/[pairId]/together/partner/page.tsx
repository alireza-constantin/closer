import TogetherPicker from "@/features/together-session/components/together-picker";
import { TogetherPickerFrame } from "@/features/together-session/components/together-picker-frame";

export const dynamic = "force-static";

export default async function PartnerTogetherPickerPage({
  params,
}: {
  params: Promise<{ pairId: string }>;
}) {
  const { pairId } = await params;

  return (
    <TogetherPickerFrame pairId={pairId}>
      <TogetherPicker pairId={pairId} relationshipType="partner" />
    </TogetherPickerFrame>
  );
}
