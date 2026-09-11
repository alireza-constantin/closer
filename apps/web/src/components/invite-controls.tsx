"use client";

import { Check, Copy, Link as LinkIcon, RotateCcw, Share2 } from "lucide-react";
import { useEffect, useState } from "react";

import InviteQrCode from "@/components/invite-qr-code";

type InviteKind = "initial" | "rejoin";

export default function InviteControls({
  pairId,
  kind = "initial",
  autoGenerate = false,
}: {
  pairId: string;
  kind?: InviteKind;
  autoGenerate?: boolean;
}) {
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isWorking, setIsWorking] = useState(false);
  const [didCopy, setDidCopy] = useState(false);
  const [canShare, setCanShare] = useState(false);
  const endpoint = `/api/pairs/${encodeURIComponent(pairId)}/${kind === "initial" ? "invite" : "rejoin"}`;
  const isRejoin = kind === "rejoin";

  useEffect(() => {
    setCanShare(typeof navigator !== "undefined" && typeof navigator.share === "function");
  }, []);

  async function generateInvite() {
    setIsWorking(true);
    setMessage(null);
    setDidCopy(false);
    try {
      const response = await fetch(endpoint, { method: "POST" });
      const body: unknown = await response.json();
      if (!response.ok || !body || typeof body !== "object" || !("token" in body) || typeof body.token !== "string") {
        if (isRejoin && response.status === 409) {
          setMessage("They still have an active guest session. A fresh rejoin link is only needed after that session is lost.");
        } else {
          setMessage(isRejoin ? "A fresh rejoin link is not available yet." : "Unable to create an invite.");
        }
        return;
      }
      setInviteUrl(`${window.location.origin}/${isRejoin ? "rejoin" : "join"}/${body.token}`);
    } catch {
      setMessage(isRejoin ? "Unable to create a rejoin link." : "Unable to create an invite.");
    } finally {
      setIsWorking(false);
    }
  }

  useEffect(() => {
    if (autoGenerate) void generateInvite();
    // The endpoint is derived from stable route props; generating once is intentional.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoGenerate]);

  async function copyInvite() {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setDidCopy(true);
      setMessage(null);
    } catch {
      setMessage("We couldn’t copy the link. You can select it instead.");
    }
  }

  async function shareInvite() {
    if (!inviteUrl || typeof navigator.share !== "function") return;
    try {
      await navigator.share({
        title: isRejoin ? "Reconnect with Closer" : "Join us on Closer",
        text: isRejoin ? "Use this link to reconnect with our Closer space." : "Join our Closer space.",
        url: inviteUrl,
      });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        setMessage("We couldn’t open sharing. You can copy the link instead.");
      }
    }
  }

  async function revokeInvite() {
    setIsWorking(true);
    setMessage(null);
    try {
      const response = await fetch(endpoint, { method: "DELETE" });
      if (!response.ok) {
        setMessage(isRejoin ? "Unable to revoke the rejoin link." : "Unable to revoke the invite.");
        return;
      }
      setInviteUrl(null);
      setDidCopy(false);
      setMessage(isRejoin ? "The outstanding rejoin link was revoked." : "The outstanding invitation was revoked.");
    } catch {
      setMessage(isRejoin ? "Unable to revoke the rejoin link." : "Unable to revoke the invite.");
    } finally {
      setIsWorking(false);
    }
  }

  return (
    <section className={`closer-invite-controls ${isRejoin ? "closer-rejoin-controls" : ""}`}>
      <span className="closer-onboarding-icon closer-icon-peach"><LinkIcon aria-hidden="true" /></span>
      <h2>{isRejoin ? "Reconnect your person" : "Bring them into your space"}</h2>
      <p>{isRejoin ? "If they’ve lost their guest session, create a fresh link for their place in your space." : "Share a private link, or let them scan the code from their phone."}</p>
      {inviteUrl ? (
        <>
          <div className="closer-qr-card">
            <InviteQrCode value={inviteUrl} />
            <p>Scan this QR code</p>
          </div>
          <label className="closer-input-label" htmlFor={`${kind}-invite-url`}>Your {isRejoin ? "rejoin" : "invite"} link</label>
          <input aria-label={`${isRejoin ? "Rejoin" : "Initial invite"} URL`} className="closer-onboarding-input" id={`${kind}-invite-url`} readOnly value={inviteUrl} />
        </>
      ) : null}
      {message ? <p className="closer-invite-message" role="status">{message}</p> : null}
      <div className="closer-invite-actions">
        <button className="closer-primary-button" disabled={isWorking} onClick={() => void generateInvite()} type="button">
          {isWorking ? "Getting it ready…" : inviteUrl ? "Make a fresh link" : isRejoin ? "Create rejoin link" : "Create invite link"}
        </button>
        {inviteUrl ? (
          <div className="closer-invite-secondary-actions">
            <button className="closer-secondary-button" disabled={isWorking} onClick={() => void copyInvite()} type="button"><Copy aria-hidden="true" /> {didCopy ? <><Check aria-hidden="true" /> Copied</> : "Copy link"}</button>
            {canShare ? <button className="closer-secondary-button" disabled={isWorking} onClick={() => void shareInvite()} type="button"><Share2 aria-hidden="true" /> Share</button> : null}
          </div>
        ) : null}
        {inviteUrl ? <button className="closer-text-button" disabled={isWorking} onClick={() => void revokeInvite()} type="button"><RotateCcw aria-hidden="true" /> Revoke link</button> : null}
      </div>
    </section>
  );
}
