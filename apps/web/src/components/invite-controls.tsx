"use client";

import { Check, Copy, Link as LinkIcon, RotateCcw, Share2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@Closer/ui/components/button";
import { Field, FieldLabel } from "@Closer/ui/components/field";
import { Input } from "@Closer/ui/components/input";
import { Skeleton } from "@Closer/ui/components/skeleton";

import InviteQrCode from "@/components/invite-qr-code";
import { AsyncButton } from "@/components/closer/async-button";

type InviteKind = "initial" | "rejoin";

/**
 * This is intentionally the same QR/link/action footprint as a local invite.
 * It is used both by the server Suspense boundary and the auto-issue client
 * state, so a Private → Connect transition does not collapse into a generic
 * card before the raw credential resolves.
 */
export function InviteControlsSkeleton() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Preparing the invitation…</span>
      <div
        aria-hidden="true"
        className="mx-auto grid justify-items-center gap-2.5 rounded-4xl bg-white px-3 py-4"
      >
        <Skeleton className="size-[min(224px,62vw)] rounded-lg bg-[repeating-linear-gradient(45deg,#f2f0f5_0_8px,#e9e6ed_8px_16px)]" />
      </div>
      <div aria-hidden="true" className="mt-5 text-left">
        <Skeleton className="bg-closer-navy/10 h-4 w-24 rounded-full" />
        <Skeleton className="mt-2 h-10 w-full rounded-[1.05rem] bg-white/90" />
      </div>
      <div aria-hidden="true" className="mt-4 grid grid-cols-2 gap-2">
        <Skeleton className="h-10 rounded-[.9rem] bg-white/90" />
        <Skeleton className="h-10 rounded-[.9rem] bg-white/90" />
      </div>
      <Skeleton
        aria-hidden="true"
        className="bg-closer-navy/10 mx-auto mt-4 h-3 w-44 rounded-full"
      />
    </div>
  );
}

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
  const [activeExpiresAt, setActiveExpiresAt] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isWorking, setIsWorking] = useState(false);
  const [isPreparingAutoInvite, setIsPreparingAutoInvite] = useState(autoGenerate);
  const [didCopy, setDidCopy] = useState(false);
  const [canShare, setCanShare] = useState(false);
  const reuseRequestRef = useRef<Promise<void> | null>(null);
  const endpoint = `/api/pairs/${encodeURIComponent(pairId)}/${kind === "initial" ? "invite" : "rejoin"}`;
  const isRejoin = kind === "rejoin";

  function setInitialInvite(body: Record<string, unknown>) {
    const expiresAt = typeof body.expiresAt === "string" ? body.expiresAt : null;
    if (body.state === "local" && typeof body.token === "string" && expiresAt) {
      setInviteUrl(`${window.location.origin}/join/${body.token}`);
      setActiveExpiresAt(expiresAt);
      return true;
    }
    if (body.state === "active" && expiresAt) {
      setInviteUrl(null);
      setActiveExpiresAt(expiresAt);
      return true;
    }
    if (body.state === "none") {
      setInviteUrl(null);
      setActiveExpiresAt(null);
      return true;
    }
    return false;
  }

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
      if (
        !isRejoin &&
        body &&
        typeof body === "object" &&
        setInitialInvite(body as Record<string, unknown>)
      ) {
        if ((body as { state?: unknown }).state === "active") {
          setMessage("An active invitation already exists. This browser does not have its link.");
        }
        return;
      }
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
            isRejoin ? "A fresh rejoin link is not available yet." : "Unable to create an invite.",
          );
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

  async function reuseOrGenerateInvite() {
    if (reuseRequestRef.current) return reuseRequestRef.current;

    const request = (async () => {
      setIsWorking(true);
      setMessage(null);
      try {
        const response = await fetch(endpoint, { cache: "no-store" });
        const body: unknown = await response.json();
        if (!isRejoin && response.ok && body && typeof body === "object") {
          const parsed = body as Record<string, unknown>;
          if (setInitialInvite(parsed)) {
            if (parsed.state === "none") await generateInvite();
            else if (parsed.state === "active")
              setMessage(
                "An active invitation already exists. This browser does not have its link.",
              );
            return;
          }
        }
        if (
          response.ok &&
          body &&
          typeof body === "object" &&
          "token" in body &&
          typeof body.token === "string"
        ) {
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
      setIsPreparingAutoInvite(false);
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
    if (!isRejoin) {
      const confirmed = window.confirm(
        "Replace this invitation? The previous link will stop working.",
      );
      if (!confirmed) return;
      setIsWorking(true);
      setMessage(null);
      try {
        const response = await fetch(endpoint, { method: "PUT" });
        const body: unknown = await response.json();
        if (
          !response.ok ||
          !body ||
          typeof body !== "object" ||
          !setInitialInvite(body as Record<string, unknown>)
        ) {
          setMessage("Unable to replace the invitation.");
          return;
        }
        setDidCopy(false);
        setMessage("The previous invitation no longer works. Share the new link instead.");
      } catch {
        setMessage("Unable to replace the invitation.");
      } finally {
        setIsWorking(false);
      }
      return;
    }
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
      setMessage(
        isRejoin
          ? "The outstanding rejoin link was revoked."
          : "The outstanding invitation was revoked.",
      );
    } catch {
      setMessage(isRejoin ? "Unable to revoke the rejoin link." : "Unable to revoke the invite.");
    } finally {
      setIsWorking(false);
    }
  }

  const expirationCopy = activeExpiresAt
    ? `Expires ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(activeExpiresAt))}.`
    : null;

  if (isPreparingAutoInvite) return <InviteControlsSkeleton />;

  const controls = (
    <div>
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
              className="text-xs break-all"
              id={`${kind}-invite-url`}
              readOnly
              value={inviteUrl}
            />
          </Field>
        </>
      ) : null}
      {isRejoin || !activeExpiresAt ? null : (
        <p className="text-closer-muted mt-3 text-[.88rem] leading-relaxed" role="status">
          {inviteUrl
            ? `This invitation is active. ${expirationCopy}`
            : `An invitation is already active. ${expirationCopy} Its link is only available in the browser that created it.`}
        </p>
      )}
      {message ? (
        <p className="text-closer-navy mt-3 text-[.88rem] leading-relaxed" role="status">
          {message}
        </p>
      ) : null}
      <div className="mt-4 grid gap-2.5">
        <AsyncButton
          onClick={() => void (isRejoin ? generateInvite() : reuseOrGenerateInvite())}
          pending={isWorking}
          pendingText="Getting it ready…"
          size="lg"
          type="button"
        >
          {isRejoin
            ? "Create rejoin link"
            : inviteUrl
              ? "Reuse invitation"
              : activeExpiresAt
                ? "Check invitation"
                : "Create invite link"}
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
            className="text-closer-muted mx-auto w-fit px-2"
            disabled={isWorking}
            onClick={() => void revokeInvite()}
            size="sm"
            type="button"
            variant="ghost"
          >
            <RotateCcw aria-hidden="true" data-icon="inline-start" />
            {isRejoin ? "Revoke link" : "Replace invitation"}
          </Button>
        ) : !isRejoin && activeExpiresAt ? (
          <Button
            className="text-closer-muted mx-auto w-fit px-2"
            disabled={isWorking}
            onClick={() => void revokeInvite()}
            size="sm"
            type="button"
            variant="ghost"
          >
            <RotateCcw aria-hidden="true" data-icon="inline-start" />
            Replace invitation
          </Button>
        ) : null}
      </div>
    </div>
  );

  if (!isRejoin) return controls;

  return (
    <section className="border-closer-navy/10 shadow-closer-soft relative mx-auto mt-5 w-full max-w-136 overflow-hidden rounded-[1.625rem] border bg-white/70 px-5 pt-6 pb-5 text-center">
      <span
        aria-hidden="true"
        className="bg-closer-peach/65 pointer-events-none absolute -top-6 -right-6 size-24 rounded-full"
      />
      <div className="relative z-10">
        <span className="bg-closer-peach text-closer-navy mx-auto grid size-13.5 place-items-center rounded-4xl [&_svg]:size-[26px]">
          <LinkIcon aria-hidden="true" />
        </span>
        <h2 className="mt-4 text-[1.35rem] font-extrabold tracking-[-.035em]">
          Reconnect your person
        </h2>
        <p className="text-closer-muted mx-auto mt-2 max-w-[34ch] leading-relaxed">
          If they’ve lost their guest session, create a fresh link for their place in your space.
        </p>
        {controls}
      </div>
    </section>
  );
}
