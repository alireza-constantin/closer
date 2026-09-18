"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@Closer/ui/components/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@Closer/ui/components/field";
import { Input } from "@Closer/ui/components/input";

import { AsyncButton } from "@/components/closer/async-button";
import { FormServerError } from "@/components/closer/feedback";
import { CloserEyebrow } from "@/components/closer/typography";
import Loader from "@/components/feedback/loader";
import { authClient } from "@/lib/auth/auth-client";
import { clearCloserQueryCache } from "@/lib/query/closer-query-cache";
import { signInSchema, type SignInValues } from "@/contracts/auth/auth.schema";

export default function SignInForm({ onSwitchToSignUp }: { onSwitchToSignUp: () => void }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { isPending } = authClient.useSession();
  const form = useForm<SignInValues>({
    defaultValues: { email: "", password: "" },
    mode: "onChange",
    resolver: zodResolver(signInSchema),
  });

  async function onSubmit(values: SignInValues) {
    form.clearErrors("root.server");
    try {
      await authClient.signIn.email(values, {
        onSuccess: () => {
          clearCloserQueryCache(queryClient);
          router.push("/dashboard");
          toast.success("Sign in successful");
        },
        onError: (error) => {
          form.setError("root.server", { message: error.error.message || error.error.statusText });
        },
      });
    } catch {
      form.setError("root.server", { message: "We couldn’t sign you in. Please try again." });
    }
  }

  if (isPending) return <Loader />;
  const emailError = form.formState.errors.email;
  const passwordError = form.formState.errors.password;
  return (
    <main className="bg-closer-cream text-closer-navy flex min-h-svh items-center justify-center px-6 py-8">
      <section className="rounded-closer-panel shadow-closer-soft w-full max-w-md bg-white/70 p-6">
        <CloserEyebrow className="text-center">Welcome back to Closer</CloserEyebrow>
        <h1 className="mt-3 text-center text-3xl font-extrabold tracking-[-.05em]">Welcome back</h1>
        <form className="mt-6" onSubmit={form.handleSubmit(onSubmit)}>
          <FieldGroup>
            <Field data-invalid={!!emailError}>
              <FieldLabel htmlFor="email">Email</FieldLabel>
              <Input
                {...form.register("email")}
                aria-describedby={emailError ? "sign-in-email-error" : undefined}
                aria-invalid={!!emailError}
                autoComplete="email"
                id="email"
                type="email"
              />
              <FieldError errors={emailError ? [emailError] : undefined} id="sign-in-email-error" />
            </Field>
            <Field data-invalid={!!passwordError}>
              <FieldLabel htmlFor="password">Password</FieldLabel>
              <Input
                {...form.register("password")}
                aria-describedby={passwordError ? "sign-in-password-error" : undefined}
                aria-invalid={!!passwordError}
                autoComplete="current-password"
                id="password"
                type="password"
              />
              <FieldError
                errors={passwordError ? [passwordError] : undefined}
                id="sign-in-password-error"
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
        <Button
          className="mx-auto mt-4 block"
          onClick={onSwitchToSignUp}
          size="sm"
          type="button"
          variant="link"
        >
          Need an account? Sign up
        </Button>
      </section>
    </main>
  );
}
