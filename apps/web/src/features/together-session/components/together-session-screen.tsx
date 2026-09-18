"use client";

import { ArrowRight, Heart, X } from "lucide-react";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  chooseBufferedTogetherQuestion,
  shouldPrefetchTogetherQuestionPage,
  togetherQuestionBands,
  type TogetherLoadedQuestion,
  type TogetherQuestionBand,
  type TogetherQuestionPage,
  type TogetherQuestionPools,
} from "@Closer/db/together-playback";
import { Button } from "@Closer/ui/components/button";
import {
  Drawer,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@Closer/ui/components/drawer";
import { cn } from "@Closer/ui/lib/utils";

import { CategoryBadge, type CloserCategory } from "@/components/closer/category";
import { ActionError } from "@/components/closer/feedback";
import { ModeBadge } from "@/components/closer/mode-badge";
import { CloserBackLink } from "@/components/closer/navigation";
import { CloserPageShell } from "@/components/closer/page-shell";
import {
  togetherPickerPath,
  type PairRelationshipType,
} from "@/features/together-session/utils/together-picker-path";

type TogetherQuestion = TogetherLoadedQuestion & {
  position: number;
  liked: boolean;
};

type TogetherPlayback = {
  id: string;
  pairId: string;
  relationshipType: PairRelationshipType;
  category: string;
  exhausted: boolean;
  completedNextTransitions: number;
  question: TogetherQuestion | null;
  pages: TogetherQuestionPools;
};

type Transition =
  | {
      kind: "QUESTION";
      questionId: string;
      questionRevisionId: string;
      position: number;
      completedNextTransitions: number;
    }
  | { kind: "EXHAUSTED"; completedNextTransitions: number };

type Action = "like" | "skip" | "next" | "end";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function parseQuestion(value: unknown): TogetherQuestion | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.questionId !== "string" ||
    typeof value.questionRevisionId !== "string" ||
    typeof value.text !== "string" ||
    typeof value.position !== "number" ||
    typeof value.liked !== "boolean"
  ) {
    return null;
  }
  return value as TogetherQuestion;
}

function parseQuestionPage(value: unknown): TogetherQuestionPage | null {
  if (!isRecord(value) || !Array.isArray(value.items) || typeof value.hasMore !== "boolean")
    return null;
  if (value.nextCursor !== null && typeof value.nextCursor !== "string") return null;
  const items = value.items.map((item) => {
    if (
      !isRecord(item) ||
      typeof item.questionId !== "string" ||
      typeof item.questionRevisionId !== "string" ||
      typeof item.text !== "string"
    )
      return null;
    return item as TogetherLoadedQuestion;
  });
  if (items.some((item) => item === null)) return null;
  return {
    items: items as TogetherLoadedQuestion[],
    hasMore: value.hasMore,
    nextCursor: value.nextCursor as string | null,
  };
}

function parsePlayback(value: unknown): TogetherPlayback | null {
  if (!isRecord(value)) return null;
  const rawPages = value.pages;
  if (
    typeof value.id !== "string" ||
    typeof value.pairId !== "string" ||
    (value.relationshipType !== "partner" && value.relationshipType !== "friend") ||
    typeof value.category !== "string" ||
    typeof value.exhausted !== "boolean" ||
    typeof value.completedNextTransitions !== "number" ||
    !isRecord(rawPages)
  ) {
    return null;
  }
  const question = value.question === null ? null : parseQuestion(value.question);
  const pages = Object.fromEntries(
    togetherQuestionBands.map((band) => [band, parseQuestionPage(rawPages[band])]),
  ) as Record<TogetherQuestionBand, TogetherQuestionPage | null>;
  if ((value.question !== null && !question) || togetherQuestionBands.some((band) => !pages[band]))
    return null;
  return { ...value, question, pages: pages as TogetherQuestionPools } as TogetherPlayback;
}

