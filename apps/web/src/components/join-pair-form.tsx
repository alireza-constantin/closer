"use client";

import { Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function JoinPairForm({ token, inviterDisplayName }: { token: string; inviterDisplayName: string | null }) {
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
      // The invite is consumed; keep the joined pair as the canonical back
      // destination instead of allowing Back to return to onboarding.
      router.replace(`/pair/${String(body.pairId)}` as never);
    } catch {
      setError("This invitation is unavailable. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="closer-onboarding-card closer-join-card" onSubmit={joinPair}>
      <span className="closer-onboarding-icon closer-icon-lavender"><Sparkles aria-hidden="true" /></span>
      <p className="closer-eyebrow">An invitation for you</p>
      <h1>{inviterDisplayName ? `${inviterDisplayName} invited you` : "You’re invited"}</h1>
      <p className="closer-onboarding-copy">Add your name to join this little space for two. No sign-up needed.</p>
      <label className="closer-input-label" htmlFor="display-name">Your name</label>
      <input
        autoComplete="name"
        className="closer-onboarding-input"
        id="display-name"
        maxLength={40}
        onChange={(event) => setDisplayName(event.target.value)}
        placeholder="What should they call you?"
        required
        value={displayName}
      />
      {error ? <p className="closer-form-error" role="alert">{error}</p> : null}
      <button className="closer-primary-button closer-wide-button" disabled={isSubmitting} type="submit">{isSubmitting ? "Joining…" : "Join"}</button>
    </form>
  );
}
