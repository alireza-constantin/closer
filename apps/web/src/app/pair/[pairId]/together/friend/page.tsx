import TogetherPicker from "@/components/together-picker";
import { TogetherPickerFrame } from "@/components/together-picker-frame";

export const dynamic = "force-static";

export default async function FriendTogetherPickerPage({ params }: { params: Promise<{ pairId: string }> }) {
  const { pairId } = await params;

  return (
    <TogetherPickerFrame pairId={pairId}>
      <TogetherPicker pairId={pairId} relationshipType="friend" />
    </TogetherPickerFrame>
  );
}