function parseTransition(value: unknown): Transition | null {
  if (!isRecord(value) || typeof value.completedNextTransitions !== "number") return null;
  if (value.kind === "EXHAUSTED")
    return { kind: "EXHAUSTED", completedNextTransitions: value.completedNextTransitions };
  if (
    value.kind === "QUESTION" &&
    typeof value.questionId === "string" &&
    typeof value.questionRevisionId === "string" &&
    typeof value.position === "number"
  ) {
    return {
      kind: "QUESTION",
      questionId: value.questionId,
      questionRevisionId: value.questionRevisionId,
      position: value.position,
      completedNextTransitions: value.completedNextTransitions,
    };
  }
  return null;
}

function TogetherAction({
  icon,
  label,
  disabled,
  selected = false,
  next = false,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  disabled: boolean;
  selected?: boolean;
  next?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      aria-pressed={selected || undefined}
      className="group text-closer-navy focus-visible:ring-closer-navy focus-visible:ring-offset-closer-cream grid justify-items-center gap-2 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-wait disabled:opacity-60"
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      <span
        className={cn(
          "shadow-closer-card grid size-[66px] place-items-center rounded-full bg-white transition-[transform,background-color,color] duration-150 group-hover:-translate-y-0.5 [&_svg]:size-7",
          selected && "bg-closer-coral-soft text-closer-coral",
          next && "bg-closer-coral text-white shadow-[0_10px_21px_rgba(255,98,110,0.22)]",
        )}
      >
        {icon}
      </span>
      <small className="text-[.79rem] font-extrabold">{label}</small>
    </button>
  );
}

