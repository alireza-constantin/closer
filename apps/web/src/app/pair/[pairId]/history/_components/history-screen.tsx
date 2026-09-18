import type { ComponentProps } from "react";

import type { getFormerEraHistoryForParticipant } from "@Closer/auth/closer";

import { CategoryBadge, type CloserCategory } from "@/components/closer/category";
import { CloserBackLink } from "@/components/closer/navigation";
import { CloserPageShell, CloserTopbar } from "@/components/closer/page-shell";

type HistoryView = Awaited<ReturnType<typeof getFormerEraHistoryForParticipant>>;

function HistoryCard({ children, ...props }: ComponentProps<"article">) {
  return (
    <article className="shadow-closer-soft rounded-[1.4rem] bg-white/70 p-5" {...props}>
      {children}
    </article>
  );
}

function sessionDate(value: string) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(
    new Date(value),
  );
}

function TogetherSessionHistory({
  session,
}: {
  session:
    | HistoryView["eras"][number]["togetherSessions"][number]
    | HistoryView["preClaimTogetherSessions"][number];
}) {
  return (
    <HistoryCard>
      <div className="flex items-center justify-between gap-3">
        <CategoryBadge category={session.category as CloserCategory} />
        <span className="text-closer-muted text-xs font-bold">Together</span>
      </div>
      <p className="text-closer-muted mt-4 text-sm font-semibold">
        Started <time dateTime={session.startedAt}>{sessionDate(session.startedAt)}</time>
        {" · "}
        {session.endedAt ? (
          <>
            <span>Ended </span>
            <time dateTime={session.endedAt}>{sessionDate(session.endedAt)}</time>
          </>
        ) : (
          "Ended with this earlier moment"
        )}
      </p>
      <ol className="mt-4 grid gap-3" aria-label="Questions from this Together moment">
        {session.questions.map((question) => (
          <li className="bg-closer-cream/75 rounded-[1rem] px-4 py-3" key={question.id}>
            <p className="leading-snug font-bold">{question.text}</p>
            <p className="text-closer-muted mt-1.5 text-xs font-semibold">
              {question.liked ? "Liked" : null}
              {question.liked && (question.skipped || question.advanced) ? " · " : null}
              {question.skipped ? "Skipped" : question.advanced ? "Next" : "Last question"}
            </p>
          </li>
        ))}
      </ol>
    </HistoryCard>
  );
}

function PrivateConversationHistory({
  conversation,
}: {
  conversation: HistoryView["eras"][number]["privateConversations"][number];
}) {
  return (
    <HistoryCard>
      <CategoryBadge category={conversation.category as CloserCategory} />
      <ol className="mt-4 grid gap-5" aria-label={`${conversation.category} private questions`}>
        {conversation.rounds.map((round) => (
          <li
            className="border-closer-navy/10 border-t pt-4 first:border-t-0 first:pt-0"
            key={round.id}
          >
            <p className="text-closer-muted text-xs font-extrabold tracking-[.13em] uppercase">
              Question {round.questionNumber}
            </p>
            <p className="mt-2 leading-snug font-extrabold">{round.question.text}</p>
            {round.status === "passed" ? (
              <p className="text-closer-muted mt-3 text-sm font-bold">Question passed</p>
            ) : null}
            {round.answers.length > 0 ? (
              <div className="mt-4 grid gap-2.5">
                {round.answers.map((answer) => (
                  <div
                    className="bg-closer-peach/45 rounded-[1rem] px-4 py-3"
                    key={answer.participantId}
                  >
                    <p className="text-closer-muted text-xs font-extrabold">{answer.displayName}</p>
                    <p className="mt-1.5 leading-relaxed">{answer.body}</p>
                  </div>
                ))}
              </div>
            ) : null}
            {round.reactions.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2" aria-label="Saved reactions">
                {round.reactions.map((reaction) => (
                  <span
                    className="bg-closer-lavender-soft rounded-full px-3 py-1 text-xs font-bold"
                    key={reaction.participantId}
                  >
                    {reaction.displayName}: {reaction.value}
                  </span>
                ))}
              </div>
            ) : null}
            {round.replies.length > 0 ? (
              <div className="mt-3 grid gap-2" aria-label="Saved replies">
                {round.replies.map((reply) => (
                  <p
                    className="text-closer-muted text-sm leading-relaxed"
                    key={reply.participantId}
                  >
                    <span className="text-closer-navy font-extrabold">{reply.displayName}:</span>{" "}
                    {reply.body}
                  </p>
                ))}
              </div>
            ) : null}
          </li>
        ))}
      </ol>
    </HistoryCard>
  );
}

export function HistoryScreen({ history, pairId }: { history: HistoryView; pairId: string }) {
  const hasHistory =
    history.eras.some(
      (era) =>
        era.privateConversations.some((conversation) => conversation.rounds.length > 0) ||
        era.togetherSessions.length > 0,
    ) || history.preClaimTogetherSessions.length > 0;
  return (
    <CloserPageShell>
      <CloserTopbar
        action={
          history.formerPair.terminatedAt ? undefined : (
            <CloserBackLink href={`/pair/${pairId}`} label="Back to space" />
          )
        }
        href={history.formerPair.terminatedAt ? "/" : `/pair/${pairId}`}
      />
      <section className="pt-8 pb-7">
        <p className="text-closer-coral text-sm font-extrabold tracking-[.16em] uppercase">
          {history.formerPair.terminatedAt ? "Former space" : "Look back"}
        </p>
        <h1 className="mt-3 max-w-[12ch] text-[2.35rem] leading-tight font-extrabold tracking-[-.055em] text-balance">
          Shared moments, saved here.
        </h1>
        <p className="text-closer-muted mt-3 max-w-[34ch] leading-relaxed">
          These earlier conversations are here to revisit, just as they were.
        </p>
        {history.formerPair.terminatedAt ? (
          <p className="text-closer-muted mt-3 max-w-[34ch] text-sm leading-relaxed">
            This space is read-only.
            {history.formerPair.intendedPersonName
              ? ` It was created for ${history.formerPair.intendedPersonName}.`
              : ""}
          </p>
        ) : null}
      </section>
      {!hasHistory ? (
        <p className="text-closer-muted shadow-closer-soft rounded-[1.4rem] bg-white/65 px-5 py-6 leading-relaxed">
          There are no earlier moments to look back on yet.
        </p>
      ) : null}
      {history.preClaimTogetherSessions.length > 0 ? (
        <section className="grid gap-3" aria-labelledby="early-together-heading">
          <h2 className="text-[1.1rem] font-extrabold" id="early-together-heading">
            Earlier Together moments
          </h2>
          {history.preClaimTogetherSessions.map((session) => (
            <TogetherSessionHistory key={session.id} session={session} />
          ))}
        </section>
      ) : null}
      {history.eras.map((era, index) => (
        <section
          className="mt-8 grid gap-3"
          key={`earlier-moments-${index}`}
          aria-labelledby={`earlier-moments-${index}`}
        >
          <h2 className="text-[1.1rem] font-extrabold" id={`earlier-moments-${index}`}>
            {index === 0 ? "Earlier moments" : "A little further back"}
          </h2>
          {era.privateConversations
            .filter((conversation) => conversation.rounds.length > 0)
            .map((conversation) => (
              <PrivateConversationHistory conversation={conversation} key={conversation.id} />
            ))}
          {era.togetherSessions.map((session) => (
            <TogetherSessionHistory key={session.id} session={session} />
          ))}
        </section>
      ))}
    </CloserPageShell>
  );
}
