"use client";

import { Check, Copy, Link as LinkIcon, RotateCcw, Share2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@Closer/ui/components/button";
import { Field, FieldLabel } from "@Closer/ui/components/field";
import { Input } from "@Closer/ui/components/input";

import InviteQrCode from "@/components/invite-qr-code";
import { AsyncButton } from "@/components/closer/async-button";

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
  const reuseRequestRef = useRef<Promise<void> | null>(null);
  const endpoint = `/api/pairs/${encodeURIComponent(pairId)}/${kind === "initial" ? "invite" : "rejoin"}`;
  const isRejoin = kind === "rejoin";

  useEffect(() => {
    setCanShare(
      typeof navigator !== "undefined" && typeof navigator.share === "function",
    );
  }, []);

  async function generateInvite() {
    setIsWorking(true);
    setMessage(null);
    setDidCopy(false);
    try {
      const response = await fetch(endpoint, { method: "POST" });
      const body: unknown = await response.json();
      if (
        !response.ok ||
        !body ||
        typeof body !== "object" ||
        !("token" in body) ||
        typeof body.token !== "string"
      ) {
        if (isRejoin && response.status === 409) {
          setMessage(
            "They still have an active guest session. A fresh rejoin link is only needed after that session is lost.",
          );
        } else {
          setMessage(
            isRejoin
              ? "A fresh rejoin link is not available yet."
              : "Unable to create an invite.",
          );
        }
        return;
      }
      setInviteUrl(
        `${window.location.origin}/${isRejoin ? "rejoin" : "join"}/${body.token}`,
      );
    } catch {
      setMessage(
        isRejoin
          ? "Unable to create a rejoin link."
          : "Unable to create an invite.",
      );
    } finally {
      setIsWorking(false);
    }
  }

  async function reuseOrGenerateInvite() {
    if (reuseRequestRef.current) return reuseRequestRef.current;

    const request = (async () => {
      setIsWorking(true);
      setMessage(null);
      try {
        const response = await fetch(endpoint, { cache: "no-store" });
        const body: unknown = await response.json();
        if (response.ok && body && typeof body === "object" && "token" in body && typeof body.token === "string") {
          setInviteUrl(`${window.location.origin}/${isRejoin ? "rejoin" : "join"}/${body.token}`);
          return;
        }
      } catch {
        // A failed lookup falls through to the normal invite-generation path.
      } finally {
        setIsWorking(false);
      }
      await generateInvite();
    })();
    reuseRequestRef.current = request;
    try {
      await request;
    } finally {
      if (reuseRequestRef.current === request) reuseRequestRef.current = null;
    }
  }

  useEffect(() => {
    if (autoGenerate) void reuseOrGenerateInvite();
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
        text: isRejoin
          ? "Use this link to reconnect with our Closer space."
          : "Join our Closer space.",
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
        setMessage(
          isRejoin
            ? "Unable to revoke the rejoin link."
            : "Unable to revoke the invite.",
        );
        return;
      }
      setInviteUrl(null);
      setDidCopy(false);
      setMessage(
        isRejoin
          ? "The outstanding rejoin link was revoked."
          : "The outstanding invitation was revoked.",
      );
    } catch {
      setMessage(
        isRejoin
          ? "Unable to revoke the rejoin link."
          : "Unable to revoke the invite.",
      );
    } finally {
      setIsWorking(false);
    }
  }

  return (
    <section className="relative mx-auto mt-5 w-full max-w-136 overflow-hidden rounded-[1.625rem] border border-closer-navy/10 bg-white/70 px-5 pb-5 pt-6 text-center shadow-closer-soft">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -right-6 -top-6 size-24 rounded-full bg-closer-peach/65"
      />
      <div className="relative z-10">
        <span className="mx-auto grid size-13.5 place-items-center rounded-4xl bg-closer-peach text-closer-navy [&_svg]:size-[26px]">
          <LinkIcon aria-hidden="true" />
        </span>
        <h2 className="mt-4 text-[1.35rem] font-extrabold tracking-[-.035em]">
          {isRejoin ? "Reconnect your person" : "Bring them into your space"}
        </h2>
        <p className="mx-auto mt-2 max-w-[34ch] leading-relaxed text-closer-muted">
          {isRejoin
            ? "If they’ve lost their guest session, create a fresh link for their place in your space."
            : "Share a private link, or let them scan the code from their phone."}
        </p>
        {inviteUrl ? (
          <>
            <div className="mx-auto my-5 grid justify-items-center gap-2.5 rounded-4xl bg-white px-3 py-4">
              <InviteQrCode value={inviteUrl} />
            </div>
            <Field className="text-left">
              <FieldLabel htmlFor={`${kind}-invite-url`}>
                Your {isRejoin ? "rejoin" : "invite"} link
              </FieldLabel>
              <Input
                aria-label={`${isRejoin ? "Rejoin" : "Initial invite"} URL`}
                className="break-all text-xs"
                id={`${kind}-invite-url`}
                readOnly
                value={inviteUrl}
              />
            </Field>
          </>
        ) : null}
        {message ? (
          <p
            className="mt-3 text-[.88rem] leading-relaxed text-closer-navy"
            role="status"
          >
            {message}
          </p>
        ) : null}
        <div className="mt-4 grid gap-2.5">
          <AsyncButton
            onClick={() => void generateInvite()}
            pending={isWorking}
            pendingText="Getting it ready…"
            size="lg"
            type="button"
          >
            {inviteUrl ? "Make a fresh link" : isRejoin ? "Create rejoin link" : "Create invite link"}
          </AsyncButton>
          {inviteUrl ? (
            <div className="grid grid-cols-2 gap-2">
              <Button
                disabled={isWorking}
                onClick={() => void copyInvite()}
                size="sm"
                type="button"
                variant="secondary"
              >
                <Copy aria-hidden="true" data-icon="inline-start" />
                {didCopy ? (
                  <>
                    <Check aria-hidden="true" data-icon="inline-start" />
                    Copied
                  </>
                ) : (
                  "Copy link"
                )}
              </Button>
              {canShare ? (
                <Button
                  disabled={isWorking}
                  onClick={() => void shareInvite()}
                  size="sm"
                  type="button"
                  variant="secondary"
                >
                  <Share2 aria-hidden="true" data-icon="inline-start" />
                  Share
                </Button>
              ) : null}
            </div>
          ) : null}
          {inviteUrl ? (
            <Button
              className="mx-auto w-fit px-2 text-closer-muted"
              disabled={isWorking}
              onClick={() => void revokeInvite()}
              size="sm"
              type="button"
              variant="ghost"
            >
              <RotateCcw aria-hidden="true" data-icon="inline-start" />
              Revoke link
            </Button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
