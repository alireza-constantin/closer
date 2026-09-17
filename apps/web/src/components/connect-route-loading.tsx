"use client";

import { useParams } from "next/navigation";

import { ConnectPageFrame } from "@/components/connect-page-frame";
import { InviteControlsSkeleton } from "@/components/invite-controls";

/** Matches the final Connect layout while an authorized route transition resolves. */
export function ConnectRouteLoading() {
  const params = useParams<{ pairId?: string }>();

  return (
    <ConnectPageFrame pairId={params.pairId}>
      <InviteControlsSkeleton />
    </ConnectPageFrame>
  );
}
