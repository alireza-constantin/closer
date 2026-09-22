import * as React from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useRouteError } from "react-router";
import { useForm } from "react-hook-form";

import { PageShell } from "@/app/page-shell";
import {
  createPair,
  getInviteState,
  getMe,
  getPair,
  issueInvite,
  listSpaces,
  logout,
  onboard,
  previewInvite,
  previewRejoin,
  redeemInvite,
  redeemRejoin,
  startAnonymous,
} from "@/features/consumer/api";
import {
  displayNameSchema,
  pairSchema,
  type DisplayNameForm,
  type PairForm,
} from "@/features/consumer/forms";
import { ApiError } from "@/lib/api-client";

const meKey = ["me"] as const;
const spacesKey = ["spaces"] as const;

function ErrorCopy({ error }: { error: unknown }) {
  const message =
    error instanceof ApiError && error.code === "PARTICIPANT_REQUIRED"
      ? "Finish your quick profile first."
      : "We couldn’t complete that request. Please try again.";
  return (
    <p className="text-closer-coral mt-3 text-sm font-semibold" role="alert">
      {message}
    </p>
  );
}

export function HomePage() {
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: meKey, queryFn: getMe, retry: false });
  const begin = useMutation({
    mutationFn: startAnonymous,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: meKey }),
  });
  const actor = me.data?.actor;
  if (actor?.participant) return <SpacesPage />;
  if (actor) return <OnboardingPage />;
  return (
    <PageShell>
      <section className="my-auto flex flex-1 flex-col justify-center gap-7 py-12">
        <span className="sr-only">The app is getting ready.</span>
        <div>
          <p className="text-closer-coral mb-3 text-sm font-bold tracking-[.08em] uppercase">
            A little closer
          </p>
          <h1 className="text-closer-navy max-w-md text-5xl leading-[.98] font-extrabold tracking-[-.055em]">
            Make room for the conversations that matter.
          </h1>
          <p className="text-closer-muted mt-5 max-w-sm text-lg leading-7">
            Start with a shared space for you and someone you care about.
          </p>
        </div>
        <button
          className="bg-closer-coral text-closer-navy w-full rounded-2xl px-5 py-4 font-extrabold shadow-[0_12px_28px_rgba(239,114,91,.22)] disabled:opacity-60"
          disabled={begin.isPending}
          onClick={() => begin.mutate()}
        >
          {begin.isPending ? "Opening your space…" : "Start as a guest"}
        </button>
        {begin.error && <ErrorCopy error={begin.error} />}
        <p className="text-closer-muted text-center text-xs">No account required to begin.</p>
      </section>
    </PageShell>
  );
}

export function OnboardingPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const form = useForm<DisplayNameForm>({
    resolver: zodResolver(displayNameSchema),
    defaultValues: { displayName: "" },
  });
  const mutation = useMutation({
    mutationFn: (value: DisplayNameForm) => onboard(value.displayName),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: meKey });
      navigate("/spaces");
    },
  });
  return (
    <PageShell>
      <section className="my-auto flex flex-1 flex-col justify-center py-12">
        <p className="text-closer-coral mb-3 text-sm font-bold uppercase">Nice to meet you</p>
        <h1 className="text-closer-navy text-4xl font-extrabold tracking-[-.05em]">
          What should we call you?
        </h1>
        <p className="text-closer-muted mt-3 leading-6">
          This is the name people see in your Closer spaces.
        </p>
        <form
          className="mt-8 space-y-4"
          onSubmit={form.handleSubmit((value) => mutation.mutate(value))}
        >
          <label className="text-closer-navy block text-sm font-bold">
            Display name
            <input
              autoFocus
              className="border-closer-line bg-closer-surface focus:border-closer-coral mt-2 w-full rounded-2xl border px-4 py-3 outline-none"
              {...form.register("displayName")}
            />
          </label>
          {form.formState.errors.displayName && (
            <p className="text-closer-coral text-sm">{form.formState.errors.displayName.message}</p>
          )}
          <button
            className="bg-closer-coral text-closer-navy w-full rounded-2xl px-5 py-4 font-extrabold disabled:opacity-60"
            disabled={mutation.isPending}
          >
            {mutation.isPending ? "Saving…" : "Continue"}
          </button>
          {mutation.error && <ErrorCopy error={mutation.error} />}
        </form>
      </section>
    </PageShell>
  );
}

