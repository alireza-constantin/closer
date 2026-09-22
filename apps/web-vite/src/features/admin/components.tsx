import * as React from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Navigate, NavLink, Outlet, useLocation, useNavigate, useParams } from "react-router";
import { useForm } from "react-hook-form";

import {
  adminLogin,
  adminLogout,
  adminSessionKey,
  createQuestion,
  editQuestion,
  findDuplicates,
  getAdminSession,
  getQuestion,
  listQuestions,
  restoreRevision,
  setQuestionActivity,
  withdrawRevision,
  type Category,
  type Intensity,
  type ModeFit,
  type Question,
  type QuestionFilters,
  type RelationshipFit,
  type Revision,
  type RevisionFields,
} from "@/features/admin/api";
import { revisionFieldsSchema, type RevisionFieldsForm } from "@/features/admin/forms";
import { ApiError } from "@/lib/api-client";

export const questionListKey = ["admin", "questions"] as const;
export const questionDetailKey = (id: string) => ["admin", "question", id] as const;

const inputClass =
  "border-closer-line bg-closer-surface focus:border-closer-coral focus:ring-closer-coral/20 mt-2 min-h-11 w-full rounded-xl border px-3 outline-none focus:ring-2";
const primaryButton =
  "bg-closer-coral text-closer-navy min-h-11 rounded-xl px-4 font-extrabold shadow-[0_8px_18px_rgba(239,114,91,.18)] transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60";
const secondaryButton =
  "border-closer-line bg-closer-surface text-closer-navy min-h-11 rounded-xl border px-4 font-bold transition hover:border-closer-coral disabled:opacity-60";

function errorMessage(error: unknown) {
  if (!(error instanceof ApiError)) return "We couldn’t complete that request. Try again.";
  if (error.status === 429 || error.code === "RATE_LIMITED")
    return "Too many sign-in attempts. Try again in a moment.";
  if (error.code === "INVALID_CREDENTIALS") return "The email or password is not valid.";
  if (error.code === "CONFLICT")
    return "This Question changed. Review the latest revision before trying again.";
  if (error.code === "CURRENT_REVISION_WITHDRAWN")
    return "Create or restore a safe revision before activating this Question.";
  if (error.code === "FORBIDDEN") return "You don’t have permission to perform that action.";
  if (error.code === "UNAUTHENTICATED") return "Your Admin session has ended. Sign in again.";
  if (error.code === "VALIDATION_ERROR") return "Check the highlighted details and try again.";
  return "We couldn’t complete that request. Try again.";
}

function PageStatus({
  children,
  tone = "error",
}: {
  children: React.ReactNode;
  tone?: "error" | "notice";
}) {
  return (
    <p
      className={
        tone === "error"
          ? "text-closer-coral text-sm font-semibold"
          : "text-closer-navy bg-closer-yellow/40 rounded-xl p-3 text-sm font-semibold"
      }
      role={tone === "error" ? "alert" : "status"}
    >
      {children}
    </p>
  );
}

export function AdminGuard() {
  const session = useQuery({ queryKey: adminSessionKey, queryFn: getAdminSession, retry: false });
  if (session.isPending)
    return (
      <main className="text-closer-muted grid min-h-svh place-items-center">
        Checking Admin access…
      </main>
    );
  if (session.error || !session.data?.actor) return <Navigate replace to="/admin/login" />;
  if (session.data.actor.kind !== "admin") return <AdminDenied />;
  return <AdminLayout />;
}

function AdminDenied() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return (
    <main className="bg-closer-cream text-closer-navy grid min-h-svh place-items-center p-6">
      <section className="bg-closer-surface border-closer-line w-full max-w-md rounded-3xl border p-8 text-center shadow-[0_18px_50px_rgba(16,37,101,.08)]">
        <p className="text-closer-coral text-sm font-extrabold tracking-[.12em] uppercase">
          Closer Admin
        </p>
        <h1 className="mt-3 text-3xl font-extrabold tracking-[-.04em]">Admin access required</h1>
        <p className="text-closer-muted mt-3 leading-6">
          This account is not authorized for the Admin workspace.
        </p>
        <button
          className={`${primaryButton} mt-6 w-full`}
          onClick={async () => {
            await adminLogout().catch(() => undefined);
            queryClient.clear();
            navigate("/admin/login");
          }}
        >
          Sign in with an Admin account
        </button>
      </section>
    </main>
  );
}

