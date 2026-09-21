"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  useForm,
  type FieldError as FormFieldError,
  type UseFormRegisterReturn,
} from "react-hook-form";
import { z } from "zod";

import { Field, FieldError, FieldGroup, FieldLabel } from "@Closer/ui/components/field";
import { Input } from "@Closer/ui/components/input";
import { Textarea } from "@Closer/ui/components/textarea";
import { AsyncButton } from "@/components/closer/async-button";

import { FormServerError } from "@/components/closer/feedback";
import { categoryLabel, type CloserCategory } from "@/components/closer/category";
import { questionRevisionFieldsSchema } from "@/contracts/admin/question.schema";

type EditorValues = z.infer<typeof questionRevisionFieldsSchema>;
type DuplicateMatch = {
  questionId: string;
  text: string;
  revisionNumber: number;
  isActive: boolean;
};

const selectClassName =
  "border-closer-navy/15 bg-closer-cream text-closer-navy focus-visible:ring-closer-navy min-h-11 w-full rounded-xl border px-3 text-sm font-medium outline-none focus-visible:ring-2";

export function AdminQuestionEditor({
  questionId,
  currentRevisionId,
  initialValues,
  currentActivity,
}: {
  questionId?: string;
  currentRevisionId?: string;
  initialValues?: EditorValues;
  currentActivity?: "active" | "inactive";
}) {
  const router = useRouter();
  const [duplicates, setDuplicates] = useState<DuplicateMatch[]>([]);
  const [duplicateError, setDuplicateError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const form = useForm<EditorValues>({
    defaultValues: initialValues ?? {
      text: "",
      category: "fun",
      intensity: "light",
      relationshipFit: "both",
      modeFit: "both",
    },
    mode: "onChange",
    resolver: zodResolver(questionRevisionFieldsSchema),
  });
  const text = form.watch("text");
  const revisionUrl = questionId ? `/admin/questions/${questionId}` : null;
  const categoryOptions = ["fun", "deep", "memories", "relationship", "friendship"] as const;

  useEffect(() => {
    const normalized = text?.trim();
    if (!normalized) {
      setDuplicates([]);
      setDuplicateError(null);
      return;
    }
    const controller = new AbortController();
    const timeout = setTimeout(async () => {
      try {
        const query = new URLSearchParams({ text: normalized });
        if (questionId) query.set("excludeQuestionId", questionId);
        const response = await fetch(`/api/admin/questions/duplicates?${query.toString()}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Duplicate check unavailable.");
        const result = (await response.json()) as { matches: DuplicateMatch[] };
        setDuplicates(result.matches);
        setDuplicateError(null);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setDuplicateError("We couldn’t check for matching wording. You can still continue.");
      }
    }, 350);

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [questionId, text]);

  async function onSubmit(values: EditorValues) {
    setServerError(null);
    setPending(true);
    try {
      const endpoint = questionId
        ? `/api/admin/questions/${questionId}/revisions`
        : "/api/admin/questions";
      const body = questionId
        ? { ...values, expectedCurrentRevisionId: currentRevisionId }
        : values;
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (response.status === 409) {
        setServerError(
          "This question changed after you opened this form. Review the latest revision before saving again.",
        );
        return;
      }
      if (!response.ok) {
        setServerError("We couldn’t save this question. Review the fields and try again.");
        return;
      }
      const saved = (await response.json()) as { questionId: string };
      router.push(
        (questionId
          ? `/admin/questions/${saved.questionId}?view=history`
          : `/admin/questions/${saved.questionId}`) as Route,
      );
      router.refresh();
    } catch {
      setServerError("We couldn’t reach the catalog. Try again when the connection is available.");
    } finally {
      setPending(false);
    }
  }

  const textError = form.formState.errors.text;
  const incompatibleRelationship =
    (form.watch("category") === "relationship" && form.watch("relationshipFit") !== "partner") ||
    (form.watch("category") === "friendship" && form.watch("relationshipFit") !== "friend");

  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(300px,.75fr)]">
      <form
        className="rounded-closer-panel shadow-closer-soft bg-white/90 p-5 md:p-6"
        onSubmit={form.handleSubmit(onSubmit)}
      >
        {questionId ? (
          <div className="bg-closer-blue mb-5 rounded-xl p-3.5 text-sm leading-relaxed">
            <strong>New revision.</strong> This revision keeps the question’s current{" "}
            {currentActivity} activity.
          </div>
        ) : (
          <div className="bg-closer-blue mb-5 rounded-xl p-3.5 text-sm leading-relaxed">
            <strong>This question will be created Inactive.</strong> Activate it after review to
            make it eligible for future selection.
          </div>
        )}
        <FieldGroup>
          <Field data-invalid={!!textError}>
            <FieldLabel htmlFor="question-text">Question wording</FieldLabel>
            <Textarea
              {...form.register("text")}
              aria-describedby={textError ? "question-text-error" : "question-text-count"}
              aria-invalid={!!textError}
              className="min-h-32 rounded-xl bg-white"
              id="question-text"
              placeholder="Enter the exact wording people will see…"
            />
            <div className="flex items-start justify-between gap-3">
              <FieldError errors={textError ? [textError] : undefined} id="question-text-error" />
              <p className="text-closer-muted ml-auto text-xs" id="question-text-count">
                {text?.length ?? 0}
              </p>
            </div>
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField
              id="question-category"
              label="Category"
              name="category"
              error={form.formState.errors.category}
              register={form.register("category")}
            >
              <option value="">Select category</option>
              {categoryOptions.map((category: CloserCategory) => (
                <option key={category} value={category}>
                  {categoryLabel(category)}
                </option>
              ))}
            </SelectField>
            <SelectField
              id="question-intensity"
              label="Intensity"
              name="intensity"
              error={form.formState.errors.intensity}
              register={form.register("intensity")}
            >
              <option value="">Select intensity</option>
              <option value="light">Light</option>
              <option value="medium">Medium</option>
              <option value="deep">Deep</option>
            </SelectField>
            <SelectField
              id="question-relationship"
              label="Relationship fit"
              name="relationshipFit"
              error={form.formState.errors.relationshipFit}
              register={form.register("relationshipFit")}
            >
              <option value="">Select relationship fit</option>
              <option value="both">Both</option>
              <option value="partner">Partner</option>
              <option value="friend">Friend</option>
            </SelectField>
            <SelectField
              id="question-mode"
              label="Mode fit"
              name="modeFit"
              error={form.formState.errors.modeFit}
              register={form.register("modeFit")}
            >
              <option value="">Select mode fit</option>
              <option value="both">Both</option>
              <option value="private">Private</option>
              <option value="together">Together</option>
            </SelectField>
          </div>
        </FieldGroup>
        {incompatibleRelationship ? (
          <p className="text-closer-error mt-3 text-sm" role="alert">
            Relationship questions need Partner fit; Friendship questions need Friend fit.
          </p>
        ) : null}
        {serverError ? (
          <div className="mt-4">
            <FormServerError>{serverError}</FormServerError>
            {serverError.startsWith("This question changed") && revisionUrl ? (
              <Link
                className="text-closer-navy mt-2 inline-flex rounded-md font-bold underline underline-offset-4 focus-visible:ring-2"
                href={`${revisionUrl}?view=history` as Route}
              >
                Review the latest revision
              </Link>
            ) : null}
          </div>
        ) : null}
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <AsyncButton
            disabled={pending || !form.formState.isValid || incompatibleRelationship}
            pending={pending}
            pendingText="Saving…"
            type="submit"
          >
            {questionId ? "Save new revision" : "Create question"}
          </AsyncButton>
          <Link
            className="text-closer-navy inline-flex min-h-10 items-center rounded-xl px-4 text-sm font-bold underline-offset-4 hover:underline focus-visible:ring-2"
            href={revisionUrl ? (revisionUrl as Route) : ("/admin/questions" as Route)}
          >
            Cancel
          </Link>
        </div>
      </form>

      <aside aria-label="Wording checks" className="flex flex-col gap-3">
        {duplicateError ? (
          <Callout tone="yellow" title="Duplicate check unavailable">
            {duplicateError}
          </Callout>
        ) : null}
        {duplicates.length > 0 ? (
          <Callout tone="yellow" title="Potential duplicate found">
            <p>
              This wording closely matches an existing question. You can still save it if the
              distinction is intentional.
            </p>
            <ul className="mt-3 flex flex-col gap-2">
              {duplicates.map((match) => (
                <li
                  className="border-closer-navy/10 rounded-xl border bg-white p-3"
                  key={match.questionId}
                >
                  <Link
                    className="text-closer-navy font-bold underline-offset-4 hover:underline focus-visible:ring-2"
                    href={`/admin/questions/${match.questionId}` as Route}
                  >
                    {match.text}
                  </Link>
                  <p className="text-closer-muted mt-1 text-xs">
                    Question · v{match.revisionNumber} · {match.isActive ? "Active" : "Inactive"}
                  </p>
                </li>
              ))}
            </ul>
          </Callout>
        ) : text?.trim() && !duplicateError ? (
          <Callout tone="mint" title="No matching wording found">
            This wording looks distinct from the current catalog.
          </Callout>
        ) : null}
        <Callout tone="blue" title="Editorial note">
          Category and intensity describe different things. For example, Category: Deep can have
          Intensity: Light, Medium, or Deep.
        </Callout>
      </aside>
    </div>
  );
}

function SelectField({
  id,
  label,
  name,
  register,
  error,
  children,
}: {
  id: string;
  label: string;
  name: string;
  register: UseFormRegisterReturn;
  error?: FormFieldError;
  children: ReactNode;
}) {
  return (
    <Field data-invalid={!!error}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <select
        aria-describedby={error ? `${id}-error` : undefined}
        aria-invalid={!!error}
        className={selectClassName}
        id={id}
        {...register}
        aria-label={label}
        name={name}
      >
        {children}
      </select>
      <FieldError errors={error ? [error] : undefined} id={`${id}-error`} />
    </Field>
  );
}

function Callout({
  title,
  children,
  tone,
}: {
  title: string;
  children: ReactNode;
  tone: "yellow" | "mint" | "blue";
}) {
  const colors = {
    yellow: "bg-closer-yellow/55",
    mint: "bg-closer-mint/55",
    blue: "bg-closer-blue/65",
  };
  return (
    <section className={`${colors[tone]} rounded-closer-panel shadow-closer-soft p-4`}>
      <h2 className="font-extrabold">{title}</h2>
      <div className="mt-2 text-sm leading-relaxed">{children}</div>
    </section>
  );
}