function PairFormCard({
  onSubmit,
  pending,
  error,
}: {
  onSubmit: (value: PairForm) => void;
  pending: boolean;
  error: unknown;
}) {
  const form = useForm<PairForm>({
    resolver: zodResolver(pairSchema),
    defaultValues: { intendedPersonName: "", relationshipType: "partner" },
  });
  return (
    <form className="bg-closer-peach/40 rounded-3xl p-5" onSubmit={form.handleSubmit(onSubmit)}>
      <p className="text-closer-navy font-extrabold">Create a space</p>
      <input
        className="border-closer-line bg-closer-surface mt-4 w-full rounded-2xl border px-4 py-3"
        placeholder="Their name"
        {...form.register("intendedPersonName")}
      />
      {form.formState.errors.intendedPersonName && (
        <p className="text-closer-coral mt-2 text-sm">
          {form.formState.errors.intendedPersonName.message}
        </p>
      )}
      <div className="mt-3 grid grid-cols-2 gap-2">
        {(["partner", "friend"] as const).map((value) => (
          <label
            className="border-closer-line bg-closer-surface has-[:checked]:border-closer-coral has-[:checked]:bg-closer-coral/10 rounded-2xl border p-3 text-center text-sm font-bold"
            key={value}
          >
            <input
              className="sr-only"
              type="radio"
              value={value}
              {...form.register("relationshipType")}
            />
            {value === "partner" ? "Partner" : "Friend"}
          </label>
        ))}
      </div>
      <button
        className="bg-closer-coral text-closer-navy mt-4 w-full rounded-2xl px-4 py-3 font-extrabold"
        disabled={pending}
      >
        {pending ? "Creating…" : "Create space"}
      </button>
      {error != null && <ErrorCopy error={error} />}
    </form>
  );
}

export function SpacesPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const spaces = useQuery({ queryKey: spacesKey, queryFn: listSpaces });
  const [showCreate, setShowCreate] = React.useState(false);
  const create = useMutation({
    mutationFn: createPair,
    onSuccess: async (value: any) => {
      await queryClient.invalidateQueries({ queryKey: spacesKey });
      navigate(`/pair/${value.pairId}`);
    },
  });
  return (
    <PageShell>
      <section className="flex flex-1 flex-col gap-6 py-8">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-closer-muted text-sm font-bold">Your spaces</p>
            <h1 className="text-closer-navy mt-1 text-4xl font-extrabold tracking-[-.05em]">
              Closer
            </h1>
          </div>
          <button
            className="bg-closer-navy text-closer-cream rounded-xl px-4 py-2 text-sm font-bold"
            onClick={() => setShowCreate((value) => !value)}
          >
            {showCreate ? "Close" : "New space"}
          </button>
        </div>
        {showCreate && (
          <PairFormCard
            onSubmit={(value) => create.mutate(value)}
            pending={create.isPending}
            error={create.error}
          />
        )}
        {spaces.isPending && <p className="text-closer-muted">Loading your spaces…</p>}
        {spaces.error && <ErrorCopy error={spaces.error} />}
        {spaces.data?.length === 0 && !showCreate && (
          <div className="bg-closer-surface border-closer-line rounded-3xl border p-7 text-center">
            <p className="text-closer-navy text-lg font-extrabold">Nothing here yet.</p>
            <p className="text-closer-muted mt-2 text-sm">
              Create a Partner or Friend space to get started.
            </p>
          </div>
        )}
        <div className="grid gap-3">
          {spaces.data?.map((space) => (
            <Link
              className="bg-closer-surface border-closer-line block rounded-3xl border p-5 transition hover:-translate-y-0.5"
              key={space.pairId}
              to={`/pair/${space.pairId}`}
            >
              <div className="flex items-center justify-between">
                <span className="text-closer-navy text-lg font-extrabold">
                  {space.otherParticipantDisplayName ?? space.intendedPersonName ?? "Your space"}
                </span>
                <span className="text-closer-muted text-xs font-bold uppercase">
                  {space.relationshipType}
                </span>
              </div>
              <p className="text-closer-muted mt-3 text-sm">
                {space.state === "connected" ? "Connected" : "Waiting for your person"}
              </p>
            </Link>
          ))}
        </div>
        <button
          className="text-closer-muted mt-auto self-start text-sm font-semibold underline"
          onClick={async () => {
            await logout();
            queryClient.clear();
            navigate("/");
          }}
        >
          Log out
        </button>
      </section>
    </PageShell>
  );
}

