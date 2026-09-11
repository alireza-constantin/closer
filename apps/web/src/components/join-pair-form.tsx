"use client";

import { Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function JoinPairForm({
  token,
  inviterDisplayName,
  kind = "initial",
  unavailable = false,
}: {
  token: string;
  inviterDisplayName: string | null;
  kind?: "initial" | "rejoin";
  unavailable?: boolean;
}) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function joinPair(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const response = await fetch(`/api/${kind === "rejoin" ? "rejoin" : "invites"}/${encodeURIComponent(token)}/redeem`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ displayName }),
      });
      const body: unknown = await response.json();
      if (!response.ok || !body || typeof body !== "object" || !("pairId" in body)) {
        setError(kind === "rejoin"
          ? "This rejoin link is unavailable. It may have expired, been revoked, or already been used."
          : "This invitation is unavailable. It may have expired, been revoked, or already been used.");
        return;
      }
      // The invite is consumed; keep the joined pair as the canonical back
      // destination instead of allowing Back to return to onboarding.
      router.replace(`/pair/${String(body.pairId)}` as never);
    } catch {
      setError(kind === "rejoin" ? "This rejoin link is unavailable. Please try again." : "This invitation is unavailable. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="closer-onboarding-card closer-join-card" onSubmit={joinPair}>
      <span className="closer-onboarding-icon closer-icon-lavender"><Sparkles aria-hidden="true" /></span>
      <p className="closer-eyebrow">{kind === "rejoin" ? "A way back to Closer" : "An invitation for you"}</p>
      <h1>{kind === "rejoin" ? "Reconnect with your space" : inviterDisplayName ? `${inviterDisplayName} invited you` : "You’re invited"}</h1>
      <p className="closer-onboarding-copy">{kind === "rejoin" ? "Choose a name to return to your place in this space. No sign-up needed." : "Add your name to join this little space for two. No sign-up needed."}</p>
      {unavailable ? <p className="closer-form-error" role="alert">{kind === "rejoin" ? "This rejoin link is unavailable. It may have expired, been revoked, or already been used." : "This invitation is unavailable. It may have expired, been revoked, or already been used."}</p> : null}
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
      <button className="closer-primary-button closer-wide-button" disabled={isSubmitting || unavailable} type="submit">{isSubmitting ? "Joining…" : kind === "rejoin" ? "Reconnect" : "Join"}</button>
    </form>
  );
}
