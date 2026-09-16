"use client";

import { ArrowRight, Heart, X } from "lucide-react";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useState } from "react";

import { Button } from "@Closer/ui/components/button";
import { Drawer, DrawerContent, DrawerFooter, DrawerHeader, DrawerTitle } from "@Closer/ui/components/drawer";
import { cn } from "@Closer/ui/lib/utils";

import { ActionError } from "@/components/closer/feedback";
import { CategoryBadge, type CloserCategory } from "@/components/closer/category";
import { CloserBackLink } from "@/components/closer/navigation";
import { CloserPageShell } from "@/components/closer/page-shell";
import { ModeBadge } from "@/components/closer/mode-badge";

type TogetherView = {
  id: string;
  pairId: string;
  category: string;
  startedAt: string;
  endedAt: string | null;
  exhausted: boolean;
  question: { id: string; questionRevisionId: string; text: string; category: string; intensity: string; position: number; liked: boolean } | null;
};
type Action = "like" | "skip" | "next" | "end";

function parseView(value: unknown): TogetherView | null {
  if (!value || typeof value !== "object" || !("id" in value) || typeof value.id !== "string" || !("pairId" in value) || typeof value.pairId !== "string" || !("category" in value) || typeof value.category !== "string" || !("exhausted" in value) || typeof value.exhausted !== "boolean") return null;
  const question = "question" in value ? value.question : null;
  if (question !== null && (!question || typeof question !== "object" || !("id" in question) || typeof question.id !== "string" || !("text" in question) || typeof question.text !== "string" || !("liked" in question) || typeof question.liked !== "boolean")) return null;
  return value as TogetherView;
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
    <button aria-pressed={selected || undefined} className="group grid justify-items-center gap-2 text-closer-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-closer-navy focus-visible:ring-offset-2 focus-visible:ring-offset-closer-cream disabled:cursor-wait disabled:opacity-60" disabled={disabled} onClick={onClick} type="button">
      <span className={cn("grid size-[66px] place-items-center rounded-full bg-white shadow-closer-card transition-[transform,background-color,color] duration-150 group-hover:-translate-y-0.5 [&_svg]:size-7", selected && "bg-closer-coral-soft text-closer-coral", next && "bg-closer-coral text-white shadow-[0_10px_21px_rgba(255,98,110,0.22)]")}>{icon}</span>
      <small className="text-[.79rem] font-extrabold">{label}</small>
    </button>
  );
}

