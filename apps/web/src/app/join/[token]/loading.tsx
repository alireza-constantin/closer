import { JoinInvitationDetailsSkeleton, JoinInvitationFrame } from "@/components/join-invitation-frame";
import { CloserPageShell, CloserTopbar } from "@/components/closer/page-shell";

export default function Loading() {
  return (
    <CloserPageShell className="flex flex-col">
      <CloserTopbar />
      <div className="flex flex-1 items-center py-10">
        <JoinInvitationFrame><JoinInvitationDetailsSkeleton /></JoinInvitationFrame>
      </div>
    </CloserPageShell>
  );
}