function AdminLayout() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const title =
    location.pathname === "/admin"
      ? "Overview"
      : location.pathname.includes("/new")
        ? "New Question"
        : location.pathname.includes("/questions/")
          ? "Question Detail"
          : "Question Catalog";
  return (
    <div className="bg-closer-cream text-closer-navy min-h-svh lg:grid lg:grid-cols-[240px_1fr]">
      <aside className="border-closer-line bg-closer-surface/80 border-b p-4 lg:flex lg:min-h-svh lg:flex-col lg:border-r lg:border-b-0 lg:p-6">
        <Link className="text-closer-navy text-2xl font-extrabold tracking-[-.06em]" to="/admin">
          Closer <span className="text-closer-coral">♥</span>
        </Link>
        <p className="text-closer-muted mt-1 text-xs font-bold tracking-[.12em] uppercase">
          Admin workspace
        </p>
        <nav aria-label="Admin navigation" className="mt-6 flex gap-2 overflow-x-auto lg:flex-col">
          <NavLink
            className={({ isActive }) =>
              `rounded-xl px-3 py-2 text-sm font-bold ${isActive ? "bg-closer-coral/15 text-closer-navy" : "text-closer-muted hover:bg-closer-peach/40"}`
            }
            to="/admin/questions"
          >
            Question Catalog
          </NavLink>
        </nav>
        <button
          className="text-closer-muted mt-5 text-left text-sm font-bold underline lg:mt-auto"
          onClick={async () => {
            await adminLogout().catch(() => undefined);
            queryClient.clear();
            navigate("/admin/login");
          }}
        >
          Log out
        </button>
      </aside>
      <main className="mx-auto w-full max-w-[1440px] p-4 sm:p-6 lg:p-10">
        <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-closer-coral text-xs font-extrabold tracking-[.12em] uppercase">
              Question authoring
            </p>
            <h1 className="mt-2 text-3xl font-extrabold tracking-[-.05em] sm:text-4xl">{title}</h1>
          </div>
          <Link className={secondaryButton} to="/admin/questions/new">
            New Question
          </Link>
        </header>
        <Outlet />
      </main>
    </div>
  );
}

export function AdminLoginPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const session = useQuery({ queryKey: adminSessionKey, queryFn: getAdminSession, retry: false });
  const form = useForm<{ email: string; password: string }>({
    defaultValues: { email: "", password: "" },
  });
  const login = useMutation({
    mutationFn: (value: { email: string; password: string }) =>
      adminLogin(value.email, value.password),
    onSuccess: (value) => {
      queryClient.setQueryData(adminSessionKey, value);
      navigate("/admin", { replace: true });
    },
  });
  if (session.data?.actor?.kind === "admin") return <Navigate replace to="/admin" />;
  return (
    <main className="bg-closer-cream text-closer-navy grid min-h-svh place-items-center p-5">
      <section className="bg-closer-surface border-closer-line relative w-full max-w-[480px] rounded-[2rem] border p-6 shadow-[0_22px_70px_rgba(16,37,101,.1)] sm:p-10">
        <div
          aria-hidden="true"
          className="bg-closer-yellow/60 absolute -top-5 -right-4 size-16 rotate-12 rounded-[45%_55%_55%_45%]"
        />
        <p className="text-closer-coral text-sm font-extrabold tracking-[.12em] uppercase">
          Closer Admin
        </p>
        <h1 className="mt-3 text-4xl font-extrabold tracking-[-.06em]">Make the catalog better.</h1>
        <p className="text-closer-muted mt-3 leading-6">
          Sign in to curate the questions that help people find their way closer.
        </p>
        <form
          className="mt-8 space-y-5"
          onSubmit={form.handleSubmit((value) => login.mutate(value))}
        >
          <label className="block text-sm font-bold">
            Email
            <input
              autoComplete="username"
              className={inputClass}
              type="email"
              {...form.register("email", { required: "Email is required." })}
            />
          </label>
          {form.formState.errors.email && (
            <PageStatus>{form.formState.errors.email.message}</PageStatus>
          )}
          <label className="block text-sm font-bold">
            Password
            <input
              autoComplete="current-password"
              className={inputClass}
              type="password"
              {...form.register("password", { required: "Password is required." })}
            />
          </label>
          {form.formState.errors.password && (
            <PageStatus>{form.formState.errors.password.message}</PageStatus>
          )}
          <button className={`${primaryButton} w-full`} disabled={login.isPending}>
            {login.isPending ? "Signing in…" : "Sign in"}
          </button>
          {login.error && <PageStatus>{errorMessage(login.error)}</PageStatus>}
        </form>
      </section>
    </main>
  );
}

