"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { useRouter } from "next/navigation";

import InviteControls from "@/components/invite-controls";

export const PAIR_STATUS_POLL_INTERVAL_MS = 5_000;

type PairMember = {
  slot: "first" | "second";
  displayName: string;
};

type PairStatus =
  | { state: "waiting" }
  | { state: "connected"; otherParticipantDisplayName: string };

function parsePairStatus(value: unknown): PairStatus | null {
  if (!value || typeof value !== "object" || !("state" in value)) return null;

  if (value.state === "waiting") return { state: "waiting" };
  if (
    value.state === "connected" &&
    "otherParticipantDisplayName" in value &&
    typeof value.otherParticipantDisplayName === "string"
  ) {
    return { state: "connected", otherParticipantDisplayName: value.otherParticipantDisplayName };
  }

  return null;
}

export default function PairConnection({
  pairId,
  relationshipType,
  initialMembers,
}: {
  pairId: string;
  relationshipType: "partner" | "friend";
  initialMembers: PairMember[];
}) {
  const router = useRouter();
  const initialSecondMemberName = initialMembers.find((member) => member.slot === "second")?.displayName ?? null;
  const firstMemberName = initialMembers.find((member) => member.slot === "first")?.displayName ?? "Awaiting member";
  const [secondMemberName, setSecondMemberName] = useState(initialSecondMemberName);
  const [joinedDisplayName, setJoinedDisplayName] = useState<string | null>(null);
  const intervalRef = useRef<number | null>(null);
  const refreshTimeoutRef = useRef<number | null>(null);
  const stoppedRef = useRef(initialSecondMemberName !== null);

  useEffect(() => {
    if (initialSecondMemberName) return;

    let disposed = false;
    let activeRequest: AbortController | null = null;

    function clearPollingTimer() {
      if (intervalRef.current === null) return;
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    function stopPolling() {
      stoppedRef.current = true;
      clearPollingTimer();
    }

    async function checkStatus(force = false) {
      if (disposed || stoppedRef.current || document.visibilityState !== "visible") return;
      if (activeRequest) {
        if (!force) return;
        activeRequest.abort();
      }

      const request = new AbortController();
      activeRequest = request;
      try {
        const response = await fetch(`/api/pairs/${encodeURIComponent(pairId)}/status`, {
          cache: "no-store",
          signal: request.signal,
        });
        if (!response.ok) return;

        const status = parsePairStatus(await response.json());
        if (disposed || document.visibilityState !== "visible" || status?.state !== "connected") return;

        setSecondMemberName(status.otherParticipantDisplayName);
        setJoinedDisplayName(status.otherParticipantDisplayName);
        stopPolling();
        refreshTimeoutRef.current = window.setTimeout(() => {
          if (disposed) return;
          setJoinedDisplayName(null);
          router.refresh();
        }, 2_000);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          // A transient status failure should leave the invite state intact for the next check.
        }
      } finally {
        if (activeRequest === request) activeRequest = null;
      }
    }

    function startPolling() {
      if (disposed || stoppedRef.current || document.visibilityState !== "visible" || intervalRef.current !== null) {
        return;
      }
      intervalRef.current = window.setInterval(() => void checkStatus(), PAIR_STATUS_POLL_INTERVAL_MS);
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        void checkStatus(true);
        startPolling();
      } else {
        clearPollingTimer();
        activeRequest?.abort();
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    void checkStatus();
    startPolling();

    return () => {
      disposed = true;
      clearPollingTimer();
      if (refreshTimeoutRef.current !== null) window.clearTimeout(refreshTimeoutRef.current);
      activeRequest?.abort();
    };
  }, [initialSecondMemberName, pairId, router]);

  const isConnected = secondMemberName !== null;

  return (
    <>
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold">Your {relationshipType} pair</h1>
        <p className="text-muted-foreground">
          {isConnected ? "Both members are connected." : "Your second slot is ready for an invite."}
        </p>
        {joinedDisplayName ? (
          <p className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-300" role="status">
            <CheckCircle2 aria-hidden="true" className="size-4" />
            <span>
              <span className="font-medium">{joinedDisplayName}</span> joined
            </span>
          </p>
        ) : null}
      </div>
      <section className="rounded border p-5">
        <h2 className="font-semibold">Members</h2>
        <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm">
          <li>{firstMemberName}</li>
          <li>{secondMemberName ?? "Awaiting member"}</li>
        </ol>
      </section>
      {!isConnected ? <InviteControls pairId={pairId} /> : null}
    </>
  );
}
