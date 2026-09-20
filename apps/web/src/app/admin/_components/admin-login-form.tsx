"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";

import { Field, FieldError, FieldGroup, FieldLabel } from "@Closer/ui/components/field";
import { Input } from "@Closer/ui/components/input";

import { AsyncButton } from "@/components/closer/async-button";
import { FormServerError } from "@/components/closer/feedback";
import { CloserEyebrow } from "@/components/closer/typography";
import { signInSchema, type SignInValues } from "@/contracts/auth/auth.schema";

import { adminAuthClient } from "../_lib/admin-auth-client";

export function AdminLoginForm() {
  const router = useRouter();
  const form = useForm<SignInValues>({
    defaultValues: { email: "", password: "" },
    mode: "onChange",
    resolver: zodResolver(signInSchema),
  });

  async function onSubmit(values: SignInValues) {
    form.clearErrors("root.server");
    try {
      await adminAuthClient.signIn.email(values, {
        onSuccess: () => {
          router.replace("/admin" as Route);
          router.refresh();
        },
        onError: () => {
          form.setError("root.server", {
            message: "We couldn’t sign in with those credentials. Please try again.",
          });
        },
      });
    } catch {
      form.setError("root.server", {
        message: "We couldn’t sign in with those credentials. Please try again.",
      });
    }
  }

  const emailError = form.formState.errors.email;
  const passwordError = form.formState.errors.password;

  return (
    <main className="bg-closer-cream text-closer-navy flex min-h-svh items-center justify-center px-6 py-8">
      <section className="rounded-closer-panel shadow-closer-soft w-full max-w-md bg-white/80 p-7">
        <CloserEyebrow className="text-center">Closer editorial workspace</CloserEyebrow>
        <h1 className="mt-3 text-center text-3xl font-extrabold tracking-[-.05em]">
          Admin sign in
        </h1>
        <p className="text-closer-muted mt-2 text-center text-sm">
          Sign in with the dedicated Admin account.
        </p>
        <form className="mt-6" onSubmit={form.handleSubmit(onSubmit)}>
          <FieldGroup>
            <Field data-invalid={!!emailError}>
              <FieldLabel htmlFor="admin-email">Email</FieldLabel>
              <Input
                {...form.register("email")}
                aria-describedby={emailError ? "admin-email-error" : undefined}
                aria-invalid={!!emailError}
                autoComplete="username"
                id="admin-email"
                type="email"
              />
              <FieldError errors={emailError ? [emailError] : undefined} id="admin-email-error" />
            </Field>
            <Field data-invalid={!!passwordError}>
              <FieldLabel htmlFor="admin-password">Password</FieldLabel>
              <Input
                {...form.register("password")}
                aria-describedby={passwordError ? "admin-password-error" : undefined}
                aria-invalid={!!passwordError}
                autoComplete="current-password"
                id="admin-password"
                type="password"
              />
              <FieldError
                errors={passwordError ? [passwordError] : undefined}
                id="admin-password-error"
              />
            </Field>
          </FieldGroup>
          {form.formState.errors.root?.server?.message ? (
            <FormServerError>{form.formState.errors.root.server.message}</FormServerError>
          ) : null}
          <AsyncButton
            className="mt-5 w-full"
            disabled={!form.formState.isValid}
            pending={form.formState.isSubmitting}
            pendingText="Signing in…"
            size="lg"
            type="submit"
          >
            Sign in
          </AsyncButton>
        </form>
      </section>
    </main>
  );
}
