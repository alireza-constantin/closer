"use client";

import { LockKeyhole, MessageCircleMore, Sparkles } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type PairCreation = { pairId: string; inviteToken: string; expiresAt: string };

const PAIR_STATUS_POLL_INTERVAL_MS = 4_000;

function isConnectedPairStatus(value: unknown): value is { state: "connected"; otherParticipantDisplayName: string } {
  return (
    !!value &&
    typeof value === "object" &&
    "state" in value &&
    value.state === "connected" &&
    "otherParticipantDisplayName" in value &&
    typeof value.otherParticipantDisplayName === "string"
  );
}

export default function CreatePairForm() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [relationshipType, setRelationshipType] = useState<"partner" | "friend">("partner");
  const [result, setResult] = useState<PairCreation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [joinedDisplayName, setJoinedDisplayName] = useState<string | null>(null);
  const intervalRef = useRef<number | null>(null);
  const creationRequestIdRef = useRef<string | null>(null);
  const stoppedRef = useRef(false);
  const navigatedRef = useRef(false);

  useEffect(() => {
    if (!result) return;
    const createdPairId = result.pairId;

    stoppedRef.current = false;
    navigatedRef.current = false;
    let disposed = false;
    let activeRequest: AbortController | null = null;

    function clearPollingTimer() {
      if (intervalRef.current === null) return;
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    function openConnectedPair() {
      if (disposed || navigatedRef.current) return;
      navigatedRef.current = true;
      stoppedRef.current = true;
      clearPollingTimer();
      try {
        router.replace(`/pair/${createdPairId}` as never);
      } catch {
        window.location.assign(`/pair/${createdPairId}`);
      }
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
        const response = await fetch(`/api/pairs/${encodeURIComponent(createdPairId)}/status`, {
          cache: "no-store",
          signal: request.signal,
        });
        if (!response.ok) return;

        const status: unknown = await response.json();
        if (disposed || document.visibilityState !== "visible" || !isConnectedPairStatus(status)) return;

        setJoinedDisplayName(status.otherParticipantDisplayName);
        openConnectedPair();
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          // Keep the invite state intact; the next foreground check can recover.
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
  }, [result, router]);

  async function createPair(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const clientRequestId = creationRequestIdRef.current ?? crypto.randomUUID();
      creationRequestIdRef.current = clientRequestId;
      const response = await fetch("/api/pairs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ displayName, relationshipType, clientRequestId }),
      });
      const body: unknown = await response.json();
      if (!response.ok || !body || typeof body !== "object" || !("pairId" in body)) {
        const message = body && typeof body === "object" && "error" in body ? body.error : null;
        setError(typeof message === "string" ? message : "We could not create your space.");
        return;
      }
      setResult(body as PairCreation);
    } catch {
      setError("We could not create your space.");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (result) {
    return (
      <section className="closer-onboarding-card closer-mode-choice-card">
        <span className="closer-onboarding-icon closer-icon-coral"><Sparkles aria-hidden="true" /></span>
        <p className="closer-eyebrow">Your space is ready</p>
        <h1>How do you want to connect?</h1>
        <p className="closer-onboarding-copy">Choose the kind of moment you want right now. You can bring your person in when you’re ready.</p>
        <div className="closer-mode-stack closer-onboarding-mode-stack">
          <Link className="closer-mode-card closer-mode-card-together" href={`/pair/${result.pairId}/together` as never}>
            <span className="closer-mode-icon"><MessageCircleMore aria-hidden="true" /></span>
            <span><strong>Together</strong><small>Use this phone and talk face-to-face.</small></span>
            <span aria-hidden="true">›</span>
          </Link>
          <Link className="closer-mode-card closer-mode-card-private" href={`/pair/${result.pairId}/private` as never}>
            <span className="closer-mode-icon"><LockKeyhole aria-hidden="true" /></span>
            <span><strong>Private</strong><small>Answer separately on your own phones.</small></span>
            <span aria-hidden="true">›</span>
          </Link>
        </div>
        <Link className="closer-text-link" href={`/pair/${result.pairId}` as never}>I’ll choose later</Link>
        {joinedDisplayName ? (
          <p className="closer-joined-notice" role="status">
            <strong>{joinedDisplayName}</strong> joined. Opening your shared space…
          </p>
        ) : null}
        {error ? <p className="closer-form-error" role="alert">{error}</p> : null}
      </section>
    );
  }

  return (
    <form className="closer-onboarding-card" onSubmit={createPair}>
      <span className="closer-onboarding-icon closer-icon-coral"><Sparkles aria-hidden="true" /></span>
      <p className="closer-eyebrow">A space for two</p>
      <h1>Let’s create your space</h1>
      <p className="closer-onboarding-copy">A gentle place for the conversations that matter.</p>
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
      <fieldset className="closer-relationship-choice">
        <legend>Who are you creating this with?</legend>
        <label className={relationshipType === "partner" ? "is-selected" : ""}>
          <input checked={relationshipType === "partner"} name="relationship-type" onChange={() => { creationRequestIdRef.current = null; setRelationshipType("partner"); }} type="radio" />
          <span>Partner</span><small>For the two of you</small>
        </label>
        <label className={relationshipType === "friend" ? "is-selected" : ""}>
          <input checked={relationshipType === "friend"} name="relationship-type" onChange={() => { creationRequestIdRef.current = null; setRelationshipType("friend"); }} type="radio" />
          <span>Friend</span><small>For close friends</small>
        </label>
      </fieldset>
      {error ? <p className="closer-form-error" role="alert">{error}</p> : null}
      <button className="closer-primary-button closer-wide-button" disabled={isSubmitting} type="submit">{isSubmitting ? "Creating your space…" : "Create our space"}</button>
    </form>
  );
}