export function AdminHomePage() {
  return (
    <section className="grid gap-4 sm:grid-cols-2">
      <Link
        className="bg-closer-surface border-closer-line rounded-3xl border p-6 transition hover:-translate-y-0.5"
        to="/admin/questions"
      >
        <p className="text-closer-coral text-sm font-bold uppercase">Catalog</p>
        <h2 className="mt-2 text-2xl font-extrabold">Review Questions</h2>
        <p className="text-closer-muted mt-2 leading-6">
          Search, filter, and open the editorial catalog.
        </p>
      </Link>
      <Link
        className="bg-closer-peach/50 rounded-3xl p-6 transition hover:-translate-y-0.5"
        to="/admin/questions/new"
      >
        <p className="text-closer-coral text-sm font-bold uppercase">Author</p>
        <h2 className="mt-2 text-2xl font-extrabold">New Question</h2>
        <p className="text-closer-muted mt-2 leading-6">
          Add a new inactive question to the catalog.
        </p>
      </Link>
    </section>
  );
}

function SelectField({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="text-closer-navy block text-sm font-bold">
      {label}
      <select
        className={inputClass}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">Any</option>
        {children}
      </select>
    </label>
  );
}

function categoryLabel(value: string) {
  return value === "fun"
    ? "Fun"
    : value === "deep"
      ? "Deep"
      : value === "memories"
        ? "Memories"
        : value === "relationship"
          ? "Relationship"
          : "Friendship";
}
function facetLabel(value: string) {
  return value === "both" ? "Both" : value.charAt(0).toUpperCase() + value.slice(1);
}

function ActivityBadge({ active }: { active: boolean }) {
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-extrabold ${active ? "bg-closer-mint/70" : "bg-closer-lavender/60"}`}
    >
      {active ? "Active" : "Inactive"}
    </span>
  );
}
function HealthBadge({ withdrawn }: { withdrawn: boolean }) {
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-extrabold ${withdrawn ? "bg-closer-coral/15 text-closer-coral" : "bg-closer-mint/70"}`}
    >
      {withdrawn ? "Current withdrawn" : "Safe"}
    </span>
  );
}

