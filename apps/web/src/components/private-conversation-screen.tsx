"use client";

import { useRouter } from "next/navigation";

import { CloserBackButton } from "@/components/closer/navigation";
import { CloserPageShell } from "@/components/closer/page-shell";
import { ModeBadge } from "@/components/closer/mode-badge";

type ConversationProjection = {
  pairId: string;
  category: string;
  creator: { displayName: string };
  role: "creator" | "non-creator";
  state: "CANDIDATE" | "WAITING_FOR_CREATOR" | "EXHAUSTED";
  message?: string;
  candidate?: { question: { text: string } };
};

export default function PrivateConversationScreen({ view }: { view: ConversationProjection }) {
  const router = useRouter();
  const question = view.candidate?.question.text;
  return (
    <CloserPageShell className="pt-5">
      <CloserBackButton onClick={() => router.push(`/pair/${view.pairId}` as never)} />
      <section className="pt-10">
        <ModeBadge mode="private" />
        <p className="mt-6 text-sm font-extrabold uppercase tracking-[.16em] text-closer-muted">{view.category}</p>
        {view.state === "CANDIDATE" && question ? (
          <>
            <h1 className="mt-4 max-w-[18ch] text-balance text-[2.25rem] font-extrabold leading-tight tracking-[-.048em]">{question}</h1>
            <p className="mt-4 max-w-[32ch] leading-relaxed text-closer-muted">This question is waiting for you to choose what happens next.</p>
          </>
        ) : view.state === "EXHAUSTED" ? (
          <h1 className="mt-4 max-w-[18ch] text-balance text-[2.25rem] font-extrabold leading-tight tracking-[-.048em]">You&apos;ve reached the end for now.</h1>
        ) : (
          <h1 className="mt-4 max-w-[18ch] text-balance text-[2.25rem] font-extrabold leading-tight tracking-[-.048em]">{view.message ?? `Waiting for ${view.creator.displayName} to choose a question.`}</h1>
        )}
      </section>
    </CloserPageShell>
  );
}
