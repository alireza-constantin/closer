"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { LockKeyhole, MessageCircleMore, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";

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
import { CloserModeCard } from "@/components/closer/navigation";
import { OnboardingIcon, OnboardingSurface } from "@/components/closer/onboarding-surface";
import { FormServerError } from "@/components/closer/feedback";
import { CloserEyebrow } from "@/components/closer/typography";
import { togetherPickerPath, type PairRelationshipType } from "@/lib/together-picker-path";
import { createPairSchema, type CreatePairValues } from "@/lib/validation";

import { Input } from "@Closer/ui/components/input";

type PairCreation = { pairId: string; relationshipType: PairRelationshipType };

export default function CreatePairForm({ isFirstSpace = true }: { isFirstSpace?: boolean }) {
  const [result, setResult] = useState<PairCreation | null>(null);
  const creationRequestIdRef = useRef<string | null>(null);
  const form = useForm<CreatePairValues>({
    defaultValues: { intendedPersonName: "", relationshipType: "partner" },
    mode: "onChange",
    resolver: zodResolver(createPairSchema),
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
      if (
        !response.ok ||
        !body ||
        typeof body !== "object" ||
        !("pairId" in body) ||
        typeof body.pairId !== "string"
      ) {
        const message = body && typeof body === "object" && "error" in body ? body.error : null;
        form.setError("root.server", {
          message: typeof message === "string" ? message : "We could not create your space.",
        });
        return;
      }
      setResult({
        pairId: body.pairId as string,
        relationshipType: values.relationshipType,
      });
    } catch {
      form.setError("root.server", {
        message: "We could not create your space.",
      });
    }
  }

  if (result) {
    return (
      <OnboardingSurface className="items-center text-center">
        <OnboardingIcon tone="coral">
          <Sparkles aria-hidden="true" />
        </OnboardingIcon>
        <CloserEyebrow className="mt-4">Your space is ready</CloserEyebrow>
        <h1 className="mt-3 max-w-[12ch] text-[clamp(2rem,8.8vw,2.55rem)] leading-[1.03] font-extrabold tracking-[-.055em] text-balance">
          How do you want to connect?
        </h1>
        <p className="text-closer-muted mt-3 max-w-[31ch] text-[.98rem] leading-relaxed">
          Choose the kind of moment you want right now. You can bring your person in when you’re
          ready.
        </p>
        <div className="mt-6 flex w-full flex-col gap-3 text-left">
          <CloserModeCard
            href={togetherPickerPath(result.pairId, result.relationshipType)}
            kind="together"
            icon={<MessageCircleMore aria-hidden="true" />}
            prefetch
            title="Together"
            description="Use this phone and talk face-to-face."
          />
          <CloserModeCard
            href={`/pair/${result.pairId}/private`}
            kind="private"
            icon={<LockKeyhole aria-hidden="true" />}
            prefetch
            title="Private"
            description="Answer separately on your own phones."
          />
        </div>
        <Link
          className="text-closer-muted hover:text-closer-navy mt-5 text-sm font-bold underline-offset-4 hover:underline"
          href={`/pair/${result.pairId}` as never}
          prefetch
        >
          I’ll choose later
        </Link>
        {form.formState.errors.root?.server?.message ? (
          <FormServerError>{form.formState.errors.root.server.message}</FormServerError>
        ) : null}
      </OnboardingSurface>
    );
  }

  return (
    <OnboardingSurface as="form" onSubmit={form.handleSubmit(createPair)}>
      <OnboardingIcon tone="coral">
        <Sparkles aria-hidden="true" />
      </OnboardingIcon>
      <CloserEyebrow className="mt-4">
        {isFirstSpace ? "A space for two" : "Make room for another connection"}
      </CloserEyebrow>
      <h1 className="mt-3 max-w-[12ch] text-4xl leading-[1.03] font-extrabold tracking-[-.055em] text-balance">
        {isFirstSpace ? "Let’s create your space" : "Create another space"}
      </h1>
      <p className="text-closer-muted mt-3 max-w-[31ch] text-[.98rem] leading-relaxed">
        {isFirstSpace
          ? "A gentle place for the conversations that matter."
          : "A separate little place for another person who matters."}
      </p>
      <FieldGroup className="mt-6 gap-4">
        <Field data-invalid={!!form.formState.errors.intendedPersonName}>
          <FieldLabel htmlFor="intended-person-name">Who is this space for?</FieldLabel>
          <Input
            {...form.register("intendedPersonName")}
            aria-describedby={
              form.formState.errors.intendedPersonName ? "intended-person-name-error" : undefined
            }
            aria-invalid={!!form.formState.errors.intendedPersonName}
            autoComplete="off"
            id="intended-person-name"
            maxLength={40}
            placeholder="Their name"
          />
          <FieldError
            errors={
              form.formState.errors.intendedPersonName
                ? [form.formState.errors.intendedPersonName]
                : undefined
            }
            id="intended-person-name-error"
          />
        </Field>
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
                    <FieldLabel
                      className={cn(
                        "focus-within:ring-closer-lavender focus-within:ring-offset-closer-cream min-h-22 w-full cursor-pointer flex-col justify-center rounded-4xl border-2 border-transparent p-3 px-1 transition-[transform,border-color] focus-within:ring-2 focus-within:ring-offset-2 hover:-translate-y-0.5",
                        value === "partner" ? "bg-closer-peach" : "bg-closer-lavender-soft",
                        field.value === value && "border-closer-navy",
                      )}
                    >
                      <RadioGroupItem
                        aria-label={value === "partner" ? "Partner" : "Friend"}
                        className="sr-only"
                        value={value}
                      />
                      <span className="font-extrabold">
                        {value === "partner" ? "Partner" : "Friend"}
                      </span>
                      <small className="text-closer-navy/70 text-center text-xs">
                        {value === "partner" ? "For the two of you" : "For close friends"}
                      </small>
                    </FieldLabel>
                  </Field>
                ))}
              </RadioGroup>
            )}
          />
          <FieldError
            errors={
              form.formState.errors.relationshipType
                ? [form.formState.errors.relationshipType]
                : undefined
            }
          />
        </FieldSet>
      </FieldGroup>
      {form.formState.errors.root?.server?.message ? (
        <FormServerError>{form.formState.errors.root.server.message}</FormServerError>
      ) : null}
      <AsyncButton
        className="mt-5 w-full"
        pending={form.formState.isSubmitting}
        pendingText={isFirstSpace ? "Creating your space…" : "Creating another space…"}
        size="lg"
        type="submit"
      >
        {isFirstSpace ? "Create our space" : "Create space"}
      </AsyncButton>
    </OnboardingSurface>
  );
}
