"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@Closer/ui/components/button";
import { Input } from "@Closer/ui/components/input";
import { Label } from "@Closer/ui/components/label";

export default function JoinPairForm({ token }: { token: string }) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function joinPair(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const response = await fetch(`/api/invites/${encodeURIComponent(token)}/redeem`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ displayName }),
      });
      const body: unknown = await response.json();
      if (!response.ok || !body || typeof body !== "object" || !("pairId" in body)) {
        setError("This invitation is unavailable. It may have expired, been revoked, or already been used.");
        return;
      }
      router.push(`/pair/${String(body.pairId)}` as never);
    } catch {
      setError("This invitation is unavailable. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="space-y-5 rounded border p-5" onSubmit={joinPair}>
      <div className="space-y-2">
        <Label htmlFor="display-name">Your display name</Label>
        <Input
          id="display-name"
          maxLength={40}
          onChange={(event) => setDisplayName(event.target.value)}
          required
          value={displayName}
        />
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <Button disabled={isSubmitting} type="submit">
        {isSubmitting ? "Joining…" : "Join pair"}
      </Button>
    </form>
  );
}