export default function TogetherSessionScreen({ initialSession }: { initialSession: TogetherView }) {
  const router = useRouter();
  const [session, setSession] = useState(initialSession);
  const [pending, setPending] = useState<Action | null>(null);
  const [motion, setMotion] = useState<"next" | "skip" | null>(null);
  const [isEndSheetOpen, setIsEndSheetOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const baseUrl = `/api/pairs/${encodeURIComponent(session.pairId)}/together/sessions/${encodeURIComponent(session.id)}`;

  async function advance(action: "next" | "skip") {
    if (pending || !session.question) return;
    setError(null);
    setPending(action);
    setMotion(action);
    try {
      const response = await fetch(`${baseUrl}/advance`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, currentQuestionId: session.question.id, clientRequestId: crypto.randomUUID() }) });
      const next = parseView(await response.json());
      if (!response.ok || !next) throw new Error();
      setSession(next);
    } catch {
      setError("That question is still here. Please try again.");
    } finally {
      setPending(null);
      window.setTimeout(() => setMotion(null), 240);
    }
  }

  async function toggleLike() {
    if (pending || !session.question) return;
    setError(null);
    setPending("like");
    try {
      const response = await fetch(`${baseUrl}/like`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ liked: !session.question.liked, currentQuestionId: session.question.id }) });
      const next = parseView(await response.json());
      if (!response.ok || !next) throw new Error();
      setSession(next);
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
      if (!response.ok) throw new Error();
      router.replace(`/pair/${session.pairId}` as never);
    } catch {
      setError("We couldn’t end the session right now. Please try again.");
      setPending(null);
    }
  }

  return (
    <CloserPageShell className="flex min-h-svh flex-col pb-[max(28px,env(safe-area-inset-bottom))]">
      <header className="flex min-h-[42px] items-center justify-between gap-3">
        <CloserBackLink href={`/pair/${session.pairId}`} label="Back to pair home" />
        <ModeBadge mode="together" />
        <span aria-hidden="true" className="w-[38px]" />
      </header>

      {session.exhausted ? (
        <section aria-live="polite" className="flex min-h-[calc(100svh-120px)] flex-col items-center justify-center px-2 pb-12 text-center">
          <span aria-hidden="true" className="mb-6 grid size-[58px] place-items-center rounded-[1.25rem] bg-closer-peach text-[1.8rem] text-closer-navy">✦</span>
          <h1 className="max-w-[13ch] text-[2.2rem] font-extrabold leading-tight tracking-[-.05em]">You’ve reached the end for now.</h1>
          <p className="mt-3 mb-6 text-closer-muted">That was a good little corner of the deck.</p>
          <Button disabled={pending !== null} onClick={() => setIsEndSheetOpen(true)} size="lg" type="button">End session</Button>
        </section>
      ) : (
        <>
          <section className={cn("flex min-h-[min(52svh,470px)] flex-1 flex-col items-center justify-center py-9 text-center", motion === "next" && "animate-[closer-together-next_240ms_cubic-bezier(.2,.8,.3,1)_both]", motion === "skip" && "animate-[closer-together-skip_170ms_ease-out_both]")} key={session.question?.id}>
            <CategoryBadge category={session.category as CloserCategory} />
            <h1 className="mx-auto mt-7 max-w-[15ch] text-balance text-[clamp(2rem,9vw,2.8rem)] font-extrabold leading-tight tracking-[-.055em]">{session.question?.text}</h1>
          </section>
          <section aria-label="Question actions" className="mx-auto grid w-full max-w-[330px] grid-cols-3 gap-2.5">
            <TogetherAction disabled={pending !== null} icon={<Heart aria-hidden="true" fill={session.question?.liked ? "currentColor" : "none"} />} label="Like" onClick={() => void toggleLike()} selected={session.question?.liked ?? false} />
            <TogetherAction disabled={pending !== null} icon={<X aria-hidden="true" />} label="Skip" onClick={() => void advance("skip")} />
            <TogetherAction disabled={pending !== null} icon={<ArrowRight aria-hidden="true" />} label="Next" next onClick={() => void advance("next")} />
          </section>
          <div className="mt-6 flex justify-center border-t border-closer-navy/10 pt-4">
            <Button className="px-3 text-closer-muted underline decoration-closer-muted/50 underline-offset-4" disabled={pending !== null} onClick={() => setIsEndSheetOpen(true)} size="sm" type="button" variant="ghost">End session</Button>
          </div>
        </>
      )}

      {error ? <ActionError>{error}</ActionError> : null}
      <Drawer open={isEndSheetOpen} onOpenChange={setIsEndSheetOpen}>
        <DrawerContent className="rounded-[1.75rem_1.75rem_1.125rem_1.125rem] bg-closer-cream pb-[max(20px,env(safe-area-inset-bottom))] text-closer-navy shadow-[0_-12px_40px_rgba(16,37,101,0.16)]">
          <DrawerHeader className="items-center gap-0 text-center">
            <span aria-hidden="true" className="mb-5 block h-[5px] w-10 rounded-full bg-muted-foreground/30" />
            <DrawerTitle className="text-[1.35rem] font-extrabold tracking-[-.035em]">End this session?</DrawerTitle>
          </DrawerHeader>
          <DrawerFooter className="mt-3">
            <Button disabled={pending !== null} onClick={() => void endSession()} size="lg" type="button">End session</Button>
            <Button disabled={pending !== null} onClick={() => setIsEndSheetOpen(false)} size="lg" type="button" variant="secondary">Keep talking</Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </CloserPageShell>
  );
}
