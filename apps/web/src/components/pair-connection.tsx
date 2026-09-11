"use client";

import { CheckCircle2, UsersRound } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { Card, CardContent, CardHeader, CardTitle } from "@Closer/ui/components/card";

import InviteControls from "@/components/invite-controls";
import { CloserCompanions, CloserPageShell, CloserTopbar } from "@/components/closer/page-shell";
import { CloserModeCard } from "@/components/closer/navigation";
import { CloserEyebrow } from "@/components/closer/typography";
import { useVisiblePolling } from "@/hooks/use-visible-polling";

export const PAIR_STATUS_POLL_INTERVAL_MS = 5_000;

type PairMember = { slot: "first" | "second"; displayName: string };
type PairStatus = { state: "waiting" } | { state: "connected"; otherParticipantDisplayName: string };

function parsePairStatus(value: unknown): PairStatus | null {
  if (!value || typeof value !== "object" || !("state" in value)) return null;
  if (value.state === "waiting") return { state: "waiting" };
  if (value.state === "connected" && "otherParticipantDisplayName" in value && typeof value.otherParticipantDisplayName === "string") {
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
  const isConnected = secondMemberName !== null;

  useEffect(() => {
    if (!initialSecondMemberName) return;
    try {
      router.replace(`/pair/${pairId}` as never);
    } catch {
      window.location.assign(`/pair/${pairId}`);
    }
  }, [initialSecondMemberName, pairId, router]);

  useVisiblePolling({
    enabled: !isConnected && !isRedirecting,
    forceOnForeground: true,
    intervalMs: PAIR_STATUS_POLL_INTERVAL_MS,
    onPoll: async (signal) => {
      try {
        const response = await fetch(`/api/pairs/${encodeURIComponent(pairId)}/status`, { cache: "no-store", signal });
        if (!response.ok) return;
        const status = parsePairStatus(await response.json());
        if (status?.state !== "connected") return;
        setSecondMemberName(status.otherParticipantDisplayName);
        setJoinedDisplayName(status.otherParticipantDisplayName);
        setIsRedirecting(true);
        try {
          router.replace(`/pair/${pairId}` as never);
        } catch {
          window.location.assign(`/pair/${pairId}`);
        }
      } catch {
        // A transient status failure leaves the invite state intact for the next check.
      }
    },
  });

  return (
    <CloserPageShell className="flex flex-col gap-5">
      <CloserTopbar />
      <section className="pt-3 text-center">
        <CloserCompanions className="mb-2" />
        <CloserEyebrow>Your {relationshipType} space</CloserEyebrow>
        <h1 className="mt-2 text-[2.2rem] font-extrabold leading-tight tracking-[-.055em]">{isConnected ? "You’re connected" : "Invite your person"}</h1>
        <p className="mt-2 text-closer-muted">{isConnected ? "Your space for two is ready." : "Share one simple link to bring them in."}</p>
        {joinedDisplayName ? <p className="mx-auto mt-4 inline-flex items-center gap-2 rounded-full bg-closer-mint px-3 py-2 text-sm text-closer-success-foreground" role="status"><CheckCircle2 aria-hidden="true" className="size-4" /><span><strong>{joinedDisplayName}</strong> joined</span></p> : null}
      </section>
      <Card>
        <CardHeader><CardTitle>Your little duo</CardTitle></CardHeader>
        <CardContent>
          <ol className="grid gap-3">
            <li className="flex items-center gap-2.5 font-bold"><span aria-hidden="true" className="size-4 rounded-[57%_43%_46%_54%] bg-closer-coral" />{firstMemberName}</li>
            <li className="flex items-center gap-2.5 font-bold"><span aria-hidden="true" className="size-4 rounded-[57%_43%_46%_54%] bg-closer-lavender" />{secondMemberName ?? "Waiting for them"}</li>
          </ol>
        </CardContent>
      </Card>
      {!isConnected && !isRedirecting ? <InviteControls pairId={pairId} /> : null}
      {!isConnected && !isRedirecting ? <CloserModeCard href={`/pair/${pairId}/together`} kind="together" icon={<UsersRound aria-hidden="true" />} title="Talk Together" description="You can start a shared conversation before they join." className="mt-auto" /> : null}
      {isConnected || isRedirecting ? <p className="text-center text-sm text-closer-muted" role="status">Opening your shared space…</p> : null}
      {isConnected && !isRedirecting ? <Link className="text-center text-sm text-closer-muted underline-offset-4 hover:text-closer-navy hover:underline" href={`/pair/${pairId}` as never}>Open your space</Link> : null}
    </CloserPageShell>
  );
}
