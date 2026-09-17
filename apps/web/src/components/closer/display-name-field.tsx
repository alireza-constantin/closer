import type { FieldError } from "react-hook-form";
import type { UseFormRegisterReturn } from "react-hook-form";

import { Field, FieldError as FieldErrorMessage, FieldLabel } from "@Closer/ui/components/field";
import { Input } from "@Closer/ui/components/input";

export function DisplayNameField({
  error,
  errorId,
  readOnly = false,
  registration,
}: {
  error?: FieldError;
  errorId: string;
  readOnly?: boolean;
  registration: UseFormRegisterReturn;
}) {
  return (
    <Field data-invalid={!!error}>
      <FieldLabel htmlFor="display-name">Your name</FieldLabel>
      <Input
        {...registration}
        aria-describedby={error ? errorId : undefined}
        aria-invalid={!!error}
        autoComplete="name"
        id="display-name"
        maxLength={40}
        placeholder="What should they call you?"
        readOnly={readOnly}
      />
      <FieldErrorMessage errors={error ? [error] : undefined} id={errorId} />
    </Field>
  );
}