export default function TogetherSessionScreen({
  initialSession,
}: {
  initialSession: TogetherPlayback;
}) {
  const router = useRouter();
  const [session, setSession] = useState(initialSession);
  const [pending, setPending] = useState<Action | null>(null);
  const [isWaitingForPage, setIsWaitingForPage] = useState(false);
  const [motion, setMotion] = useState<"next" | "skip" | null>(null);
  const [isEndSheetOpen, setIsEndSheetOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlightPrefetches = useRef(new Set<string>());
  const baseUrl = `/api/pairs/${encodeURIComponent(session.pairId)}/together/sessions/${encodeURIComponent(session.id)}`;

  const prefetchPage = useCallback(
    async (band: TogetherQuestionBand, cursor: string | null) => {
      if (!cursor) return false;
      const requestKey = `${band}:${cursor}`;
      if (inFlightPrefetches.current.has(requestKey)) return false;
      inFlightPrefetches.current.add(requestKey);
      try {
        const response = await fetch(
          `${baseUrl}/questions?band=${encodeURIComponent(band)}&cursor=${encodeURIComponent(cursor)}`,
          { cache: "no-store" },
        );
        const page = parseQuestionPage(await response.json());
        if (!response.ok || !page) throw new Error("Together question page failed to load.");
        setSession((current) => {
          const existing = current.pages[band];
          if (existing.nextCursor !== cursor) return current;
          const seenQuestionIds = new Set(existing.items.map((item) => item.questionId));
          return {
            ...current,
            pages: {
              ...current.pages,
              [band]: {
                items: [
                  ...existing.items,
                  ...page.items.filter((item) => !seenQuestionIds.has(item.questionId)),
                ],
                hasMore: page.hasMore,
                nextCursor: page.nextCursor,
              },
            },
          };
        });
        return true;
      } catch {
        return false;
      } finally {
        inFlightPrefetches.current.delete(requestKey);
      }
    },
    [baseUrl],
  );

  useEffect(() => {
    for (const band of togetherQuestionBands) {
      const page = session.pages[band];
      if (shouldPrefetchTogetherQuestionPage(page)) void prefetchPage(band, page.nextCursor);
    }
  }, [prefetchPage, session.pages]);

  const reconcile = useCallback(async () => {
    const response = await fetch(baseUrl, { cache: "no-store" });
    const next = parsePlayback(await response.json());
    if (!response.ok || !next) throw new Error("Together session reconciliation failed.");
    setSession(next);
  }, [baseUrl]);

  async function advance(action: "next" | "skip") {
    const currentQuestion = session.question;
    if (pending || isWaitingForPage || !currentQuestion) return;
    const completedNextTransitions = session.completedNextTransitions + (action === "next" ? 1 : 0);
    const choice = chooseBufferedTogetherQuestion(session.pages, completedNextTransitions);
    if (choice.kind === "loading") {
      setIsWaitingForPage(true);
      setError("Getting the next question ready.");
      const loaded = await prefetchPage(choice.band, session.pages[choice.band].nextCursor);
      if (!loaded) setError("We couldn’t load the next question. Please try again.");
      setIsWaitingForPage(false);
      return;
    }

    const previousSession = session;
    setError(null);
    setPending(action);
    setMotion(action);
    setSession((current) => {
      if (current.question?.questionId !== currentQuestion.questionId) return current;
      if (choice.kind === "exhausted") {
        return { ...current, exhausted: true, question: null, completedNextTransitions };
      }
      return {
        ...current,
        exhausted: false,
        completedNextTransitions,
        question: { ...choice.question, liked: false, position: currentQuestion.position + 1 },
        pages: {
          ...current.pages,
          [choice.band]: {
            ...current.pages[choice.band],
            items: current.pages[choice.band].items.slice(1),
          },
        },
      };
    });

    try {
      const response = await fetch(`${baseUrl}/advance`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action,
          currentQuestionId: currentQuestion.questionId,
          nextQuestionId: choice.kind === "question" ? choice.question.questionId : undefined,
          nextQuestionRevisionId:
            choice.kind === "question" ? choice.question.questionRevisionId : undefined,
          clientRequestId: crypto.randomUUID(),
        }),
      });
      const transition = parseTransition(await response.json());
      if (!response.ok || !transition) throw new Error("Together advance failed.");
      const matchesOptimisticQuestion =
        choice.kind === "question" &&
        transition.kind === "QUESTION" &&
        transition.questionId === choice.question.questionId &&
        transition.questionRevisionId === choice.question.questionRevisionId &&
        transition.position === currentQuestion.position + 1;
      const matchesOptimisticExhaustion =
        choice.kind === "exhausted" && transition.kind === "EXHAUSTED";
      if (!matchesOptimisticQuestion && !matchesOptimisticExhaustion) {
        await reconcile();
      } else {
        setSession((current) => ({
          ...current,
          completedNextTransitions: transition.completedNextTransitions,
        }));
      }
    } catch {
      setSession(previousSession);
      try {
        await reconcile();
      } catch {
        setError("We couldn’t confirm that change. Your last confirmed question is still showing.");
      }
    } finally {
      setPending(null);
      window.setTimeout(() => setMotion(null), 240);
    }
  }

  async function toggleLike() {
    const currentQuestion = session.question;
    if (pending || isWaitingForPage || !currentQuestion) return;
    setError(null);
    setPending("like");
    try {
      const response = await fetch(`${baseUrl}/like`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          liked: !currentQuestion.liked,
          currentQuestionId: currentQuestion.questionId,
        }),
      });
      if (!response.ok) throw new Error("Together like failed.");
      setSession((current) =>
        current.question?.questionId === currentQuestion.questionId
          ? { ...current, question: { ...current.question, liked: !currentQuestion.liked } }
          : current,
      );
    } catch {
      setError("We couldn’t save that like. Please try again.");
    } finally {
      setPending(null);
    }
  }

  async function endSession() {
    if (pending) return;
    setPending("end");
    try {
      const response = await fetch(`${baseUrl}/end`, { method: "POST" });
      if (!response.ok) throw new Error("Together end failed.");
      router.replace(togetherPickerPath(session.pairId, session.relationshipType) as never);
    } catch {
      setError("We couldn’t end the session right now. Please try again.");
      setPending(null);
    }
  }

  const controlsDisabled = pending !== null || isWaitingForPage;

  return (
    <CloserPageShell className="flex min-h-svh flex-col pb-[max(28px,env(safe-area-inset-bottom))]">
      <header className="flex min-h-[42px] items-center justify-between gap-3">
        <CloserBackLink
          href={togetherPickerPath(session.pairId, session.relationshipType)}
          label="Back to conversation topics"
        />
        <ModeBadge mode="together" />
        <span aria-hidden="true" className="w-[38px]" />
      </header>

      {session.exhausted ? (
        <section
          aria-live="polite"
          className="flex min-h-[calc(100svh-120px)] flex-col items-center justify-center px-2 pb-12 text-center"
        >
          <span
            aria-hidden="true"
            className="bg-closer-peach text-closer-navy mb-6 grid size-[58px] place-items-center rounded-[1.25rem] text-[1.8rem]"
          >
            ✦
          </span>
          <h1 className="max-w-[13ch] text-[2.2rem] leading-tight font-extrabold tracking-[-.05em]">
            You’ve reached the end for now.
          </h1>
          <p className="text-closer-muted mt-3 mb-6">That was a good little corner of the deck.</p>
          <Button
            disabled={controlsDisabled}
            onClick={() => setIsEndSheetOpen(true)}
            size="lg"
            type="button"
          >
            End session
          </Button>
        </section>
      ) : (
        <>
          <section
            className={cn(
              "flex min-h-[min(52svh,470px)] flex-1 flex-col items-center justify-center py-9 text-center",
              motion === "next" &&
                "animate-[closer-together-next_240ms_cubic-bezier(.2,.8,.3,1)_both]",
              motion === "skip" && "animate-[closer-together-skip_170ms_ease-out_both]",
            )}
            key={session.question?.questionId}
          >
            <CategoryBadge category={session.category as CloserCategory} />
            <h1 className="mx-auto mt-7 max-w-[15ch] text-[clamp(2rem,9vw,2.8rem)] leading-tight font-extrabold tracking-[-.055em] text-balance">
              {session.question?.text}
            </h1>
          </section>
          <section
            aria-label="Question actions"
            className="mx-auto grid w-full max-w-[330px] grid-cols-3 gap-2.5"
          >
            <TogetherAction
              disabled={controlsDisabled}
              icon={
                <Heart
                  aria-hidden="true"
                  fill={session.question?.liked ? "currentColor" : "none"}
                />
              }
              label="Like"
              onClick={() => void toggleLike()}
              selected={session.question?.liked ?? false}
            />
            <TogetherAction
              disabled={controlsDisabled}
              icon={<X aria-hidden="true" />}
              label="Skip"
              onClick={() => void advance("skip")}
            />
            <TogetherAction
              disabled={controlsDisabled}
              icon={<ArrowRight aria-hidden="true" />}
              label="Next"
              next
              onClick={() => void advance("next")}
            />
          </section>
          <div className="border-closer-navy/10 mt-6 flex justify-center border-t pt-4">
            <Button
              className="text-closer-muted decoration-closer-muted/50 px-3 underline underline-offset-4"
              disabled={controlsDisabled}
              onClick={() => setIsEndSheetOpen(true)}
              size="sm"
              type="button"
              variant="ghost"
            >
              End session
            </Button>
          </div>
        </>
      )}

      {error ? <ActionError>{error}</ActionError> : null}
      <Drawer open={isEndSheetOpen} onOpenChange={setIsEndSheetOpen}>
        <DrawerContent className="bg-closer-cream text-closer-navy rounded-[1.75rem_1.75rem_1.125rem_1.125rem] pb-[max(20px,env(safe-area-inset-bottom))] shadow-[0_-12px_40px_rgba(16,37,101,0.16)]">
          <DrawerHeader className="items-center gap-0 text-center">
            <span
              aria-hidden="true"
              className="bg-muted-foreground/30 mb-5 block h-[5px] w-10 rounded-full"
            />
            <DrawerTitle className="text-[1.35rem] font-extrabold tracking-[-.035em]">
              End this session?
            </DrawerTitle>
          </DrawerHeader>
          <DrawerFooter className="mt-3">
            <Button
              disabled={controlsDisabled}
              onClick={() => void endSession()}
              size="lg"
              type="button"
            >
              End session
            </Button>
            <Button
              disabled={controlsDisabled}
              onClick={() => setIsEndSheetOpen(false)}
              size="lg"
              type="button"
              variant="secondary"
            >
              Keep talking
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </CloserPageShell>
  );
}
