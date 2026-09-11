"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@Closer/ui/components/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@Closer/ui/components/field";
import { Input } from "@Closer/ui/components/input";

import { AsyncButton } from "@/components/closer/async-button";
import { FormServerError } from "@/components/closer/feedback";
import { CloserEyebrow } from "@/components/closer/typography";
import Loader from "@/components/loader";
import { authClient } from "@/lib/auth-client";
import { signUpSchema, type SignUpValues } from "@/lib/validation";

export default function SignUpForm({ onSwitchToSignIn }: { onSwitchToSignIn: () => void }) {
  const router = useRouter();
  const { isPending } = authClient.useSession();
  const form = useForm<SignUpValues>({ defaultValues: { email: "", password: "", name: "" }, mode: "onChange", resolver: zodResolver(signUpSchema) });

  async function onSubmit(values: SignUpValues) {
    form.clearErrors("root.server");
    try {
      await authClient.signUp.email(values, {
        onSuccess: () => {
          router.push("/dashboard");
          toast.success("Sign up successful");
        },
        onError: (error) => {
          form.setError("root.server", { message: error.error.message || error.error.statusText });
        },
      });
    } catch {
      form.setError("root.server", { message: "We couldn’t create your account. Please try again." });
    }
  }

  if (isPending) return <Loader />;
  const nameError = form.formState.errors.name;
  const emailError = form.formState.errors.email;
  const passwordError = form.formState.errors.password;
  return (
    <main className="flex min-h-svh items-center justify-center bg-closer-cream px-6 py-8 text-closer-navy">
      <section className="w-full max-w-md rounded-closer-panel bg-white/70 p-6 shadow-closer-soft">
        <CloserEyebrow className="text-center">Keep your Closer space close</CloserEyebrow>
        <h1 className="mt-3 text-center text-3xl font-extrabold tracking-[-.05em]">Create an account</h1>
        <form className="mt-6" onSubmit={form.handleSubmit(onSubmit)}>
          <FieldGroup>
            <Field data-invalid={!!nameError}>
              <FieldLabel htmlFor="name">Name</FieldLabel>
              <Input {...form.register("name")} aria-describedby={nameError ? "sign-up-name-error" : undefined} aria-invalid={!!nameError} autoComplete="name" id="name" />
              <FieldError errors={nameError ? [nameError] : undefined} id="sign-up-name-error" />
            </Field>
            <Field data-invalid={!!emailError}>
              <FieldLabel htmlFor="email">Email</FieldLabel>
              <Input {...form.register("email")} aria-describedby={emailError ? "sign-up-email-error" : undefined} aria-invalid={!!emailError} autoComplete="email" id="email" type="email" />
              <FieldError errors={emailError ? [emailError] : undefined} id="sign-up-email-error" />
            </Field>
            <Field data-invalid={!!passwordError}>
              <FieldLabel htmlFor="password">Password</FieldLabel>
              <Input {...form.register("password")} aria-describedby={passwordError ? "sign-up-password-error" : undefined} aria-invalid={!!passwordError} autoComplete="new-password" id="password" type="password" />
              <FieldError errors={passwordError ? [passwordError] : undefined} id="sign-up-password-error" />
            </Field>
          </FieldGroup>
          {form.formState.errors.root?.server?.message ? <FormServerError>{form.formState.errors.root.server.message}</FormServerError> : null}
          <AsyncButton className="mt-5 w-full" disabled={!form.formState.isValid} pending={form.formState.isSubmitting} pendingText="Creating account…" size="lg" type="submit">Sign up</AsyncButton>
        </form>
        <Button className="mx-auto mt-4 block" onClick={onSwitchToSignIn} size="sm" type="button" variant="link">Already have an account? Sign in</Button>
      </section>
    </main>
  );
}
