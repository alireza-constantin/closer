import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const componentsDirectory = import.meta.dir;

async function source(file: string) {
  return Bun.file(join(componentsDirectory, file)).text();
}

describe("Private interaction performance boundaries", () => {
  test("keeps Ask optimistic only with the already-authorized candidate occurrence", async () => {
    const screen = await source("private-conversation-screen.tsx");

    expect(screen).toContain("question: { id: string; questionRevisionId: string; text: string }");
    expect(screen).toContain("setOptimisticAskQuestion(candidate.question)");
    expect(screen).toContain("Your answer");
    expect(screen).toContain("setOptimisticAskQuestion(null)");
    expect(screen).not.toContain("selectPrivateQuestionCandidate");
  });

  test("renders the persisted Skip response directly and never refreshes the whole route", async () => {
    const screen = await source("private-conversation-screen.tsx");

    expect(screen).toContain("const next = parseConversation(await response.json())");
    expect(screen).toContain("setConversation(next)");
    expect(screen).toContain("await reconcileConversation()");
    expect(screen).not.toContain("router.refresh()");
  });

  test("makes Like immediate while guarding it against a newer candidate", async () => {
    const screen = await source("private-conversation-screen.tsx");

    expect(screen).toContain("const candidateId = conversation.candidate?.id");
    expect(screen).toContain("setLiked(nextLiked)");
    expect(screen).toContain("currentCandidateIdRef.current === candidateId");
  });

  test("uses only safe local Private states while answer and Pass persist", async () => {
    const screen = await source("private-round-screen.tsx");

    expect(screen).toContain('setRound({ ...round, state: "WAITING", yourAnswer: values.body })');
    expect(screen).toContain('setRound({ ...round, state: "DECLINED" })');
    expect(screen).toContain("await reconcileRound(previousRound)");
    expect(screen).not.toContain("router.refresh()");
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
