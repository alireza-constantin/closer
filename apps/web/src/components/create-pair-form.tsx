"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { LockKeyhole, MessageCircleMore, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { useRouter } from "next/navigation";

import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@Closer/ui/components/field";
import { RadioGroup, RadioGroupItem } from "@Closer/ui/components/radio-group";
import { cn } from "@Closer/ui/lib/utils";

import { AsyncButton } from "@/components/closer/async-button";
import { DisplayNameField } from "@/components/closer/display-name-field";
import { CloserModeCard } from "@/components/closer/navigation";
import { OnboardingIcon, OnboardingSurface } from "@/components/closer/onboarding-surface";
import { FormServerError } from "@/components/closer/feedback";
import { CloserEyebrow } from "@/components/closer/typography";
import { useVisiblePolling } from "@/hooks/use-visible-polling";
import { createPairSchema, type CreatePairValues } from "@/lib/validation";

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
  const [result, setResult] = useState<PairCreation | null>(null);
  const [joinedDisplayName, setJoinedDisplayName] = useState<string | null>(null);
  const creationRequestIdRef = useRef<string | null>(null);
  const form = useForm<CreatePairValues>({
    defaultValues: { displayName: "", relationshipType: "partner" },
    mode: "onChange",
    resolver: zodResolver(createPairSchema),
  });

  useVisiblePolling({
    enabled: result !== null && joinedDisplayName === null,
    forceOnForeground: true,
    intervalMs: PAIR_STATUS_POLL_INTERVAL_MS,
    onPoll: async (signal) => {
      if (!result) return;
      try {
        const response = await fetch(`/api/pairs/${encodeURIComponent(result.pairId)}/status`, { cache: "no-store", signal });
        if (!response.ok) return;
        const status: unknown = await response.json();
        if (!isConnectedPairStatus(status)) return;
        setJoinedDisplayName(status.otherParticipantDisplayName);
        try {
          router.replace(`/pair/${result.pairId}` as never);
        } catch {
          window.location.assign(`/pair/${result.pairId}`);
        }
      } catch {
        // Keep the invite state intact; the next foreground check can recover.
      }
    },
  });

  async function createPair(values: CreatePairValues) {
    form.clearErrors("root.server");
    const clientRequestId = creationRequestIdRef.current ?? crypto.randomUUID();
    creationRequestIdRef.current = clientRequestId;
    try {
      const response = await fetch("/api/pairs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...values, clientRequestId }),
      });
      const body: unknown = await response.json();
      if (!response.ok || !body || typeof body !== "object" || !("pairId" in body)) {
        const message = body && typeof body === "object" && "error" in body ? body.error : null;
        form.setError("root.server", { message: typeof message === "string" ? message : "We could not create your space." });
        return;
      }
      setResult(body as PairCreation);
    } catch {
      form.setError("root.server", { message: "We could not create your space." });
    }
  }

  if (result) {
    return (
      <OnboardingSurface className="items-center text-center">
        <OnboardingIcon tone="coral"><Sparkles aria-hidden="true" /></OnboardingIcon>
        <CloserEyebrow className="mt-4">Your space is ready</CloserEyebrow>
        <h1 className="mt-3 max-w-[12ch] text-balance text-[clamp(2rem,8.8vw,2.55rem)] font-extrabold leading-[1.03] tracking-[-.055em]">How do you want to connect?</h1>
        <p className="mt-3 max-w-[31ch] text-[.98rem] leading-relaxed text-closer-muted">Choose the kind of moment you want right now. You can bring your person in when you’re ready.</p>
        <div className="mt-6 flex w-full flex-col gap-3 text-left">
          <CloserModeCard href={`/pair/${result.pairId}/together`} kind="together" icon={<MessageCircleMore aria-hidden="true" />} title="Together" description="Use this phone and talk face-to-face." />
          <CloserModeCard href={`/pair/${result.pairId}/private`} kind="private" icon={<LockKeyhole aria-hidden="true" />} title="Private" description="Answer separately on your own phones." />
        </div>
        <Link className="mt-5 text-sm font-bold text-closer-muted underline-offset-4 hover:text-closer-navy hover:underline" href={`/pair/${result.pairId}` as never}>I’ll choose later</Link>
        {joinedDisplayName ? <p className="mt-4 inline-flex items-center gap-2 rounded-full bg-closer-mint px-3 py-2 text-sm text-closer-success-foreground" role="status"><strong>{joinedDisplayName}</strong> joined. Opening your shared space…</p> : null}
        {form.formState.errors.root?.server?.message ? <FormServerError>{form.formState.errors.root.server.message}</FormServerError> : null}
      </OnboardingSurface>
    );
  }

  const nameError = form.formState.errors.displayName;
  return (
    <OnboardingSurface as="form" onSubmit={form.handleSubmit(createPair)}>
      <OnboardingIcon tone="coral"><Sparkles aria-hidden="true" /></OnboardingIcon>
      <CloserEyebrow className="mt-4">A space for two</CloserEyebrow>
      <h1 className="mt-3 max-w-[12ch] text-balance text-[clamp(2rem,8.8vw,2.55rem)] font-extrabold leading-[1.03] tracking-[-.055em]">Let’s create your space</h1>
      <p className="mt-3 max-w-[31ch] text-[.98rem] leading-relaxed text-closer-muted">A gentle place for the conversations that matter.</p>
      <FieldGroup className="mt-6 gap-4">
        <DisplayNameField error={nameError} errorId="display-name-error" registration={form.register("displayName")} />
        <FieldSet data-invalid={!!form.formState.errors.relationshipType}>
          <FieldLegend variant="label">Who are you creating this with?</FieldLegend>
          <Controller
            control={form.control}
            name="relationshipType"
            render={({ field }) => (
              <RadioGroup
                aria-invalid={!!form.formState.errors.relationshipType}
                className="grid grid-cols-2 gap-2.5"
                name={field.name}
                onBlur={field.onBlur}
                onValueChange={(value) => {
                  if (value !== "partner" && value !== "friend") return;
                  creationRequestIdRef.current = null;
                  field.onChange(value);
                }}
                value={field.value}
              >
                {(["partner", "friend"] as const).map((value) => (
                  <Field key={value}>
                    <FieldLabel className={cn("min-h-[88px] w-full cursor-pointer flex-col justify-center rounded-[1.25rem] border-2 border-transparent p-4 transition-[transform,border-color] hover:-translate-y-0.5 focus-within:ring-2 focus-within:ring-closer-lavender focus-within:ring-offset-2 focus-within:ring-offset-closer-cream", value === "partner" ? "bg-closer-peach" : "bg-closer-lavender-soft", field.value === value && "border-closer-navy")}>
                      <RadioGroupItem aria-label={value === "partner" ? "Partner" : "Friend"} className="sr-only" value={value} />
                      <span className="font-extrabold">{value === "partner" ? "Partner" : "Friend"}</span>
                      <small className="text-xs text-closer-navy/70">{value === "partner" ? "For the two of you" : "For close friends"}</small>
                    </FieldLabel>
                  </Field>
                ))}
              </RadioGroup>
            )}
          />
          <FieldError errors={form.formState.errors.relationshipType ? [form.formState.errors.relationshipType] : undefined} />
        </FieldSet>
      </FieldGroup>
      {form.formState.errors.root?.server?.message ? <FormServerError>{form.formState.errors.root.server.message}</FormServerError> : null}
      <AsyncButton className="mt-5 w-full" pending={form.formState.isSubmitting} pendingText="Creating your space…" size="lg" type="submit">Create our space</AsyncButton>
    </OnboardingSurface>
  );
}