export function PairPage() {
  const { pairId = "" } = useParams();
  const pair = useQuery({
    queryKey: ["pair", pairId],
    queryFn: () => getPair(pairId),
    enabled: Boolean(pairId),
  });
  return (
    <PageShell>
      <section className="flex flex-1 flex-col py-8">
        <Link className="text-closer-muted text-sm font-bold" to="/spaces">
          ← All spaces
        </Link>
        {pair.isPending && <p className="text-closer-muted mt-8">Loading your space…</p>}
        {pair.error && <ErrorCopy error={pair.error} />}
        {pair.data && (
          <>
            <p className="text-closer-coral mt-10 text-sm font-bold uppercase">
              {pair.data.relationshipType}
            </p>
            <h1 className="text-closer-navy mt-2 text-5xl font-extrabold tracking-[-.06em]">
              {pair.data.members?.[1]?.displayName ?? pair.data.intendedPersonName ?? "Your space"}
            </h1>
            <p className="text-closer-muted mt-4 leading-7">
              {pair.data.state === "connected"
                ? "Your space is connected. Choose a mode when you’re ready."
                : "Invite your person whenever you’re ready."}
            </p>
            <div className="mt-8 grid gap-3">
              <Link className="bg-closer-peach rounded-3xl p-5" to={`/pair/${pairId}/invite`}>
                <span className="text-closer-navy font-extrabold">Invite your person</span>
                <span className="text-closer-muted mt-1 block text-sm">
                  Share a secure invitation link.
                </span>
              </Link>
              <div className="bg-closer-lavender/60 rounded-3xl p-5">
                <span className="text-closer-navy font-extrabold">Together</span>
                <span className="text-closer-muted mt-1 block text-sm">
                  A shared-device experience is coming next.
                </span>
              </div>
            </div>
          </>
        )}
      </section>
    </PageShell>
  );
}

export function InvitePage() {
  const { token = "" } = useParams();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const invite = useQuery({
    queryKey: ["invite", token],
    queryFn: () => previewInvite(token),
    enabled: Boolean(token),
  });
  const me = useQuery({ queryKey: meKey, queryFn: getMe });
  const form = useForm<DisplayNameForm>({ resolver: zodResolver(displayNameSchema) });
  const claim = useMutation({
    mutationFn: (value: DisplayNameForm) =>
      redeemInvite(token, me.data?.actor?.participant ? undefined : value.displayName),
    onSuccess: async (value: any) => {
      await queryClient.invalidateQueries({ queryKey: meKey });
      navigate(`/pair/${value.pairId}`);
    },
  });
  const hasParticipant = Boolean(me.data?.actor?.participant);
  return (
    <PageShell>
      <section className="my-auto flex flex-1 flex-col justify-center py-10">
        <Link className="text-closer-muted text-sm font-bold" to="/">
          ← Back
        </Link>
        {invite.isPending && <p className="text-closer-muted mt-8">Opening invitation…</p>}
        {invite.data && (
          <>
            <p className="text-closer-coral mt-10 text-sm font-bold uppercase">
              {invite.data.relationshipType} invitation
            </p>
            <h1 className="text-closer-navy mt-2 text-4xl font-extrabold tracking-[-.05em]">
              {invite.data.inviterDisplayName} made a space for you.
            </h1>
            <p className="text-closer-muted mt-4 leading-7">
              This preview is read-only. Joining is the step that connects you.
            </p>
            {!hasParticipant && (
              <input
                className="border-closer-line bg-closer-surface mt-7 w-full rounded-2xl border px-4 py-3"
                placeholder="Your display name"
                {...form.register("displayName")}
              />
            )}
            {!hasParticipant && form.formState.errors.displayName && (
              <p className="text-closer-coral mt-2 text-sm">
                {form.formState.errors.displayName.message}
              </p>
            )}
            <button
              className="bg-closer-coral text-closer-navy mt-4 w-full rounded-2xl px-5 py-4 font-extrabold"
              onClick={form.handleSubmit((value) => claim.mutate(value))}
              disabled={claim.isPending}
            >
              {claim.isPending ? "Joining…" : "Join this space"}
            </button>
            {claim.error && <ErrorCopy error={claim.error} />}
          </>
        )}
      </section>
    </PageShell>
  );
}

