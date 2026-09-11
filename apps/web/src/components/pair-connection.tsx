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
  const [isRedirecting, setIsRedirecting] = useState(initialSecondMemberName !== null);
  const intervalRef = useRef<number | null>(null);
  const stoppedRef = useRef(initialSecondMemberName !== null);

  useEffect(() => {
    function openConnectedPair() {
      setIsRedirecting(true);
      try {
        router.replace(`/pair/${pairId}` as never);
      } catch {
        // A failed soft navigation should still recover to the server-rendered
        // connected state on a full request.
        window.location.assign(`/pair/${pairId}`);
      }
    }

    // This covers a stale client shell that happens to receive connected
    // membership props during a refresh. The pair home is the only useful
    // destination once both slots are occupied.
    if (initialSecondMemberName) {
      openConnectedPair();
      return;
    }

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
        setIsRedirecting(true);
        stopPolling();
        // The pair page is the canonical connected destination. Replace the
        // invite route immediately so a successful join never leaves the
        // creator stranded on the waiting scaffold.
        try {
          router.replace(`/pair/${pairId}` as never);
        } catch {
          window.location.assign(`/pair/${pairId}`);
        }
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

    function handleFocus() {
      void checkStatus(true);
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleFocus);
    void checkStatus();
    startPolling();

    return () => {
      disposed = true;
      clearPollingTimer();
      activeRequest?.abort();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleFocus);
    };
  }, [initialSecondMemberName, pairId, router]);

  const isConnected = secondMemberName !== null;

  return (
    <>
      <header className="closer-topbar"><span className="closer-wordmark">Closer <span aria-hidden="true">♥</span></span><span className="closer-pair-mark" aria-hidden="true"><i /> <i /></span></header>
      <section className="closer-connection-intro">
        <div className="closer-companions" aria-hidden="true"><span className="closer-companion closer-companion-coral">•‿•</span><span className="closer-companion closer-companion-lavender">⌣⌣</span></div>
        <p className="closer-eyebrow">Your {relationshipType} space</p>
        <h1>{isConnected ? "You’re connected" : "Invite your person"}</h1>
        <p>{isConnected ? "Your space for two is ready." : "Share one simple link to bring them in."}</p>
        {joinedDisplayName ? (
          <p className="closer-joined-notice" role="status">
            <CheckCircle2 aria-hidden="true" /> <span><strong>{joinedDisplayName}</strong> joined</span>
          </p>
        ) : null}
      </section>
      <section className="closer-members-card">
        <h2>Your little duo</h2>
        <ol>
          <li><span className="closer-member-dot closer-member-first" aria-hidden="true" />{firstMemberName}</li>
          <li><span className="closer-member-dot closer-member-second" aria-hidden="true" />{secondMemberName ?? "Waiting for them"}</li>
        </ol>
      </section>
      {!isConnected && !isRedirecting ? <InviteControls pairId={pairId} /> : null}
      {isConnected || isRedirecting ? (
        <p className="closer-joined-notice" role="status">Opening your shared space…</p>
      ) : null}
    </>
  );
}