export function AdminQuestionListPage() {
  const [filters, setFilters] = React.useState<QuestionFilters>({ page: 1, pageSize: 25 });
  const [search, setSearch] = React.useState("");
  const query = useQuery({
    queryKey: [...questionListKey, filters],
    queryFn: () => listQuestions(filters),
  });
  const update = (key: keyof QuestionFilters, value: string) =>
    setFilters((current) => ({ ...current, [key]: value, page: 1 }));
  return (
    <section>
      <div className="bg-closer-surface border-closer-line rounded-3xl border p-4 sm:p-5">
        <div className="grid gap-3 md:grid-cols-[minmax(240px,1.5fr)_repeat(4,minmax(120px,1fr))]">
          <label className="text-closer-navy block text-sm font-bold">
            Search
            <input
              className={inputClass}
              value={search}
              placeholder="Search wording"
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") update("search", search.trim());
              }}
            />
          </label>
          <SelectField
            label="Category"
            value={filters.category ?? ""}
            onChange={(value) => update("category", value)}
          >
            {["fun", "deep", "memories", "relationship", "friendship"].map((value) => (
              <option key={value} value={value}>
                {categoryLabel(value)}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Intensity"
            value={filters.intensity ?? ""}
            onChange={(value) => update("intensity", value)}
          >
            {["light", "medium", "deep"].map((value) => (
              <option key={value} value={value}>
                {facetLabel(value)}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Relationship"
            value={filters.relationshipFit ?? ""}
            onChange={(value) => update("relationshipFit", value)}
          >
            {["both", "partner", "friend"].map((value) => (
              <option key={value} value={value}>
                {facetLabel(value)}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Mode"
            value={filters.modeFit ?? ""}
            onChange={(value) => update("modeFit", value)}
          >
            {["both", "together", "private"].map((value) => (
              <option key={value} value={value}>
                {facetLabel(value)}
              </option>
            ))}
          </SelectField>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button className={primaryButton} onClick={() => update("search", search.trim())}>
            Apply filters
          </button>
          <button
            className={secondaryButton}
            onClick={() => {
              setSearch("");
              setFilters({ page: 1, pageSize: 25 });
            }}
          >
            Clear
          </button>
          <span className="text-closer-muted text-sm">Filters are applied by the Admin API.</span>
        </div>
      </div>
      {query.isPending && (
        <p className="text-closer-muted mt-8" role="status">
          Loading Questions…
        </p>
      )}
      {query.error && (
        <div className="mt-8">
          <PageStatus>{errorMessage(query.error)}</PageStatus>
        </div>
      )}
      {query.data?.items.length === 0 && (
        <div className="bg-closer-surface border-closer-line mt-8 rounded-3xl border p-8 text-center">
          <h2 className="text-xl font-extrabold">No Questions found</h2>
          <p className="text-closer-muted mt-2">Try a different search or create a new Question.</p>
        </div>
      )}
      {query.data && query.data.items.length > 0 && (
        <div className="bg-closer-surface border-closer-line mt-8 overflow-hidden rounded-3xl border">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left">
              <caption className="sr-only">Question catalog</caption>
              <thead className="bg-closer-peach/35 text-closer-muted text-xs font-extrabold tracking-[.08em] uppercase">
                <tr>
                  <th className="px-4 py-3">Question</th>
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3">Fit</th>
                  <th className="px-4 py-3">Mode</th>
                  <th className="px-4 py-3">Intensity</th>
                  <th className="px-4 py-3">Activity</th>
                  <th className="px-4 py-3">Revision health</th>
                </tr>
              </thead>
              <tbody className="divide-closer-line/70 divide-y">
                {query.data.items.map((item) => (
                  <QuestionRow item={item} key={item.id} />
                ))}
              </tbody>
            </table>
          </div>
          <div className="border-closer-line flex items-center justify-between border-t p-4">
            <span className="text-closer-muted text-sm">Page {query.data.page}</span>
            <div className="flex gap-2">
              <button
                className={secondaryButton}
                disabled={query.data.page <= 1}
                onClick={() =>
                  setFilters((value) => ({ ...value, page: Math.max(1, (value.page ?? 1) - 1) }))
                }
              >
                Previous
              </button>
              <button
                className={secondaryButton}
                disabled={query.data.items.length < query.data.pageSize}
                onClick={() => setFilters((value) => ({ ...value, page: (value.page ?? 1) + 1 }))}
              >
                Next
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function QuestionRow({ item }: { item: Question }) {
  return (
    <tr className="hover:bg-closer-cream/60">
      <td className="max-w-[400px] px-4 py-4">
        <Link
          className="decoration-closer-coral/40 font-bold underline underline-offset-4"
          to={`/admin/questions/${item.id}`}
        >
          {item.current.text}
        </Link>
        <span className="text-closer-muted mt-1 block text-xs">v{item.current.revisionNumber}</span>
      </td>
      <td className="px-4 py-4 text-sm font-bold">{categoryLabel(item.current.category)}</td>
      <td className="px-4 py-4 text-sm">{facetLabel(item.current.relationshipFit)}</td>
      <td className="px-4 py-4 text-sm">{facetLabel(item.current.modeFit)}</td>
      <td className="px-4 py-4 text-sm">{facetLabel(item.current.intensity)}</td>
      <td className="px-4 py-4">
        <ActivityBadge active={item.isActive} />
      </td>
      <td className="px-4 py-4">
        <HealthBadge withdrawn={item.current.withdrawn} />
      </td>
    </tr>
  );
}

function defaults(fields?: RevisionFields): RevisionFieldsForm {
  return fields
    ? { ...fields }
    : { text: "", category: "fun", relationshipFit: "both", modeFit: "both", intensity: "light" };
}

function QuestionForm({
  initial,
  excludeQuestionId,
  submitLabel,
  onSubmit,
  pending,
  error,
}: {
  initial?: RevisionFields;
  excludeQuestionId?: string;
  submitLabel: string;
  onSubmit: (value: RevisionFieldsForm) => void;
  pending: boolean;
  error?: unknown;
}) {
  const form = useForm<RevisionFieldsForm>({
    resolver: zodResolver(revisionFieldsSchema),
    defaultValues: defaults(initial),
  });
  const text = form.watch("text");
  const duplicate = useQuery({
    queryKey: ["admin", "duplicates", excludeQuestionId ?? "new", text.trim()],
    queryFn: () => findDuplicates(text.trim(), excludeQuestionId),
    enabled: text.trim().length > 2,
    staleTime: 1000,
  });
  React.useEffect(() => {
    if (initial) form.reset(defaults(initial));
  }, [initial, form]);
  return (
    <form className="space-y-6" onSubmit={form.handleSubmit(onSubmit)}>
      <label className="text-closer-navy block text-sm font-bold">
        Question wording
        <textarea
          autoFocus
          className={`${inputClass} min-h-32 resize-y py-3`}
          {...form.register("text")}
        />
      </label>
      {form.formState.errors.text && <PageStatus>{form.formState.errors.text.message}</PageStatus>}
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          label="Category"
          value={form.watch("category")}
          onChange={(value) =>
            form.setValue("category", value as Category, { shouldValidate: true })
          }
        >
          {["fun", "deep", "memories", "relationship", "friendship"].map((value) => (
            <option key={value} value={value}>
              {categoryLabel(value)}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Intensity"
          value={form.watch("intensity")}
          onChange={(value) =>
            form.setValue("intensity", value as Intensity, { shouldValidate: true })
          }
        >
          {["light", "medium", "deep"].map((value) => (
            <option key={value} value={value}>
              {facetLabel(value)}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Relationship fit"
          value={form.watch("relationshipFit")}
          onChange={(value) =>
            form.setValue("relationshipFit", value as RelationshipFit, { shouldValidate: true })
          }
        >
          {["both", "partner", "friend"].map((value) => (
            <option key={value} value={value}>
              {facetLabel(value)}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Mode fit"
          value={form.watch("modeFit")}
          onChange={(value) => form.setValue("modeFit", value as ModeFit, { shouldValidate: true })}
        >
          {["both", "together", "private"].map((value) => (
            <option key={value} value={value}>
              {facetLabel(value)}
            </option>
          ))}
        </SelectField>
      </div>
      {form.formState.errors.relationshipFit && (
        <PageStatus>{form.formState.errors.relationshipFit.message}</PageStatus>
      )}
      {duplicate.data && duplicate.data.length > 0 && (
        <div
          className="border-closer-yellow bg-closer-yellow/30 rounded-2xl border p-4"
          role="status"
        >
          <p className="font-extrabold">Possible duplicate wording</p>
          <p className="text-closer-muted mt-1 text-sm">
            This is a warning only. You can still save this Question.
          </p>
          <ul className="mt-3 space-y-2 text-sm">
            {duplicate.data.map((match) => (
              <li key={match.questionId}>
                <Link className="font-bold underline" to={`/admin/questions/${match.questionId}`}>
                  {match.text}
                </Link>
                <span className="text-closer-muted">
                  {" "}
                  · v{match.revisionNumber} · {match.isActive ? "Active" : "Inactive"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {duplicate.error && (
        <p className="text-closer-muted text-xs" role="status">
          Duplicate checking is temporarily unavailable; saving is still available.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button className={primaryButton} disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </button>
        {error != null && <PageStatus>{errorMessage(error)}</PageStatus>}
      </div>
    </form>
  );
}

export function AdminNewQuestionPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const create = useMutation({
    mutationFn: createQuestion,
    onSuccess: async (question) => {
      await queryClient.invalidateQueries({ queryKey: questionListKey });
      navigate(`/admin/questions/${question.id}`);
    },
  });
  return (
    <section className="bg-closer-surface border-closer-line max-w-4xl rounded-3xl border p-5 sm:p-8">
      <div className="mb-8">
        <p className="text-closer-coral text-sm font-extrabold uppercase">Create</p>
        <h2 className="mt-2 text-2xl font-extrabold">Add a new Question</h2>
        <p className="text-closer-muted mt-2 leading-6">
          New Questions begin inactive. Publishing is a separate lifecycle action.
        </p>
      </div>
      <QuestionForm
        submitLabel="Create inactive Question"
        onSubmit={(value) => create.mutate(value)}
        pending={create.isPending}
        error={create.error}
      />
    </section>
  );
}

function RevisionSummary({
  revision,
  current,
  onRestore,
  onWithdraw,
}: {
  revision: Revision;
  current: boolean;
  onRestore: () => void;
  onWithdraw: () => void;
}) {
  return (
    <article
      className={`border-closer-line rounded-2xl border p-4 ${current ? "bg-closer-peach/35" : "bg-closer-surface"}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-closer-navy font-extrabold">
            v{revision.revisionNumber}{" "}
            {current && <span className="text-closer-coral ml-1 text-xs uppercase">Current</span>}
          </p>
          <p className="text-closer-muted mt-1 text-sm">
            {categoryLabel(revision.category)} · {facetLabel(revision.relationshipFit)} ·{" "}
            {facetLabel(revision.modeFit)} · {facetLabel(revision.intensity)}
          </p>
        </div>
        {revision.withdrawn && <HealthBadge withdrawn />}
      </div>
      <p className="mt-4 leading-6">{revision.text}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        {!current && !revision.withdrawn && (
          <button className={secondaryButton} onClick={onRestore}>
            Restore as new revision
          </button>
        )}
        {!revision.withdrawn && (
          <button
            className="border-closer-coral text-closer-coral min-h-11 rounded-xl border px-4 text-sm font-bold"
            onClick={onWithdraw}
          >
            Withdraw revision
          </button>
        )}
      </div>
    </article>
  );
}

export function AdminQuestionDetailPage() {
  const { questionId = "" } = useParams();
  const queryClient = useQueryClient();
  const detail = useQuery({
    queryKey: questionDetailKey(questionId),
    queryFn: () => getQuestion(questionId),
    enabled: Boolean(questionId),
  });
  const [editing, setEditing] = React.useState(false);
  const [withdrawTarget, setWithdrawTarget] = React.useState<Revision | null>(null);
  const [stale, setStale] = React.useState(false);
  const edit = useMutation({
    mutationFn: (value: RevisionFieldsForm) =>
      editQuestion(questionId, value, detail.data?.question.currentRevisionId ?? ""),
    onSuccess: async () => {
      setEditing(false);
      setStale(false);
      await queryClient.invalidateQueries({ queryKey: questionDetailKey(questionId) });
      await queryClient.invalidateQueries({ queryKey: questionListKey });
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409) setStale(true);
    },
  });
  const activity = useMutation({
    mutationFn: (action: "activate" | "reactivate" | "deactivate") =>
      setQuestionActivity(questionId, action),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: questionDetailKey(questionId) });
      await queryClient.invalidateQueries({ queryKey: questionListKey });
    },
  });
  const restore = useMutation({
    mutationFn: (revisionId: string) =>
      restoreRevision(questionId, revisionId, detail.data?.question.currentRevisionId ?? ""),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: questionDetailKey(questionId) });
      await queryClient.invalidateQueries({ queryKey: questionListKey });
    },
  });
  const withdraw = useMutation({
    mutationFn: ({ revisionId, reason }: { revisionId: string; reason: string }) =>
      withdrawRevision(questionId, revisionId, reason),
    onSuccess: async () => {
      setWithdrawTarget(null);
      await queryClient.invalidateQueries({ queryKey: questionDetailKey(questionId) });
      await queryClient.invalidateQueries({ queryKey: questionListKey });
    },
  });
  if (detail.isPending) return <p className="text-closer-muted">Loading Question…</p>;
  if (detail.error || !detail.data) return <PageStatus>{errorMessage(detail.error)}</PageStatus>;
  const { question, revisions } = detail.data;
  const current = question.current;
  return (
    <section className="space-y-6">
      <div className="bg-closer-surface border-closer-line rounded-3xl border p-5 sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-closer-muted text-sm">Question {question.id}</p>
            <h2 className="mt-2 max-w-3xl text-2xl leading-tight font-extrabold sm:text-3xl">
              {current.text}
            </h2>
          </div>
          <div className="flex flex-wrap gap-2">
            <ActivityBadge active={question.isActive} />
            <HealthBadge withdrawn={current.withdrawn} />
          </div>
        </div>
        <div className="mt-6 grid gap-3 text-sm sm:grid-cols-4">
          <div>
            <span className="text-closer-muted block">Category</span>
            <strong>{categoryLabel(current.category)}</strong>
          </div>
          <div>
            <span className="text-closer-muted block">Relationship</span>
            <strong>{facetLabel(current.relationshipFit)}</strong>
          </div>
          <div>
            <span className="text-closer-muted block">Mode</span>
            <strong>{facetLabel(current.modeFit)}</strong>
          </div>
          <div>
            <span className="text-closer-muted block">Intensity</span>
            <strong>{facetLabel(current.intensity)}</strong>
          </div>
        </div>
        <div className="mt-7 flex flex-wrap gap-3">
          <button className={primaryButton} onClick={() => setEditing((value) => !value)}>
            {editing ? "Cancel edit" : "Edit current revision"}
          </button>
          {question.isActive ? (
            <button
              className={secondaryButton}
              disabled={activity.isPending}
              onClick={() => activity.mutate("deactivate")}
            >
              Deactivate
            </button>
          ) : (
            <>
              <button
                className={secondaryButton}
                disabled={activity.isPending || current.withdrawn}
                onClick={() => activity.mutate("activate")}
              >
                Activate
              </button>
              <button
                className={secondaryButton}
                disabled={activity.isPending || current.withdrawn}
                onClick={() => activity.mutate("reactivate")}
              >
                Reactivate
              </button>
            </>
          )}
          {!current.withdrawn && (
            <button
              className="border-closer-coral text-closer-coral min-h-11 rounded-xl border px-4 font-bold"
              onClick={() => setWithdrawTarget(current)}
            >
              Withdraw current revision
            </button>
          )}
        </div>
        {activity.error && (
          <div className="mt-4">
            <PageStatus>{errorMessage(activity.error)}</PageStatus>
          </div>
        )}
        {stale && (
          <div className="bg-closer-yellow/40 mt-5 rounded-2xl p-4" role="alert">
            <p className="font-extrabold">This Question changed while you were editing.</p>
            <p className="text-closer-muted mt-1 text-sm">
              Your draft is still here. Review the latest revision before trying again.
            </p>
            <button
              className={`${secondaryButton} mt-3`}
              onClick={async () => {
                await detail.refetch();
                setStale(false);
                setEditing(false);
              }}
            >
              Reload latest revision
            </button>
          </div>
        )}
      </div>
      {editing && (
        <div className="bg-closer-surface border-closer-line rounded-3xl border p-5 sm:p-8">
          <div className="mb-6">
            <h3 className="text-xl font-extrabold">Create a new revision</h3>
            <p className="text-closer-muted mt-1 text-sm">
              Editing never changes historical revisions, and preserves Question activity.
            </p>
          </div>
          <QuestionForm
            initial={current}
            excludeQuestionId={question.id}
            submitLabel="Save as new revision"
            onSubmit={(value) => edit.mutate(value)}
            pending={edit.isPending}
            error={edit.error}
          />
        </div>
      )}
      <div className="bg-closer-surface border-closer-line rounded-3xl border p-5 sm:p-8">
        <div className="mb-5">
          <h3 className="text-xl font-extrabold">Revision history</h3>
          <p className="text-closer-muted mt-1 text-sm">
            Restoring copies an older revision into a new current revision; history remains intact.
          </p>
        </div>
        <div className="space-y-3">
          {[...revisions]
            .sort((a, b) => b.revisionNumber - a.revisionNumber)
            .map((revision) => (
              <RevisionSummary
                current={revision.id === question.currentRevisionId}
                key={revision.id}
                onRestore={() => restore.mutate(revision.id)}
                onWithdraw={() => setWithdrawTarget(revision)}
                revision={revision}
              />
            ))}
        </div>
        {restore.error && (
          <div className="mt-4">
            <PageStatus>{errorMessage(restore.error)}</PageStatus>
          </div>
        )}
      </div>
      {withdrawTarget && (
        <WithdrawalDialog
          current={withdrawTarget}
          pending={withdraw.isPending}
          error={withdraw.error}
          onCancel={() => setWithdrawTarget(null)}
          onConfirm={(reason) => withdraw.mutate({ revisionId: withdrawTarget.id, reason })}
        />
      )}
    </section>
  );
}

function WithdrawalDialog({
  current,
  pending,
  error,
  onCancel,
  onConfirm,
}: {
  current: Revision;
  pending: boolean;
  error?: unknown;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = React.useState("");
  const [touched, setTouched] = React.useState(false);
  const invalid = reason.trim().length === 0;
  return (
    <div
      className="bg-closer-navy/30 fixed inset-0 z-10 grid place-items-center p-5"
      role="presentation"
    >
      <section
        aria-labelledby="withdraw-title"
        aria-modal="true"
        className="bg-closer-surface border-closer-line w-full max-w-lg rounded-3xl border p-6 shadow-2xl"
        role="dialog"
      >
        <h2 className="text-2xl font-extrabold" id="withdraw-title">
          Withdraw revision?
        </h2>
        <p className="text-closer-muted mt-2 leading-6">
          This is an irreversible safety action for the current revision. The Question will remain
          in history.
        </p>
        <p className="bg-closer-peach/40 mt-4 rounded-xl p-3 text-sm font-semibold">
          “{current.text}”
        </p>
        <label className="mt-5 block text-sm font-bold">
          Reason required
          <textarea
            autoFocus
            className={`${inputClass} min-h-24 py-3`}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
        {touched && invalid && <PageStatus>Give a reason before withdrawing.</PageStatus>}
        {error != null && (
          <div className="mt-3">
            <PageStatus>{errorMessage(error)}</PageStatus>
          </div>
        )}
        <div className="mt-6 flex justify-end gap-3">
          <button className={secondaryButton} onClick={onCancel}>
            Keep revision
          </button>
          <button
            className="bg-closer-coral text-closer-navy min-h-11 rounded-xl px-4 font-extrabold disabled:opacity-50"
            disabled={pending || (touched && invalid)}
            onClick={() => {
              setTouched(true);
              if (!invalid) onConfirm(reason.trim());
            }}
          >
            {pending ? "Withdrawing…" : "Withdraw revision"}
          </button>
        </div>
      </section>
    </div>
  );
}
