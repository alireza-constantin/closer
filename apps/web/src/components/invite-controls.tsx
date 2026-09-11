"use client";

import { useState } from "react";

import { Button } from "@Closer/ui/components/button";
import { Input } from "@Closer/ui/components/input";

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
    <section className="space-y-3 rounded border p-5">
      <h2 className="font-semibold">Invite the second member</h2>
      <p className="text-sm text-muted-foreground">An invite is single-use and expires seven days after creation.</p>
      {inviteUrl ? <Input aria-label="Initial invite URL" readOnly value={inviteUrl} /> : null}
      {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button disabled={isWorking} onClick={() => void generateInvite()} type="button">
          {isWorking ? "Working…" : inviteUrl ? "Replace invite" : "Generate invite"}
        </Button>
        {inviteUrl ? (
          <Button disabled={isWorking} onClick={() => void navigator.clipboard.writeText(inviteUrl)} type="button" variant="outline">
            Copy invite link
          </Button>
        ) : null}
        <Button disabled={isWorking} onClick={() => void revokeInvite()} type="button" variant="outline">
          Revoke invite
        </Button>
      </div>
    </section>
  );
}
