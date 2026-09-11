"use client";

import { useState } from "react";

import { Copy, Link as LinkIcon, RotateCcw } from "lucide-react";

export default function InviteControls({ pairId }: { pairId: string }) {
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isWorking, setIsWorking] = useState(false);

  async function generateInvite() {
    setIsWorking(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/pairs/${pairId}/invite`, { method: "POST" });
      const body: unknown = await response.json();
      if (!response.ok || !body || typeof body !== "object" || !("token" in body)) {
        setMessage("Unable to create an invite.");
        return;
      }
      setInviteUrl(`${window.location.origin}/join/${String(body.token)}`);
    } catch {
      setMessage("Unable to create an invite.");
    } finally {
      setIsWorking(false);
    }
  }

  async function revokeInvite() {
    setIsWorking(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/pairs/${pairId}/invite`, { method: "DELETE" });
      if (!response.ok) {
        setMessage("Unable to revoke the invite.");
        return;
      }
      setInviteUrl(null);
      setMessage("The outstanding initial invitation was revoked.");
    } catch {
      setMessage("Unable to revoke the invite.");
    } finally {
      setIsWorking(false);
    }
  }

  return (
    <section className="closer-invite-controls">
      <span className="closer-onboarding-icon closer-icon-peach"><LinkIcon aria-hidden="true" /></span>
      <h2>One link, just for them</h2>
      <p>An invite is private, single-use, and expires in seven days.</p>
      {inviteUrl ? <input aria-label="Initial invite URL" className="closer-onboarding-input" readOnly value={inviteUrl} /> : null}
      {message ? <p className="closer-invite-message">{message}</p> : null}
      <div className="closer-invite-actions">
        <button className="closer-primary-button" disabled={isWorking} onClick={() => void generateInvite()} type="button">
          {isWorking ? "Getting it ready…" : inviteUrl ? "Make a fresh link" : "Create invite link"}
        </button>
        {inviteUrl ? (
          <button className="closer-secondary-button" disabled={isWorking} onClick={() => void navigator.clipboard.writeText(inviteUrl)} type="button"><Copy aria-hidden="true" /> Copy link</button>
        ) : null}
        {inviteUrl ? <button className="closer-text-button" disabled={isWorking} onClick={() => void revokeInvite()} type="button"><RotateCcw aria-hidden="true" /> Revoke link</button> : null}
      </div>
    </section>
  );
}
