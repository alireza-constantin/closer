"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";

import { FieldGroup } from "@Closer/ui/components/field";

import { AsyncButton } from "@/components/closer/async-button";
import { DisplayNameField } from "@/components/closer/display-name-field";
import { FormServerError } from "@/components/closer/feedback";
import { OnboardingIcon, OnboardingSurface } from "@/components/closer/onboarding-surface";
import { CloserEyebrow } from "@/components/closer/typography";
import { joinPairSchema, type JoinPairValues } from "@/lib/validation";

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
  const form = useForm<JoinPairValues>({
    defaultValues: { displayName: "" },
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
    <OnboardingSurface as="form" onSubmit={form.handleSubmit(joinPair)}>
      <OnboardingIcon tone="lavender"><Sparkles aria-hidden="true" /></OnboardingIcon>
      <CloserEyebrow className="mt-4">{kind === "rejoin" ? "A way back to Closer" : "An invitation for you"}</CloserEyebrow>
      <h1 className="mt-3 max-w-[12ch] text-balance text-[clamp(2rem,8.8vw,2.55rem)] font-extrabold leading-[1.03] tracking-[-.055em]">{kind === "rejoin" ? "Reconnect with your space" : inviterDisplayName ? `${inviterDisplayName} invited you` : "You’re invited"}</h1>
      <p className="mt-3 max-w-[31ch] text-[.98rem] leading-relaxed text-closer-muted">{kind === "rejoin" ? "Choose a name to return to your place in this space. No sign-up needed." : "Add your name to join this little space for two. No sign-up needed."}</p>
      {unavailable ? <FormServerError>{unavailableMessage}</FormServerError> : null}
      <FieldGroup className="mt-6">
        <DisplayNameField error={nameError} errorId="join-display-name-error" registration={form.register("displayName")} />
      </FieldGroup>
      {form.formState.errors.root?.server?.message ? <FormServerError>{form.formState.errors.root.server.message}</FormServerError> : null}
      <AsyncButton className="mt-5 w-full" disabled={unavailable} pending={form.formState.isSubmitting} pendingText="Joining…" size="lg" type="submit">{kind === "rejoin" ? "Reconnect" : "Join"}</AsyncButton>
    </OnboardingSurface>
  );
}
