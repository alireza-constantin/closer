"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";

import { Button } from "@Closer/ui/components/button";
import { Textarea } from "@Closer/ui/components/textarea";
import { AsyncButton } from "@/components/closer/async-button";

type Revision = {
  revisionId: string;
  revisionNumber: number;
  text: string;
  createdAt: string;
  withdrawnAt: string | null;
  isCurrent: boolean;
};

function mutationError(status: number) {
  if (status === 409)
    return "This question changed while you were viewing it. Review the latest revision before trying again.";
  return "We couldn’t complete that change. Refresh the page and try again.";
}

export function QuestionActivityControl({
  questionId,
  isActive,
  blocked,
  reactivation,
}: {
  questionId: string;
  isActive: boolean;
  blocked: boolean;
  reactivation: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const action = isActive ? "deactivate" : reactivation ? "reactivate" : "activate";
  const label = isActive ? "Deactivate" : reactivation ? "Reactivate" : "Activate";

  async function changeActivity() {
    setError(null);
    setPending(true);
    try {
      const response = await fetch(`/api/admin/questions/${questionId}/lifecycle/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!response.ok) {
        setError(mutationError(response.status));
        return;
      }
      router.refresh();
    } catch {
      setError("We couldn’t reach the catalog. Try again when the connection is available.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <AsyncButton
        disabled={pending || blocked}
        onClick={changeActivity}
        pending={pending}
        pendingText="Saving…"
        type="button"
        variant={isActive ? "outline" : "default"}
      >
        {label}
      </AsyncButton>
      {error ? (
        <p className="text-closer-error mt-2 max-w-xs text-xs" role="alert">
          {error}
        </p>
      ) : null}
      {blocked ? (
        <p className="text-closer-error mt-2 max-w-xs text-xs">
          Add a safe current revision before activation.
        </p>
      ) : null}
    </div>
  );
}

export function RevisionActions({
  questionId,
  currentRevisionId,
  revision,
}: {
  questionId: string;
  currentRevisionId: string;
  revision: Revision;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const router = useRouter();

  async function restore() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/admin/questions/${questionId}/revisions/${revision.revisionId}/restore`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ expectedCurrentRevisionId: currentRevisionId }),
        },
      );
      if (!response.ok) {
        setError(mutationError(response.status));
        return;
      }
      router.refresh();
    } catch {
      setError("We couldn’t reach the catalog. Try again when the connection is available.");
    } finally {
      setPending(false);
    }
  }

  async function withdraw(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedReason = reason.trim();
    if (!trimmedReason) {
      setError("Enter a reason before withdrawing this revision.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/admin/questions/${questionId}/revisions/${revision.revisionId}/withdraw`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ reason: trimmedReason }),
        },
      );
      if (!response.ok) {
        setError(mutationError(response.status));
        return;
      }
      setOpen(false);
      setReason("");
      router.refresh();
    } catch {
      setError("We couldn’t reach the catalog. Try again when the connection is available.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex min-w-44 flex-col items-start gap-2">
      {!revision.isCurrent ? (
        <AsyncButton
          disabled={pending}
          onClick={restore}
          pending={pending}
          pendingText="Saving…"
          size="sm"
          type="button"
          variant="outline"
        >
          Restore as new revision
        </AsyncButton>
      ) : null}
      {!revision.withdrawnAt ? (
        <Button
          disabled={pending}
          onClick={() => {
            setError(null);
            setOpen((value) => !value);
          }}
          size="sm"
          type="button"
          variant="outline"
        >
          {open ? "Cancel withdrawal" : "Withdraw revision"}
        </Button>
      ) : null}
      {open ? (
        <form
          className="border-closer-coral/30 bg-closer-coral-soft/40 w-64 rounded-xl border p-3"
          onSubmit={withdraw}
        >
          <p className="text-sm font-extrabold">Withdraw v{revision.revisionNumber}</p>
          <p className="text-closer-muted mt-1 text-xs leading-relaxed">
            This cannot be undone. Unresolved Private candidates using it will be invalidated.
          </p>
          <label
            className="mt-3 flex flex-col gap-1 text-xs font-bold"
            htmlFor={`withdraw-reason-${revision.revisionId}`}
          >
            Reason{" "}
            <Textarea
              aria-required="true"
              className="min-h-20 rounded-lg bg-white text-sm"
              id={`withdraw-reason-${revision.revisionId}`}
              maxLength={1000}
              onChange={(event) => setReason(event.target.value)}
              required
              value={reason}
            />
          </label>
          {error ? (
            <p className="text-closer-error mt-2 text-xs" role="alert">
              {error}
            </p>
          ) : null}
          <AsyncButton
            className="mt-3"
            disabled={pending || !reason.trim()}
            size="sm"
            pending={pending}
            pendingText="Withdrawing…"
            type="submit"
            variant="destructive"
          >
            Confirm withdrawal
          </AsyncButton>
        </form>
      ) : null}
      {error && !open ? (
        <p className="text-closer-error max-w-64 text-xs" role="alert">
          {error}
        </p>
      ) : null}
      {error?.startsWith("This question changed") ? (
        <Link
          className="text-closer-navy text-xs font-bold underline"
          href={`/admin/questions/${questionId}?view=history` as Route}
        >
          Review latest revision
        </Link>
      ) : null}
    </div>
  );
}
