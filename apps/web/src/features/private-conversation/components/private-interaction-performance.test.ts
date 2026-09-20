import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const componentsDirectory = import.meta.dir;

async function source(file: string) {
  return Bun.file(join(componentsDirectory, file)).text();
}

describe("Private interaction performance boundaries", () => {
  test("keeps Shared Open selection optimistic only with the already-authorized candidate", async () => {
    const screen = await source("private-conversation-screen.tsx");

    expect(screen).toContain("question: { id: string; questionRevisionId: string; text: string }");
    expect(screen).toContain("setOptimisticAskQuestion(candidate.question)");
    expect(screen).toContain("Your answer");
    expect(screen).toContain("setOptimisticAskQuestion(null)");
    expect(screen).not.toContain("selectPrivateQuestionCandidate");
  });

  test("uses one explicit Shared Open selection request and never refreshes the whole route", async () => {
    const screen = await source("private-conversation-screen.tsx");

    expect(screen).toContain("fetch(`${candidateBaseUrl}/select`");
    expect(screen).toContain(
      "router.push(`/pair/${view.pairId}/private/round/${result.roundId}` as never)",
    );
    expect(screen).toContain("await reconcileConversation()");
    expect(screen).not.toContain("router.refresh()");
  });

  test("does not retain obsolete Like or Skip client protocol", async () => {
    const screen = await source("private-conversation-screen.tsx");

    expect(screen).not.toContain("likeQuestion");
    expect(screen).not.toContain("skipQuestion");
    expect(screen).not.toContain("/like");
    expect(screen).not.toContain("/skip");
  });

  test("uses only safe local Private states while answer and Pass persist", async () => {
    const screen = await source("private-round-screen.tsx");

    expect(screen).toContain('setRound({ ...round, state: "WAITING", yourAnswer: values.body })');
    expect(screen).toContain('setRound({ ...round, state: "RETIRED" })');
    expect(screen).toContain("await reconcileRound(previousRound)");
    expect(screen).not.toContain("router.refresh()");
  });

  test("continues a completed Round in its existing category lane instead of reopening the picker", async () => {
    const screen = await source("private-round-screen.tsx");
    const continuation = await source("../hooks/use-continue-private-conversation.ts");

    expect(screen).toContain("useContinuePrivateConversation");
    expect(screen).toContain("round.canContinue");
    expect(screen).toContain("Something else");
    expect(screen).toContain("Leave it here");
    expect(continuation).toContain(
      "`/api/pairs/${encodeURIComponent(pairId)}/private-conversations`",
    );
    expect(continuation).toContain(
      "body: JSON.stringify({ category, clientRequestId: crypto.randomUUID() })",
    );
    expect(continuation).toContain(
      "router.push(`/pair/${pairId}/private/conversation/${conversationId}` as never)",
    );
    expect(continuation).not.toContain("router.refresh()");
  });

  test("uses the authorized Reveal response and query recovery without fabricating answers", async () => {
    const screen = await source("private-round-screen.tsx");
    const revealRoute = await source(
      "../../../app/api/pairs/[pairId]/private-rounds/[roundId]/reveal/route.ts",
    );
    const roundRoute = await source(
      "../../../app/api/pairs/[pairId]/private-rounds/[roundId]/route.ts",
    );

    expect(screen).toContain('fetch(`${baseUrl}/reveal`, { method: "POST" })');
    expect(screen).toContain("!next || !next.answers");
    expect(screen).toContain(
      "queryKey: closerKeys.privateRound(initialRound.pairId, initialRound.id)",
    );
    expect(screen).toContain("refetchInterval: 30_000");
    expect(revealRoute).toContain("markPrivateRevealViewed");
    expect(roundRoute).toContain("hideUnviewedReveal");
  });

  test("reconciles reactions and replies from their own authorized mutation responses", async () => {
    const screen = await source("private-round-screen.tsx");

    expect(screen).toContain("setOptimisticReaction(nextReaction)");
    expect(screen).toContain("setOptimisticReaction(undefined)");
    expect(screen).toContain("pending={isRemovingReply}");
    expect(screen).toContain("setRound(next)");
  });
});
