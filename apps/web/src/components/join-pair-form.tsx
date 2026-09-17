"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";

import { FieldGroup } from "@Closer/ui/components/field";

import { AsyncButton } from "@/components/closer/async-button";
import { DisplayNameField } from "@/components/closer/display-name-field";
import { FormServerError } from "@/components/closer/feedback";
import { joinPairSchema, type JoinPairValues } from "@/lib/validation";

export default function JoinPairForm({
  token,
  claimantDisplayName = null,
  initialInvite = null,
  kind = "initial",
  unavailable = false,
}: {
  token: string;
  claimantDisplayName?: string | null;
  initialInvite?: { inviterDisplayName: string; relationshipType: "partner" | "friend"; intendedPersonName: string | null } | null;
  kind?: "initial" | "rejoin";
  unavailable?: boolean;
}) {
  const router = useRouter();
  const isExistingParticipant = claimantDisplayName !== null;
  const form = useForm<JoinPairValues>({
    defaultValues: {
      displayName: claimantDisplayName ?? (kind === "initial" ? initialInvite?.intendedPersonName ?? "" : ""),
    },
    mode: "onChange",
    resolver: zodResolver(joinPairSchema),
  });
  const nameError = form.formState.errors.displayName;
  const unavailableMessage = kind === "rejoin"
    ? "This rejoin link is unavailable. It may have expired, been revoked, or already been used."
    : "This invitation is unavailable. It may have expired, been revoked, or already been used.";

  async function joinPair(values: JoinPairValues) {
    form.clearErrors("root.server");
    try {
      const response = await fetch(`/api/${kind === "rejoin" ? "rejoin" : "invites"}/${encodeURIComponent(token)}/redeem`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(values),
      });
      const body: unknown = await response.json();
      if (!response.ok || !body || typeof body !== "object" || !("pairId" in body)) {
        if (response.status === 400 && body && typeof body === "object" && "error" in body && (body as { error?: unknown }).error === "DISPLAY_NAME_INVALID") {
          form.setError("displayName", { message: "Enter a valid name before joining." });
          return;
        }
        form.setError("root.server", { message: unavailableMessage });
        return;
      }
      // The invite is consumed; keep the joined pair as the canonical back
      // destination instead of allowing Back to return to onboarding.
      router.replace(`/pair/${String(body.pairId)}` as never);
    } catch {
      form.setError("root.server", { message: kind === "rejoin" ? "This rejoin link is unavailable. Please try again." : "This invitation is unavailable. Please try again." });
    }
  }

  return (
    <form className="mt-6" onSubmit={form.handleSubmit(joinPair)}>
      {kind === "initial" && initialInvite ? <div className="rounded-[1.35rem] bg-white/65 p-4 text-sm text-closer-navy shadow-[0_8px_24px_rgba(27,33,78,0.08)]"><p><strong>Invited by:</strong> {initialInvite.inviterDisplayName}</p><p className="mt-2"><strong>Space type:</strong> {initialInvite.relationshipType === "partner" ? "Partner" : "Friend"}</p></div> : null}
      {unavailable ? <FormServerError>{unavailableMessage}</FormServerError> : null}
      <FieldGroup className={kind === "initial" && initialInvite ? "mt-6" : undefined}>
        <DisplayNameField
          error={nameError}
          errorId="join-display-name-error"
          readOnly={kind === "initial" && isExistingParticipant}
          registration={form.register("displayName")}
        />
      </FieldGroup>
      {kind === "initial" && isExistingParticipant ? <p className="mt-2 text-sm leading-relaxed text-closer-muted">Your existing Closer name will be used for this space.</p> : null}
      {form.formState.errors.root?.server?.message ? <FormServerError>{form.formState.errors.root.server.message}</FormServerError> : null}
      <AsyncButton className="mt-5 w-full" disabled={unavailable} pending={form.formState.isSubmitting} pendingText="Joining…" size="lg" type="submit">{kind === "rejoin" ? "Reconnect" : "Join space"}</AsyncButton>
    </form>
  );
}