export function PairInvitePage() {
  const { pairId = "" } = useParams();
  const state = useQuery({
    queryKey: ["pair-invite", pairId],
    queryFn: () => getInviteState(pairId),
    enabled: Boolean(pairId),
  });
  const issue = useMutation({
    mutationFn: () => issueInvite(pairId),
    onSuccess: () => state.refetch(),
  });
  const token = state.data?.token;
  const shareUrl = token ? `${window.location.origin}/invite/${token}` : "";
  return (
    <PageShell>
      <section className="flex flex-1 flex-col py-8">
        <Link className="text-closer-muted text-sm font-bold" to={`/pair/${pairId}`}>
          ← Back to space
        </Link>
        <p className="text-closer-coral mt-10 text-sm font-bold uppercase">Invite</p>
        <h1 className="text-closer-navy mt-2 text-4xl font-extrabold tracking-[-.05em]">
          A gentle way to join.
        </h1>
        <p className="text-closer-muted mt-4 leading-7">
          The preview link is read-only. Your person joins only when they explicitly press Join.
        </p>
        {token ? (
          <div className="bg-closer-peach/50 mt-8 rounded-3xl p-5">
            <p className="text-closer-navy text-sm font-bold">Share this link</p>
            <p className="text-closer-navy mt-3 text-sm break-all">{shareUrl}</p>
            <button
              className="bg-closer-navy text-closer-cream mt-4 rounded-xl px-4 py-3 text-sm font-bold"
              onClick={() => navigator.clipboard.writeText(shareUrl)}
            >
              Copy link
            </button>
          </div>
        ) : (
          <button
            className="bg-closer-coral text-closer-navy mt-8 rounded-2xl px-5 py-4 font-extrabold"
            disabled={issue.isPending}
            onClick={() => issue.mutate()}
          >
            {issue.isPending ? "Preparing…" : "Create invite link"}
          </button>
        )}
        {(state.error || issue.error) != null && <ErrorCopy error={state.error ?? issue.error} />}
      </section>
    </PageShell>
  );
}

export function RejoinPage() {
  const { token = "" } = useParams();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const preview = useQuery({
    queryKey: ["rejoin", token],
    queryFn: () => previewRejoin(token),
    enabled: Boolean(token),
  });
  const form = useForm<DisplayNameForm>({ resolver: zodResolver(displayNameSchema) });
  const mutation = useMutation({
    mutationFn: (value: DisplayNameForm) => redeemRejoin(token, value.displayName),
    onSuccess: async (value: any) => {
      await queryClient.invalidateQueries({ queryKey: meKey });
      navigate(`/pair/${value.pairId}`);
    },
  });
  return (
    <PageShell>
      <section className="my-auto flex flex-1 flex-col justify-center py-10">
        <p className="text-closer-coral text-sm font-bold uppercase">Rejoin your space</p>
        <h1 className="text-closer-navy mt-2 text-4xl font-extrabold tracking-[-.05em]">
          Welcome back.
        </h1>
        <p className="text-closer-muted mt-4 leading-7">
          Rejoining preserves your existing membership and history.
        </p>
        {preview.isPending && <p className="text-closer-muted mt-8">Checking your link…</p>}
        {preview.data && (
          <form
            className="mt-7 space-y-3"
            onSubmit={form.handleSubmit((value) => mutation.mutate(value))}
          >
            <input
              className="border-closer-line bg-closer-surface w-full rounded-2xl border px-4 py-3"
              placeholder="Your display name"
              {...form.register("displayName")}
            />
            <button
              className="bg-closer-coral text-closer-navy w-full rounded-2xl px-5 py-4 font-extrabold"
              disabled={mutation.isPending}
            >
              {mutation.isPending ? "Rejoining…" : "Rejoin"}
            </button>
          </form>
        )}
        {mutation.error && <ErrorCopy error={mutation.error} />}
      </section>
    </PageShell>
  );
}

export function NotFoundPage() {
  return (
    <PageShell>
      <section className="my-auto flex flex-1 flex-col items-center justify-center py-12 text-center">
        <p className="text-closer-muted mb-2 text-sm font-bold uppercase">Not found</p>
        <h1 className="text-closer-navy text-3xl font-extrabold">This page isn’t available.</h1>
        <Link className="text-closer-navy mt-5 font-semibold underline" to="/">
          Go to Closer
        </Link>
      </section>
    </PageShell>
  );
}
export function RouteErrorPage() {
  useRouteError();
  return (
    <PageShell>
      <section className="my-auto flex flex-1 flex-col items-center justify-center py-12 text-center">
        <h1 className="text-closer-navy text-3xl font-extrabold">We couldn’t open this page.</h1>
        <Link className="text-closer-navy mt-5 font-semibold underline" to="/">
          Return to Closer
        </Link>
      </section>
    </PageShell>
  );
}
export function RoutePending() {
  return (
    <main aria-live="polite" className="text-closer-muted grid min-h-svh place-items-center">
      <p>Loading Closer…</p>
    </main>
  );
}
