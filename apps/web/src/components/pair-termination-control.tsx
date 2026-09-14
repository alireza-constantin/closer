"use client";

import { AlertTriangle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@Closer/ui/components/button";

import { AsyncButton } from "@/components/closer/async-button";

export function PairTerminationControl({ pairId, isComplete }: { pairId: string; isComplete: boolean }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const action = isComplete ? "Unpair" : "End this space";

  async function terminate() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/pairs/${encodeURIComponent(pairId)}/terminate`, { method: "POST" });
      if (!response.ok) throw new Error();
      router.replace(`/pair/${pairId}/history` as never);
      router.refresh();
    } catch {
      setError("We couldn't end this space. Please try again.");
      setPending(false);
    }
  }

  if (!confirming) {
    return <Button className="mx-auto mt-8" onClick={() => setConfirming(true)} type="button" variant="destructive">{action}</Button>;
  }

  return (
    <section aria-describedby="pair-termination-details" aria-labelledby="pair-termination-title" className="mt-8 rounded-[1.35rem] border border-destructive/20 bg-white/80 p-5 shadow-closer-soft">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-destructive/10 text-destructive"><AlertTriangle aria-hidden="true" className="size-5" /></span>
        <div>
          <h2 className="font-extrabold" id="pair-termination-title">{action}?</h2>
          <p className="mt-2 text-sm leading-relaxed text-closer-muted" id="pair-termination-details">This space will become read-only. Conversations cannot continue, active Together activity ends, and invitation or rejoin links stop working. If you reconnect later, it will be a new space. Your existing history is not deleted.</p>
        </div>
      </div>
      {error ? <p className="mt-3 text-sm font-bold text-destructive" role="status">{error}</p> : null}
      <div className="mt-5 flex flex-wrap gap-2">
        <AsyncButton onClick={terminate} pending={pending} pendingText="Ending…" type="button" variant="destructive">Yes, {action.toLowerCase()}</AsyncButton>
        <Button disabled={pending} onClick={() => setConfirming(false)} type="button" variant="ghost">Cancel</Button>
      </div>
    </section>
  );
}
