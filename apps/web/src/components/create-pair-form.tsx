"use client";

import { useState } from "react";

import { Button } from "@Closer/ui/components/button";
import { Input } from "@Closer/ui/components/input";
import { Label } from "@Closer/ui/components/label";

type PairCreation = {
  pairId: string;
  inviteToken: string;
  expiresAt: string;
};

export default function CreatePairForm() {
  const [displayName, setDisplayName] = useState("");
  const [relationshipType, setRelationshipType] = useState<"partner" | "friend">("partner");
  const [result, setResult] = useState<PairCreation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const inviteUrl = result ? `${window.location.origin}/join/${result.inviteToken}` : null;

  async function createPair(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/pairs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ displayName, relationshipType }),
      });
      const body: unknown = await response.json();
      if (!response.ok || !body || typeof body !== "object" || !("pairId" in body)) {
        const message = body && typeof body === "object" && "error" in body ? body.error : null;
        setError(typeof message === "string" ? message : "We could not create your pair.");
        return;
      }
      setResult(body as PairCreation);
    } catch {
      setError("We could not create your pair.");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (result && inviteUrl) {
    return (
      <section className="space-y-4 rounded border p-5">
        <h2 className="text-lg font-semibold">Your pair is ready</h2>
        <p className="text-sm text-muted-foreground">
          Share this single-use link with the person you want to invite. It expires in seven days.
        </p>
        <Input aria-label="Initial invite URL" readOnly value={inviteUrl} />
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => void navigator.clipboard.writeText(inviteUrl)}>
            Copy invite link
          </Button>
          <a className="inline-flex h-8 items-center border border-border px-2.5 text-xs font-medium" href={`/pair/${result.pairId}`}>
            Open pair
          </a>
        </div>
      </section>
    );
  }

  return (
    <form className="space-y-5 rounded border p-5" onSubmit={createPair}>
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
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">You are creating a</legend>
        <label className="mr-4 inline-flex items-center gap-2 text-sm">
          <input
            checked={relationshipType === "partner"}
            name="relationship-type"
            onChange={() => setRelationshipType("partner")}
            type="radio"
          />
          Partner pair
        </label>
        <label className="inline-flex items-center gap-2 text-sm">
          <input
            checked={relationshipType === "friend"}
            name="relationship-type"
            onChange={() => setRelationshipType("friend")}
            type="radio"
          />
          Friend pair
        </label>
      </fieldset>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <Button disabled={isSubmitting} type="submit">
        {isSubmitting ? "Creating…" : "Create pair"}
      </Button>
    </form>
  );
}
