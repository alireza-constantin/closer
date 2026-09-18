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
import { onboardingSchema, type OnboardingValues } from "@/lib/validation";

export default function ParticipantOnboardingForm({ returnTo }: { returnTo?: string }) {
  const router = useRouter();
  const form = useForm<OnboardingValues>({
    defaultValues: { displayName: "" },
    mode: "onChange",
    resolver: zodResolver(onboardingSchema),
  });

  async function completeOnboarding(values: OnboardingValues) {
    form.clearErrors("root.server");
    try {
      const response = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(values),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        const message = body && typeof body === "object" && "error" in body ? body.error : null;
        form.setError("root.server", {
          message:
            typeof message === "string" && message === "DISPLAY_NAME_INVALID"
              ? "Enter a name between 1 and 40 characters."
              : "We could not save your name.",
        });
        return;
      }
      router.replace((returnTo ?? "/") as never);
    } catch {
      form.setError("root.server", { message: "We could not save your name. Please try again." });
    }
  }

  const nameError = form.formState.errors.displayName;
  return (
    <OnboardingSurface as="form" onSubmit={form.handleSubmit(completeOnboarding)}>
      <OnboardingIcon tone="lavender">
        <Sparkles aria-hidden="true" />
      </OnboardingIcon>
      <CloserEyebrow className="mt-4">A little closer</CloserEyebrow>
      <h1 className="mt-3 max-w-[12ch] text-[clamp(2rem,8.8vw,2.55rem)] leading-[1.03] font-extrabold tracking-[-.055em] text-balance">
        What should we call you?
      </h1>
      <p className="text-closer-muted mt-3 max-w-[31ch] text-[.98rem] leading-relaxed">
        Choose the name your people will see. You can create a space whenever you’re ready.
      </p>
      <FieldGroup className="mt-6">
        <DisplayNameField
          error={nameError}
          errorId="onboarding-display-name-error"
          registration={form.register("displayName")}
        />
      </FieldGroup>
      {form.formState.errors.root?.server?.message ? (
        <FormServerError>{form.formState.errors.root.server.message}</FormServerError>
      ) : null}
      <AsyncButton
        className="mt-5 w-full"
        pending={form.formState.isSubmitting}
        pendingText="Saving your name…"
        size="lg"
        type="submit"
      >
        Continue
      </AsyncButton>
    </OnboardingSurface>
  );
}
