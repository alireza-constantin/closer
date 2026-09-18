"use client";

import { AlertTriangle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@Closer/ui/components/button";

import { AsyncButton } from "@/components/closer/async-button";

export function PairTerminationControl({
  pairId,
  isComplete,
}: {
  pairId: string;
  isComplete: boolean;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const action = isComplete ? "Unpair" : "End this space";

  async function terminate() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/pairs/${encodeURIComponent(pairId)}/terminate`, {
        method: "POST",
      });
      if (!response.ok) throw new Error();
      router.replace(`/pair/${pairId}` as never);
    } catch {
      setError("We couldn't end this space. Please try again.");
      setPending(false);
    }
  }

  if (!confirming) {
    return (
      <Button
        className="mx-auto mt-8"
        onClick={() => setConfirming(true)}
        type="button"
        variant="destructive"
      >
        {action}
      </Button>
    );
  }

  return (
    <section
      aria-describedby="pair-termination-details"
      aria-labelledby="pair-termination-title"
      className="border-destructive/20 shadow-closer-soft mt-8 rounded-[1.35rem] border bg-white/80 p-5"
    >
      <div className="flex items-start gap-3">
        <span className="bg-destructive/10 text-destructive grid size-10 shrink-0 place-items-center rounded-full">
          <AlertTriangle aria-hidden="true" className="size-5" />
        </span>
        <div>
          <h2 className="font-extrabold" id="pair-termination-title">
            {action}?
          </h2>
          <p
            className="text-closer-muted mt-2 text-sm leading-relaxed"
            id="pair-termination-details"
          >
            This space will become read-only. Conversations cannot continue, active Together
            activity ends, and invitation or rejoin links stop working. If you reconnect later, it
            will be a new space. Your existing history is not deleted.
          </p>
        </div>
      </div>
      {error ? (
        <p className="text-destructive mt-3 text-sm font-bold" role="status">
          {error}
        </p>
      ) : null}
      <div className="mt-5 flex flex-wrap gap-2">
        <AsyncButton
          onClick={terminate}
          pending={pending}
          pendingText="Ending…"
          type="button"
          variant="destructive"
        >
          Yes, {action.toLowerCase()}
        </AsyncButton>
        <Button
          disabled={pending}
          onClick={() => setConfirming(false)}
          type="button"
          variant="ghost"
        >
          Cancel
        </Button>
      </div>
    </section>
  );
}
