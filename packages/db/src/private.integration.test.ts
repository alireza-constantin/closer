import { randomUUID } from "node:crypto";

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import dotenv from "dotenv";
import { and, eq, inArray, isNull } from "drizzle-orm";

dotenv.config({ path: new URL("../../../apps/web/.env", import.meta.url) });

const { createDb } = await import("./index");
const {
  CloserDomainError,
  askPrivateQuestionCandidate,
  declinePrivateRound,
  createQuestion,
  createPairForParticipant,
  getPrivateRoundForParticipant,
  getPrivateRoundStatusForParticipant,
  getPrivateConversationForParticipant,
  issueOrReuseInitialInvite,
  issueRejoinInvite,
  listActivePrivateConversations,
  listEligiblePrivateQuestions,
  markPrivateRevealViewed,
  privateIntensityFallback,
  redeemInitialInvite,
  redeemRejoinInvite,
  removePrivateReaction,
  removePrivateReply,
  resolveOrCreateParticipant,
  setPrivateReaction,
  setPrivateQuestionCandidateLike,
  setPrivateReply,
  skipPrivateQuestionCandidate,
  submitPrivateAnswer,
  startOrResumePrivateConversation,
  reviseQuestion,
  withdrawQuestionRevision,
} = await import("./closer");
const {
  initialInvite,
  pair,
  pairMembership,
  pairMembershipEra,
  participant,
  privateAnswer,
  privateConversation,
  privateQuestionCandidate,
  privateRevealView,
  privateRound,
  question,
  questionRevision,
} = await import("./schema/closer");
const { user } = await import("./schema/auth");

const db = createDb();
const authUserIds: string[] = [];
const pairIds: string[] = [];
const testQuestionIds: string[] = [];
const questionIds = {
  fun: "00000000-0000-4000-8000-000000000101",
  deep: "00000000-0000-4000-8000-000000000201",
  relationship: "00000000-0000-4000-8000-000000000401",
  friendship: "00000000-0000-4000-8000-000000000501",
} as const;

async function createAuthUser(name = "Test participant") {
  const id = randomUUID();
  authUserIds.push(id);
  await db
    .insert(user)
    .values({ id, name, email: `${id}@private.closer.invalid`, isAnonymous: true });
  return id;
}

async function createParticipant(name: string) {
  return resolveOrCreateParticipant(db, {
    authUserId: await createAuthUser(name),
    displayName: name,
  });
}

async function issueFreshInitialInvite(participantId: string, pairId: string) {
  const invite = await issueOrReuseInitialInvite(db, { participantId, pairId });
  if (invite.state !== "issued") throw new Error("Fresh pair unexpectedly had an invitation.");
  return invite.token;
}

async function createJoinedPair(relationshipType: "partner" | "friend" = "partner") {
  const first = await createParticipant("Ali");
  const created = await createPairForParticipant(db, {
    participantId: first.id,
    intendedPersonName: "Fafa",
    relationshipType,
  });
  pairIds.push(created.pair.id);
  const second = await createParticipant("Fafa");
  const token = await issueFreshInitialInvite(first.id, created.pair.id);
  await redeemInitialInvite(db, { token, participantId: second.id });
  return { pairId: created.pair.id, first, second };
}

async function capture(promise: Promise<unknown>) {
  return promise.then(
    () => null,
    (error: unknown) => error,
  );
}

async function createRound(
  pairId: string,
  participantId: string,
  questionId = questionIds.deep,
  clientRequestId = randomUUID(),
) {
  const categoryByQuestion = {
    [questionIds.fun]: "fun",
    [questionIds.deep]: "deep",
    [questionIds.relationship]: "relationship",
    [questionIds.friendship]: "friendship",
  } as const;
  const era = (
    await db
      .select({ id: pairMembershipEra.id })
      .from(pairMembershipEra)
      .where(and(eq(pairMembershipEra.pairId, pairId), isNull(pairMembershipEra.endedAt)))
      .limit(1)
  )[0];
  if (!era) throw new Error("Legacy round fixture did not find an active era.");
  const existing = (
    await db
      .select()
      .from(privateConversation)
      .where(
        and(
          eq(privateConversation.pairId, pairId),
          eq(privateConversation.membershipEraId, era.id),
          eq(privateConversation.category, categoryByQuestion[questionId]),
        ),
      )
      .limit(1)
  )[0];
  const conversation =
    existing ??
    (
      await db
        .insert(privateConversation)
        .values({
          pairId,
          membershipEraId: era.id,
          category: categoryByQuestion[questionId],
          createdByParticipantId: participantId,
        })
        .returning()
    )[0];
  if (!conversation) throw new Error("Legacy round fixture did not create a conversation.");
  const selected = (
    await db
      .select({ id: question.id, questionRevisionId: questionRevision.id })
      .from(question)
      .innerJoin(questionRevision, eq(question.currentRevisionId, questionRevision.id))
      .where(eq(question.id, questionId))
      .limit(1)
  )[0];
  if (!selected) throw new Error("Legacy round fixture did not find a question.");
  const inserted = await db
    .insert(privateRound)
    .values({
      pairId,
      conversationId: conversation.id,
      questionId: selected.id,
      questionRevisionId: selected.questionRevisionId,
      questionNumber: 1,
      initiatorParticipantId: participantId,
    })
    .returning({ id: privateRound.id });
  if (!inserted[0]) throw new Error("Legacy round fixture did not create a round.");
  return { id: inserted[0].id, conversationId: conversation.id };
}

async function createPrivateTestQuestion(intensity: "light" | "medium" | "deep") {
  const created = await createQuestion(db, {
    text: `Ticket 09 ${intensity} candidate ${randomUUID()}`,
    category: "deep",
    relationshipFit: "both",
    modeFit: "private",
    intensity,
  });
  testQuestionIds.push(created.question.id);
  return created;
}

async function makeReady(
  pairId: string,
  firstId: string,
  secondId: string,
  questionId = questionIds.deep,
) {
  const round = await createRound(pairId, firstId, questionId);
  await submitPrivateAnswer(db, {
    pairId,
    participantId: firstId,
    roundId: round.id,
    body: "First private answer",
  });
  await submitPrivateAnswer(db, {
    pairId,
    participantId: secondId,
    roundId: round.id,
    body: "Second private answer",
  });
  return round;
}

afterEach(async () => {
  if (pairIds.length) {
    await db.delete(initialInvite).where(inArray(initialInvite.pairId, pairIds));
    await db.delete(privateConversation).where(inArray(privateConversation.pairId, pairIds));
    await db.delete(pairMembershipEra).where(inArray(pairMembershipEra.pairId, pairIds));
    await db.delete(pairMembership).where(inArray(pairMembership.pairId, pairIds));
    await db.delete(pair).where(inArray(pair.id, pairIds));
  }
  if (authUserIds.length) {
    await db.delete(participant).where(inArray(participant.authUserId, authUserIds));
    await db.delete(user).where(inArray(user.id, authUserIds));
  }
  if (testQuestionIds.length) {
    await db
      .update(question)
      .set({ currentRevisionId: null })
      .where(inArray(question.id, testQuestionIds));
    await db.delete(questionRevision).where(inArray(questionRevision.questionId, testQuestionIds));
    await db.delete(question).where(inArray(question.id, testQuestionIds));
  }
  pairIds.length = 0;
  authUserIds.length = 0;
  testQuestionIds.length = 0;
});

afterAll(async () => {
  await db.$client.end();
});

describe("Closer Slice 01B Private rounds", () => {
  test("Private requires both participant slots before a conversation can start", async () => {
    const first = await createParticipant("Solo participant");
    const created = await createPairForParticipant(db, {
      participantId: first.id,
      intendedPersonName: "Fafa",
      relationshipType: "partner",
    });
    pairIds.push(created.pair.id);

    expect(
      await capture(
        startOrResumePrivateConversation(db, {
          pairId: created.pair.id,
          participantId: first.id,
          category: "deep",
          clientRequestId: randomUUID(),
        }),
      ),
    ).toMatchObject({ code: "PAIR_NOT_READY" });
  });

  test("partner and friend pairs receive only their valid Private categories", async () => {
    const partner = await createJoinedPair("partner");
    const friend = await createJoinedPair("friend");
    expect(
      (
        await listEligiblePrivateQuestions(db, {
          participantId: partner.first.id,
          pairId: partner.pairId,
          category: "relationship",
        })
      ).length,
    ).toBeGreaterThan(0);
    expect(
      (
        await listEligiblePrivateQuestions(db, {
          participantId: friend.first.id,
          pairId: friend.pairId,
          category: "friendship",
        })
      ).length,
    ).toBeGreaterThan(0);
    expect(
      await capture(
        listEligiblePrivateQuestions(db, {
          participantId: partner.first.id,
          pairId: partner.pairId,
          category: "friendship",
        }),
      ),
    ).toMatchObject({ code: "QUESTION_UNAVAILABLE" });
    expect(
      await capture(
        listEligiblePrivateQuestions(db, {
          participantId: friend.first.id,
          pairId: friend.pairId,
          category: "relationship",
        }),
      ),
    ).toMatchObject({ code: "QUESTION_UNAVAILABLE" });
  });

  test("Private conversations and relationship categories stay isolated across a participant's spaces", async () => {
    const first = await createParticipant("Ali");
    const partnerSpace = await createPairForParticipant(db, {
      participantId: first.id,
      intendedPersonName: "Fafa",
      relationshipType: "partner",
    });
    pairIds.push(partnerSpace.pair.id);
    const partner = await createParticipant("Fafa");
    const partnerToken = await issueFreshInitialInvite(first.id, partnerSpace.pair.id);
    await redeemInitialInvite(db, { token: partnerToken, participantId: partner.id });

    const friendSpace = await createPairForParticipant(db, {
      participantId: first.id,
      intendedPersonName: "Nima",
      relationshipType: "friend",
    });
    pairIds.push(friendSpace.pair.id);
    const friend = await createParticipant("Nima");
    const friendToken = await issueFreshInitialInvite(first.id, friendSpace.pair.id);
    await redeemInitialInvite(db, { token: friendToken, participantId: friend.id });

    const partnerRound = await createRound(
      partnerSpace.pair.id,
      first.id,
      questionIds.relationship,
    );
    expect(
      await listActivePrivateConversations(db, {
        pairId: friendSpace.pair.id,
        participantId: first.id,
      }),
    ).toEqual([]);
    expect(
      await listEligiblePrivateQuestions(db, {
        pairId: partnerSpace.pair.id,
        participantId: first.id,
        category: "relationship",
      }),
    ).not.toEqual([]);
    expect(
      await listEligiblePrivateQuestions(db, {
        pairId: friendSpace.pair.id,
        participantId: first.id,
        category: "friendship",
      }),
    ).not.toEqual([]);
    expect(
      await capture(
        getPrivateRoundForParticipant(db, {
          pairId: friendSpace.pair.id,
          participantId: first.id,
          roundId: partnerRound.id,
        }),
      ),
    ).toMatchObject({ code: "ROUND_NOT_FOUND" });
  });

  test("multiple category conversations coexist and retain participant-relative independent state", async () => {
    const { pairId, first, second } = await createJoinedPair();
    const roundA = await createRound(pairId, first.id, questionIds.deep);
    const roundB = await createRound(pairId, first.id, questionIds.relationship);
    await submitPrivateAnswer(db, {
      pairId,
      participantId: first.id,
      roundId: roundA.id,
      body: "Answer for A",
    });
    const firstConversations = await listActivePrivateConversations(db, {
      participantId: first.id,
      pairId,
    });
    const secondConversations = await listActivePrivateConversations(db, {
      participantId: second.id,
      pairId,
    });
    expect(firstConversations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: roundA.conversationId, state: "WAITING" }),
        expect.objectContaining({ id: roundB.conversationId, state: "YOUR_TURN" }),
      ]),
    );
    expect(secondConversations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: roundA.conversationId, state: "YOUR_TURN" }),
        expect.objectContaining({ id: roundB.conversationId, state: "YOUR_TURN" }),
      ]),
    );
  });

  test("the active-round projection exposes a newly created round safely to the other participant", async () => {
    const { pairId, first, second } = await createJoinedPair();
    const round = await createRound(pairId, first.id);
    await submitPrivateAnswer(db, {
      pairId,
      participantId: first.id,
      roundId: round.id,
      body: "Ali answer stays private",
    });
    const secondConversations = await listActivePrivateConversations(db, {
      participantId: second.id,
      pairId,
    });
    const summary = secondConversations.find((item) => item.id === round.conversationId);
    expect(summary).toMatchObject({
      id: round.conversationId,
      state: "YOUR_TURN",
      currentRound: expect.objectContaining({ id: round.id }),
    });
    expect(JSON.stringify(summary)).not.toContain("Ali answer stays private");
    expect(summary).not.toHaveProperty("answers");
  });

  test("pre-reveal projections contain only the viewer's answer and never serialize the other answer", async () => {
    const { pairId, first, second } = await createJoinedPair();
    const round = await createRound(pairId, first.id);
    await submitPrivateAnswer(db, {
      pairId,
      participantId: first.id,
      roundId: round.id,
      body: "Ali confidential answer",
    });
    const firstView = await getPrivateRoundForParticipant(db, {
      pairId,
      participantId: first.id,
      roundId: round.id,
    });
    const secondView = await getPrivateRoundForParticipant(db, {
      pairId,
      participantId: second.id,
      roundId: round.id,
    });
    expect(firstView.yourAnswer).toBe("Ali confidential answer");
    expect(firstView).not.toHaveProperty("answers");
    expect(secondView.yourAnswer).toBeNull();
    expect(secondView).not.toHaveProperty("answers");
    expect(JSON.stringify(secondView)).not.toContain("Ali confidential answer");
    expect(
      await getPrivateRoundStatusForParticipant(db, {
        pairId,
        participantId: second.id,
        roundId: round.id,
      }),
    ).toEqual({ state: "YOUR_TURN" });
  });

  test("only the second committed answer makes that round reveal-ready without serializing either answer", async () => {
    const { pairId, first, second } = await createJoinedPair();
    const roundA = await createRound(pairId, first.id);
    const roundB = await createRound(pairId, first.id, questionIds.relationship);
    await submitPrivateAnswer(db, {
      pairId,
      participantId: first.id,
      roundId: roundA.id,
      body: "A one",
    });
    await submitPrivateAnswer(db, {
      pairId,
      participantId: second.id,
      roundId: roundA.id,
      body: "A two",
    });
    const visibleToFirst = await getPrivateRoundForParticipant(db, {
      pairId,
      participantId: first.id,
      roundId: roundA.id,
    });
    const visibleToSecond = await getPrivateRoundForParticipant(db, {
      pairId,
      participantId: second.id,
      roundId: roundA.id,
    });
    expect(visibleToFirst.state).toBe("REVEAL_READY");
    expect(visibleToSecond.answers).toBeUndefined();
    expect(visibleToFirst.answers).toBeUndefined();
    expect(JSON.stringify(visibleToSecond)).not.toContain("A one");
    await markPrivateRevealViewed(db, { pairId, participantId: first.id, roundId: roundA.id });
    expect(
      (
        await getPrivateRoundForParticipant(db, {
          pairId,
          participantId: first.id,
          roundId: roundA.id,
        })
      ).answers?.map((answer) => answer.body),
    ).toEqual(expect.arrayContaining(["A one", "A two"]));
    expect(
      (
        await getPrivateRoundForParticipant(db, {
          pairId,
          participantId: first.id,
          roundId: roundB.id,
        })
      ).answers,
    ).toBeUndefined();
  });

  test("answers are trimmed, bounded, immutable, and deterministic for repeated concurrent submission", async () => {
    const { pairId, first } = await createJoinedPair();
    const round = await createRound(pairId, first.id);
    const repeated = await Promise.all([
      submitPrivateAnswer(db, {
        pairId,
        participantId: first.id,
        roundId: round.id,
        body: "  Kept answer  ",
      }),
      submitPrivateAnswer(db, {
        pairId,
        participantId: first.id,
        roundId: round.id,
        body: "Kept answer",
      }),
    ]);
    expect(repeated.every((view) => view.yourAnswer === "Kept answer")).toBe(true);
    const rows = await db
      .select()
      .from(privateAnswer)
      .where(and(eq(privateAnswer.roundId, round.id), eq(privateAnswer.participantId, first.id)));
    expect(rows).toHaveLength(1);
    expect(
      await capture(
        submitPrivateAnswer(db, {
          pairId,
          participantId: first.id,
          roundId: round.id,
          body: "A different answer",
        }),
      ),
    ).toMatchObject({ code: "ANSWER_IMMUTABLE" });
    expect(
      await capture(
        submitPrivateAnswer(db, {
          pairId,
          participantId: first.id,
          roundId: round.id,
          body: "   ",
        }),
      ),
    ).toMatchObject({ code: "ANSWER_INVALID" });
    expect(
      await capture(
        submitPrivateAnswer(db, {
          pairId,
          participantId: first.id,
          roundId: round.id,
          body: "x".repeat(2001),
        }),
      ),
    ).toMatchObject({ code: "ANSWER_INVALID" });
  });

  test("reveal-view timing is independent and does not leak to another active round", async () => {
    const { pairId, first, second } = await createJoinedPair();
    const roundA = await makeReady(pairId, first.id, second.id);
    const roundB = await makeReady(pairId, first.id, second.id, questionIds.relationship);
    await markPrivateRevealViewed(db, { pairId, participantId: first.id, roundId: roundA.id });
    expect(
      (
        await getPrivateRoundForParticipant(db, {
          pairId,
          participantId: first.id,
          roundId: roundA.id,
        })
      ).state,
    ).toBe("REVEAL_VIEWED");
    expect(
      (
        await getPrivateRoundForParticipant(db, {
          pairId,
          participantId: second.id,
          roundId: roundA.id,
        })
      ).state,
    ).toBe("REVEAL_READY");
    expect(
      (
        await getPrivateRoundForParticipant(db, {
          pairId,
          participantId: first.id,
          roundId: roundB.id,
        })
      ).state,
    ).toBe("REVEAL_READY");
  });

  test("a revealed participant owns one changeable reaction and one editable removable reply", async () => {
    const { pairId, first, second } = await createJoinedPair();
    const round = await makeReady(pairId, first.id, second.id);
    await markPrivateRevealViewed(db, { pairId, participantId: first.id, roundId: round.id });
    await setPrivateReaction(db, {
      pairId,
      participantId: first.id,
      roundId: round.id,
      value: "heart",
    });
    let view = await setPrivateReaction(db, {
      pairId,
      participantId: first.id,
      roundId: round.id,
      value: "laugh",
    });
    expect(view.reactions).toEqual([
      expect.objectContaining({ participantId: first.id, value: "laugh" }),
    ]);
    view = await removePrivateReaction(db, { pairId, participantId: first.id, roundId: round.id });
    expect(view.reactions).toEqual([]);
    await setPrivateReply(db, {
      pairId,
      participantId: first.id,
      roundId: round.id,
      body: "  I love that.  ",
    });
    view = await setPrivateReply(db, {
      pairId,
      participantId: first.id,
      roundId: round.id,
      body: "I love that even more.",
    });
    expect(view.replies).toEqual([
      expect.objectContaining({
        participantId: first.id,
        body: "I love that even more.",
        isOwner: true,
      }),
    ]);
    view = await removePrivateReply(db, { pairId, participantId: first.id, roundId: round.id });
    expect(view.replies).toEqual([]);
  });

  test("reactions are shared post-reveal and deterministically belong on the other answer", async () => {
    const { pairId, first, second } = await createJoinedPair();
    const round = await makeReady(pairId, first.id, second.id);
    await markPrivateRevealViewed(db, { pairId, participantId: first.id, roundId: round.id });
    await markPrivateRevealViewed(db, { pairId, participantId: second.id, roundId: round.id });
    await setPrivateReaction(db, {
      pairId,
      participantId: second.id,
      roundId: round.id,
      value: "heart",
    });
    await setPrivateReaction(db, {
      pairId,
      participantId: first.id,
      roundId: round.id,
      value: "laugh",
    });
    const firstView = await getPrivateRoundForParticipant(db, {
      pairId,
      participantId: first.id,
      roundId: round.id,
    });
    const secondView = await getPrivateRoundForParticipant(db, {
      pairId,
      participantId: second.id,
      roundId: round.id,
    });
    expect(firstView.reactions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ participantId: second.id, value: "heart" }),
        expect.objectContaining({ participantId: first.id, value: "laugh" }),
      ]),
    );
    expect(secondView.reactions).toEqual(firstView.reactions);
    const answerOwnerByReactionOwner = new Map([
      [first.id, second.id],
      [second.id, first.id],
    ]);
    for (const reaction of firstView.reactions ?? []) {
      expect(answerOwnerByReactionOwner.get(reaction.participantId)).not.toBe(
        reaction.participantId,
      );
    }
  });

  test("an authorized partner can read a post-reveal reply, while an outsider cannot operate on reactions or replies", async () => {
    const joined = await createJoinedPair();
    const unrelated = await createParticipant("No access");
    const round = await makeReady(joined.pairId, joined.first.id, joined.second.id);
    await markPrivateRevealViewed(db, {
      pairId: joined.pairId,
      participantId: joined.first.id,
      roundId: round.id,
    });
    await setPrivateReply(db, {
      pairId: joined.pairId,
      participantId: joined.first.id,
      roundId: round.id,
      body: "I’m glad you said that.",
    });
    await markPrivateRevealViewed(db, {
      pairId: joined.pairId,
      participantId: joined.second.id,
      roundId: round.id,
    });
    const secondView = await getPrivateRoundForParticipant(db, {
      pairId: joined.pairId,
      participantId: joined.second.id,
      roundId: round.id,
    });
    expect(secondView.replies).toEqual([
      expect.objectContaining({
        participantId: joined.first.id,
        body: "I’m glad you said that.",
        isOwner: false,
      }),
    ]);
    expect(
      await capture(
        setPrivateReaction(db, {
          pairId: joined.pairId,
          participantId: unrelated.id,
          roundId: round.id,
          value: "heart",
        }),
      ),
    ).toMatchObject({ code: "PAIR_NOT_FOUND" });
    expect(
      await capture(
        setPrivateReply(db, {
          pairId: joined.pairId,
          participantId: unrelated.id,
          roundId: round.id,
          body: "Nope",
        }),
      ),
    ).toMatchObject({ code: "PAIR_NOT_FOUND" });
  });

  test("Pair Home returns one summary per conversation and resuming Deep leaves Fun intact", async () => {
    const { pairId, first, second } = await createJoinedPair();
    const deep = await createRound(pairId, first.id, questionIds.deep);
    await submitPrivateAnswer(db, {
      pairId,
      participantId: first.id,
      roundId: deep.id,
      body: "Deep waits",
    });
    const fun = await createRound(pairId, first.id, questionIds.fun);
    const resumedDeep = await startOrResumePrivateConversation(db, {
      pairId,
      participantId: second.id,
      category: "deep",
      clientRequestId: randomUUID(),
    });
    const summaries = await listActivePrivateConversations(db, { pairId, participantId: first.id });
    expect(resumedDeep.roundId).toBe(deep.id);
    expect(summaries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: deep.conversationId,
          currentRound: expect.objectContaining({ id: deep.id }),
          questionCount: 1,
          state: "WAITING",
        }),
        expect.objectContaining({
          id: fun.conversationId,
          currentRound: expect.objectContaining({ id: fun.id }),
          questionCount: 1,
          state: "YOUR_TURN",
        }),
      ]),
    );
  });

  test("conversation summaries derive ready to reveal and ready for next from the current round", async () => {
    const { pairId, first, second } = await createJoinedPair();
    const round = await makeReady(pairId, first.id, second.id);
    let firstSummary = (
      await listActivePrivateConversations(db, { pairId, participantId: first.id })
    )[0];
    let secondSummary = (
      await listActivePrivateConversations(db, { pairId, participantId: second.id })
    )[0];
    expect(firstSummary).toMatchObject({ currentRound: { id: round.id }, state: "REVEAL_READY" });
    expect(secondSummary).toMatchObject({ currentRound: { id: round.id }, state: "REVEAL_READY" });
    await markPrivateRevealViewed(db, { pairId, participantId: first.id, roundId: round.id });
    firstSummary = (
      await listActivePrivateConversations(db, { pairId, participantId: first.id })
    )[0];
    secondSummary = (
      await listActivePrivateConversations(db, { pairId, participantId: second.id })
    )[0];
    expect(firstSummary?.state).toBe("WAITING_FOR_REVEAL");
    expect(secondSummary?.state).toBe("REVEAL_READY");
    await markPrivateRevealViewed(db, { pairId, participantId: second.id, roundId: round.id });
    firstSummary = (
      await listActivePrivateConversations(db, { pairId, participantId: first.id })
    )[0];
    secondSummary = (
      await listActivePrivateConversations(db, { pairId, participantId: second.id })
    )[0];
    expect(firstSummary?.state).toBe("READY_FOR_NEXT");
    expect(secondSummary?.state).toBe("WAITING_FOR_CREATOR");
  });

  test("a participant outside the pair cannot read or operate on its round", async () => {
    const joined = await createJoinedPair();
    const unrelated = await createParticipant("No access");
    const round = await createRound(joined.pairId, joined.first.id);
    expect(
      await capture(
        getPrivateRoundForParticipant(db, {
          pairId: joined.pairId,
          participantId: unrelated.id,
          roundId: round.id,
        }),
      ),
    ).toMatchObject({ code: "PAIR_NOT_FOUND" });
    expect(
      await capture(
        submitPrivateAnswer(db, {
          pairId: joined.pairId,
          participantId: unrelated.id,
          roundId: round.id,
          body: "Nope",
        }),
      ),
    ).toMatchObject({ code: "PAIR_NOT_FOUND" });
    const started = await startOrResumePrivateConversation(db, {
      pairId: joined.pairId,
      participantId: joined.first.id,
      category: "relationship",
      clientRequestId: randomUUID(),
    });
    if (started.state !== "CANDIDATE") throw new Error("Expected candidate projection.");
    expect(
      await capture(
        askPrivateQuestionCandidate(db, {
          pairId: joined.pairId,
          participantId: unrelated.id,
          conversationId: started.id,
          candidateId: started.candidate.id,
        }),
      ),
    ).toMatchObject({ code: "PAIR_NOT_FOUND" });
  });

  test("category start persists one creator-owned candidate and concurrent starters converge", async () => {
    const { pairId, first, second } = await createJoinedPair();
    const [firstStart, secondStart] = await Promise.all([
      startOrResumePrivateConversation(db, {
        pairId,
        participantId: first.id,
        category: "deep",
        clientRequestId: randomUUID(),
      }),
      startOrResumePrivateConversation(db, {
        pairId,
        participantId: second.id,
        category: "deep",
        clientRequestId: randomUUID(),
      }),
    ]);
    expect(firstStart.id).toBe(secondStart.id);
    const creator = firstStart.role === "creator" ? firstStart : secondStart;
    const nonCreator = firstStart.role === "non-creator" ? firstStart : secondStart;
    expect(creator.state).toBe("CANDIDATE");
    expect(nonCreator.state).toBe("WAITING_FOR_CREATOR");
    expect(JSON.stringify(nonCreator)).not.toContain("candidate");
    if (creator.state !== "CANDIDATE") throw new Error("Expected candidate projection.");
    const retry = await startOrResumePrivateConversation(db, {
      pairId,
      participantId: creator.creator.participantId,
      category: "deep",
      clientRequestId: randomUUID(),
    });
    expect(retry).toMatchObject({
      id: creator.id,
      state: "CANDIDATE",
      candidate: { id: creator.candidate.id, question: { text: creator.candidate.question.text } },
    });
    expect(
      await db.select().from(privateConversation).where(eq(privateConversation.pairId, pairId)),
    ).toHaveLength(1);
    expect(
      await db
        .select()
        .from(privateQuestionCandidate)
        .where(
          and(
            eq(privateQuestionCandidate.conversationId, creator.id),
            eq(privateQuestionCandidate.state, "unresolved"),
          ),
        ),
    ).toHaveLength(1);
  });

  test("candidate pins its revision and withdrawal invalidates it without consuming the question", async () => {
    const { pairId, first } = await createJoinedPair();
    const started = await startOrResumePrivateConversation(db, {
      pairId,
      participantId: first.id,
      category: "deep",
      clientRequestId: randomUUID(),
    });
    if (started.state !== "CANDIDATE") throw new Error("Expected candidate projection.");
    const originalText = started.candidate.question.text;
    const revision = await reviseQuestion(db, {
      questionId: started.candidate.question.id,
      text: "A later wording that must not rewrite the candidate",
      category: "deep",
      relationshipFit: "both",
      modeFit: "private",
      intensity: "light",
    });
    const afterRevision = await getPrivateConversationForParticipant(db, {
      pairId,
      participantId: first.id,
      conversationId: started.id,
    });
    expect(afterRevision).toMatchObject({
      state: "CANDIDATE",
      candidate: {
        question: {
          questionRevisionId: started.candidate.question.questionRevisionId,
          text: originalText,
        },
      },
    });
    await withdrawQuestionRevision(db, started.candidate.question.questionRevisionId);
    const candidates = await db
      .select()
      .from(privateQuestionCandidate)
      .where(eq(privateQuestionCandidate.conversationId, started.id));
    expect(candidates.filter((candidate) => candidate.state === "invalidated")).toHaveLength(1);
    expect(candidates.filter((candidate) => candidate.state === "unresolved")).toHaveLength(1);
    expect(
      candidates.find((candidate) => candidate.state === "unresolved")?.questionRevisionId,
    ).toBe(revision.revision.id);
    expect(
      (
        await getPrivateConversationForParticipant(db, {
          pairId,
          participantId: first.id,
          conversationId: started.id,
        })
      ).state,
    ).toBe("CANDIDATE");
  });

  test("the creator can Like and Ask one current candidate, pinning its previewed revision into Round 1", async () => {
    const { pairId, first, second } = await createJoinedPair();
    const started = await startOrResumePrivateConversation(db, {
      pairId,
      participantId: first.id,
      category: "deep",
      clientRequestId: randomUUID(),
    });
    if (started.state !== "CANDIDATE") throw new Error("Expected candidate projection.");
    await setPrivateQuestionCandidateLike(db, {
      pairId,
      participantId: first.id,
      conversationId: started.id,
      candidateId: started.candidate.id,
      liked: true,
    });
    await reviseQuestion(db, {
      questionId: started.candidate.question.id,
      text: "A later revision must not change Ask",
      category: "deep",
      relationshipFit: "both",
      modeFit: "private",
      intensity: "deep",
    });
    const asked = await askPrivateQuestionCandidate(db, {
      pairId,
      participantId: first.id,
      conversationId: started.id,
      candidateId: started.candidate.id,
      clientRequestId: randomUUID(),
    });
    const [round] = await db.select().from(privateRound).where(eq(privateRound.id, asked.roundId));
    const [candidate] = await db
      .select()
      .from(privateQuestionCandidate)
      .where(eq(privateQuestionCandidate.id, started.candidate.id));
    expect(round).toMatchObject({
      conversationId: started.id,
      questionId: started.candidate.question.id,
      questionRevisionId: started.candidate.question.questionRevisionId,
      questionNumber: 1,
    });
    expect(candidate).toMatchObject({ state: "asked", liked: true });
    expect(
      (
        await getPrivateRoundForParticipant(db, {
          pairId,
          participantId: second.id,
          roundId: asked.roundId,
        })
      ).question.questionRevisionId,
    ).toBe(started.candidate.question.questionRevisionId);
  });

  test("candidate actions are creator-only and candidate Like never appears in the non-creator projection", async () => {
    const { pairId, first, second } = await createJoinedPair();
    const started = await startOrResumePrivateConversation(db, {
      pairId,
      participantId: first.id,
      category: "deep",
      clientRequestId: randomUUID(),
    });
    if (started.state !== "CANDIDATE") throw new Error("Expected candidate projection.");
    const nonCreator = await getPrivateConversationForParticipant(db, {
      pairId,
      participantId: second.id,
      conversationId: started.id,
    });
    expect(nonCreator).toMatchObject({ state: "WAITING_FOR_CREATOR" });
    expect(JSON.stringify(nonCreator)).not.toContain(started.candidate.id);
    expect(
      await capture(
        setPrivateQuestionCandidateLike(db, {
          pairId,
          participantId: second.id,
          conversationId: started.id,
          candidateId: started.candidate.id,
          liked: true,
        }),
      ),
    ).toMatchObject({ code: "CONVERSATION_NOT_FOUND" });
    expect(
      await capture(
        askPrivateQuestionCandidate(db, {
          pairId,
          participantId: second.id,
          conversationId: started.id,
          candidateId: started.candidate.id,
        }),
      ),
    ).toMatchObject({ code: "CONVERSATION_NOT_FOUND" });
    expect(
      await capture(
        skipPrivateQuestionCandidate(db, {
          pairId,
          participantId: second.id,
          conversationId: started.id,
          candidateId: started.candidate.id,
        }),
      ),
    ).toMatchObject({ code: "CONVERSATION_NOT_FOUND" });
  });

  test("Skip consumes its logical Question without creating a Round, preserves Like, and persists the next candidate", async () => {
    const { pairId, first } = await createJoinedPair();
    const started = await startOrResumePrivateConversation(db, {
      pairId,
      participantId: first.id,
      category: "deep",
      clientRequestId: randomUUID(),
    });
    if (started.state !== "CANDIDATE") throw new Error("Expected candidate projection.");
    await setPrivateQuestionCandidateLike(db, {
      pairId,
      participantId: first.id,
      conversationId: started.id,
      candidateId: started.candidate.id,
      liked: true,
    });
    const afterSkip = await skipPrivateQuestionCandidate(db, {
      pairId,
      participantId: first.id,
      conversationId: started.id,
      candidateId: started.candidate.id,
    });
    const rounds = await db
      .select()
      .from(privateRound)
      .where(eq(privateRound.conversationId, started.id));
    const [skipped] = await db
      .select()
      .from(privateQuestionCandidate)
      .where(eq(privateQuestionCandidate.id, started.candidate.id));
    expect(rounds).toHaveLength(0);
    expect(skipped).toMatchObject({
      state: "skipped",
      liked: true,
      questionId: started.candidate.question.id,
    });
    if (afterSkip.state === "CANDIDATE")
      expect(afterSkip.candidate.question.id).not.toBe(started.candidate.question.id);
    expect(
      await capture(
        askPrivateQuestionCandidate(db, {
          pairId,
          participantId: first.id,
          conversationId: started.id,
          candidateId: started.candidate.id,
        }),
      ),
    ).toMatchObject({ code: "QUESTION_UNAVAILABLE" });
  });

  test("Skip exhausts rather than cycles and a skipped logical Question stays consumed after revision", async () => {
    const { pairId, first } = await createJoinedPair();
    let view = await startOrResumePrivateConversation(db, {
      pairId,
      participantId: first.id,
      category: "deep",
      clientRequestId: randomUUID(),
    });
    const skippedQuestionIds: string[] = [];
    for (let attempt = 0; attempt < 50 && view.state === "CANDIDATE"; attempt += 1) {
      skippedQuestionIds.push(view.candidate.question.id);
      view = await skipPrivateQuestionCandidate(db, {
        pairId,
        participantId: first.id,
        conversationId: view.id,
        candidateId: view.candidate.id,
      });
    }
    expect(view).toMatchObject({ state: "EXHAUSTED", message: "You've reached the end for now." });
    expect(new Set(skippedQuestionIds).size).toBe(skippedQuestionIds.length);
    const firstSkipped = skippedQuestionIds[0];
    if (!firstSkipped) throw new Error("Expected at least one skipped Question.");
    await reviseQuestion(db, {
      questionId: firstSkipped,
      text: "A new revision of a skipped question",
      category: "deep",
      relationshipFit: "both",
      modeFit: "private",
      intensity: "light",
    });
    expect(
      (
        await startOrResumePrivateConversation(db, {
          pairId,
          participantId: first.id,
          category: "deep",
          clientRequestId: randomUUID(),
        })
      ).state,
    ).toBe("EXHAUSTED");
  });

  test("Ask and Skip serialize on a candidate, retries create one Round, and resolved Likes freeze", async () => {
    const { pairId, first } = await createJoinedPair();
    const started = await startOrResumePrivateConversation(db, {
      pairId,
      participantId: first.id,
      category: "deep",
      clientRequestId: randomUUID(),
    });
    if (started.state !== "CANDIDATE") throw new Error("Expected candidate projection.");
    const requestId = randomUUID();
    const [ask, skip] = await Promise.all([
      capture(
        askPrivateQuestionCandidate(db, {
          pairId,
          participantId: first.id,
          conversationId: started.id,
          candidateId: started.candidate.id,
          clientRequestId: requestId,
        }),
      ),
      capture(
        skipPrivateQuestionCandidate(db, {
          pairId,
          participantId: first.id,
          conversationId: started.id,
          candidateId: started.candidate.id,
        }),
      ),
    ]);
    const [candidate] = await db
      .select()
      .from(privateQuestionCandidate)
      .where(eq(privateQuestionCandidate.id, started.candidate.id));
    const rounds = await db
      .select()
      .from(privateRound)
      .where(eq(privateRound.conversationId, started.id));
    expect(candidate?.state === "asked" || candidate?.state === "skipped").toBe(true);
    expect(rounds).toHaveLength(candidate?.state === "asked" ? 1 : 0);
    expect([ask, skip].filter((result) => result instanceof Error)).toHaveLength(1);
    if (candidate?.state === "asked") {
      const retry = await askPrivateQuestionCandidate(db, {
        pairId,
        participantId: first.id,
        conversationId: started.id,
        candidateId: started.candidate.id,
        clientRequestId: requestId,
      });
      expect(retry.roundId).toBe(rounds[0]?.id);
    }
    expect(
      await capture(
        setPrivateQuestionCandidateLike(db, {
          pairId,
          participantId: first.id,
          conversationId: started.id,
          candidateId: started.candidate.id,
          liked: true,
        }),
      ),
    ).toMatchObject({ code: "QUESTION_UNAVAILABLE" });
  });

  test("an Ask request ID cannot resolve a newer candidate to an earlier Round", async () => {
    const { pairId, first, second } = await createJoinedPair();
    const firstCandidate = await startOrResumePrivateConversation(db, {
      pairId,
      participantId: first.id,
      category: "deep",
      clientRequestId: randomUUID(),
    });
    if (firstCandidate.state !== "CANDIDATE") throw new Error("Expected first candidate.");
    const requestId = randomUUID();
    const firstAsk = await askPrivateQuestionCandidate(db, {
      pairId,
      participantId: first.id,
      conversationId: firstCandidate.id,
      candidateId: firstCandidate.candidate.id,
      clientRequestId: requestId,
    });
    await submitPrivateAnswer(db, {
      pairId,
      participantId: first.id,
      roundId: firstAsk.roundId,
      body: "First answer",
    });
    await submitPrivateAnswer(db, {
      pairId,
      participantId: second.id,
      roundId: firstAsk.roundId,
      body: "Second answer",
    });
    await markPrivateRevealViewed(db, {
      pairId,
      participantId: first.id,
      roundId: firstAsk.roundId,
    });
    await markPrivateRevealViewed(db, {
      pairId,
      participantId: second.id,
      roundId: firstAsk.roundId,
    });
    const nextCandidate = await startOrResumePrivateConversation(db, {
      pairId,
      participantId: first.id,
      category: "deep",
      clientRequestId: randomUUID(),
    });
    if (nextCandidate.state !== "CANDIDATE") throw new Error("Expected next candidate.");
    expect(
      await capture(
        askPrivateQuestionCandidate(db, {
          pairId,
          participantId: first.id,
          conversationId: nextCandidate.id,
          candidateId: nextCandidate.candidate.id,
          clientRequestId: requestId,
        }),
      ),
    ).toMatchObject({ code: "QUESTION_UNAVAILABLE" });
    expect(
      (
        await db
          .select()
          .from(privateQuestionCandidate)
          .where(eq(privateQuestionCandidate.id, nextCandidate.candidate.id))
      )[0],
    ).toMatchObject({ state: "unresolved" });
  });

  test("Private intensity preference uses the accepted completed-Round bands and fallback order", () => {
    expect(privateIntensityFallback(0)).toEqual(["light", "medium", "deep"]);
    expect(privateIntensityFallback(1)).toEqual(["light", "medium", "deep"]);
    expect(privateIntensityFallback(2)).toEqual(["medium", "light", "deep"]);
    expect(privateIntensityFallback(3)).toEqual(["medium", "light", "deep"]);
    expect(privateIntensityFallback(4)).toEqual(["deep", "medium", "light"]);
    expect(privateIntensityFallback(10)).toEqual(["deep", "medium", "light"]);
  });

  test("selection follows mutually completed Private Rounds, while Like, Skip, and Ask alone do not advance the ramp", async () => {
    await Promise.all([
      createPrivateTestQuestion("light"),
      createPrivateTestQuestion("light"),
      createPrivateTestQuestion("light"),
      createPrivateTestQuestion("medium"),
      createPrivateTestQuestion("medium"),
      createPrivateTestQuestion("deep"),
    ]);
    const { pairId, first, second } = await createJoinedPair();
    let view = await startOrResumePrivateConversation(db, {
      pairId,
      participantId: first.id,
      category: "deep",
      clientRequestId: randomUUID(),
    });
    if (view.state !== "CANDIDATE") throw new Error("Expected first candidate.");
    expect(view.candidate.question.intensity).toBe("light");
    await setPrivateQuestionCandidateLike(db, {
      pairId,
      participantId: first.id,
      conversationId: view.id,
      candidateId: view.candidate.id,
      liked: true,
    });
    const afterSkip = await skipPrivateQuestionCandidate(db, {
      pairId,
      participantId: first.id,
      conversationId: view.id,
      candidateId: view.candidate.id,
    });
    if (afterSkip.state !== "CANDIDATE") throw new Error("Expected candidate after Skip.");
    expect(afterSkip.candidate.question.intensity).toBe("light");

    async function askCompleteAndResume(candidate: Extract<typeof view, { state: "CANDIDATE" }>) {
      const asked = await askPrivateQuestionCandidate(db, {
        pairId,
        participantId: first.id,
        conversationId: candidate.id,
        candidateId: candidate.candidate.id,
        clientRequestId: randomUUID(),
      });
      expect(
        (
          await getPrivateConversationForParticipant(db, {
            pairId,
            participantId: first.id,
            conversationId: candidate.id,
          })
        ).state,
      ).toBe("CURRENT_ROUND");
      await submitPrivateAnswer(db, {
        pairId,
        participantId: first.id,
        roundId: asked.roundId,
        body: "First completed answer",
      });
      await submitPrivateAnswer(db, {
        pairId,
        participantId: second.id,
        roundId: asked.roundId,
        body: "Second completed answer",
      });
      await markPrivateRevealViewed(db, {
        pairId,
        participantId: first.id,
        roundId: asked.roundId,
      });
      await markPrivateRevealViewed(db, {
        pairId,
        participantId: second.id,
        roundId: asked.roundId,
      });
      return startOrResumePrivateConversation(db, {
        pairId,
        participantId: first.id,
        category: "deep",
        clientRequestId: randomUUID(),
      });
    }

    view = await askCompleteAndResume(afterSkip);
    if (view.state !== "CANDIDATE")
      throw new Error("Expected candidate after one completed Round.");
    expect(view.candidate.question.intensity).toBe("light");
    view = await askCompleteAndResume(view);
    if (view.state !== "CANDIDATE")
      throw new Error("Expected candidate after two completed Rounds.");
    expect(view.candidate.question.intensity).toBe("medium");
    view = await askCompleteAndResume(view);
    if (view.state !== "CANDIDATE")
      throw new Error("Expected candidate after three completed Rounds.");
    expect(view.candidate.question.intensity).toBe("medium");
    view = await askCompleteAndResume(view);
    if (view.state !== "CANDIDATE")
      throw new Error("Expected candidate after four completed Rounds.");
    expect(view.candidate.question.intensity).toBe("deep");
  });

  test("an unresolved legacy Round takes precedence and does not get a candidate", async () => {
    const { pairId, first } = await createJoinedPair();
    const round = await createRound(pairId, first.id);
    const started = await startOrResumePrivateConversation(db, {
      pairId,
      participantId: first.id,
      category: "deep",
      clientRequestId: randomUUID(),
    });
    expect(started).toMatchObject({
      id: round.conversationId,
      state: "CURRENT_ROUND",
      roundId: round.id,
    });
    expect(
      await db
        .select()
        .from(privateQuestionCandidate)
        .where(eq(privateQuestionCandidate.conversationId, round.conversationId)),
    ).toHaveLength(0);
  });

  test("replacement starts a distinct era Conversation and cannot read the old candidate", async () => {
    const joined = await createJoinedPair();
    const old = await startOrResumePrivateConversation(db, {
      pairId: joined.pairId,
      participantId: joined.first.id,
      category: "deep",
      clientRequestId: randomUUID(),
    });
    if (old.state !== "CANDIDATE") throw new Error("Expected old candidate projection.");
    const invite = await issueRejoinInvite(db, {
      pairId: joined.pairId,
      participantId: joined.first.id,
    });
    const replacement = await redeemRejoinInvite(db, {
      token: invite.token,
      authUserId: await createAuthUser("Replacement"),
      displayName: "Replacement",
    });
    expect(
      await capture(
        getPrivateConversationForParticipant(db, {
          pairId: joined.pairId,
          participantId: replacement.participantId,
          conversationId: old.id,
        }),
      ),
    ).toMatchObject({ code: "CONVERSATION_NOT_FOUND" });
    expect(
      (
        await db
          .select()
          .from(privateQuestionCandidate)
          .where(eq(privateQuestionCandidate.conversationId, old.id))
      ).every((candidate) => candidate.state !== "unresolved"),
    ).toBe(true);
    const nextEra = await startOrResumePrivateConversation(db, {
      pairId: joined.pairId,
      participantId: joined.first.id,
      category: "deep",
      clientRequestId: randomUUID(),
    });
    expect(nextEra.id).not.toBe(old.id);
    expect(nextEra.state).toBe("CANDIDATE");
  });

  test("either unanswered participant can pass, the Round stays numbered, and a lone answer remains author-only", async () => {
    const { pairId, first, second } = await createJoinedPair();
    const round = await createRound(pairId, first.id);
    await submitPrivateAnswer(db, {
      pairId,
      participantId: first.id,
      roundId: round.id,
      body: "Only Ali may retain this.",
    });
    const passed = await declinePrivateRound(db, {
      pairId,
      participantId: second.id,
      roundId: round.id,
    });
    expect(passed).toMatchObject({
      state: "DECLINED",
      yourAnswer: null,
      conversation: { questionNumber: 1 },
    });
    expect(JSON.stringify(passed)).not.toContain("Only Ali may retain this.");
    const authorView = await getPrivateRoundForParticipant(db, {
      pairId,
      participantId: first.id,
      roundId: round.id,
    });
    expect(authorView).toMatchObject({
      state: "DECLINED",
      yourAnswer: "Only Ali may retain this.",
    });
    expect(authorView.answers).toBeUndefined();
    const [stored] = await db.select().from(privateRound).where(eq(privateRound.id, round.id));
    expect(stored).toMatchObject({ status: "declined", declinedByParticipantId: second.id });
    expect(
      await db.select().from(privateRevealView).where(eq(privateRevealView.roundId, round.id)),
    ).toHaveLength(0);
    const creator = await getPrivateConversationForParticipant(db, {
      pairId,
      participantId: first.id,
      conversationId: round.conversationId,
    });
    const nonCreator = await getPrivateConversationForParticipant(db, {
      pairId,
      participantId: second.id,
      conversationId: round.conversationId,
    });
    expect(["CANDIDATE", "EXHAUSTED"]).toContain(creator.state);
    expect(["WAITING_FOR_CREATOR", "EXHAUSTED"]).toContain(nonCreator.state);
  });

  test("passing is unavailable to an answerer or once two answers exist, while the unanswered participant may pass", async () => {
    const { pairId, first, second } = await createJoinedPair();
    const oneAnswer = await createRound(pairId, first.id);
    await submitPrivateAnswer(db, {
      pairId,
      participantId: first.id,
      roundId: oneAnswer.id,
      body: "I answered.",
    });
    expect(
      await capture(
        declinePrivateRound(db, { pairId, participantId: first.id, roundId: oneAnswer.id }),
      ),
    ).toMatchObject({ code: "QUESTION_UNAVAILABLE" });
    await declinePrivateRound(db, { pairId, participantId: second.id, roundId: oneAnswer.id });

    const ready = await createRound(pairId, first.id, questionIds.relationship);
    await submitPrivateAnswer(db, {
      pairId,
      participantId: first.id,
      roundId: ready.id,
      body: "First answer.",
    });
    await submitPrivateAnswer(db, {
      pairId,
      participantId: second.id,
      roundId: ready.id,
      body: "Second answer.",
    });
    expect(
      await capture(
        declinePrivateRound(db, { pairId, participantId: first.id, roundId: ready.id }),
      ),
    ).toMatchObject({ code: "QUESTION_UNAVAILABLE" });
  });

  test("pass and answer serialize, repeated pass is idempotent, and declined Rounds reject reveal, reaction, and reply", async () => {
    const { pairId, first, second } = await createJoinedPair();
    const round = await createRound(pairId, first.id);
    const [passed, answered] = await Promise.all([
      capture(declinePrivateRound(db, { pairId, participantId: second.id, roundId: round.id })),
      capture(
        submitPrivateAnswer(db, {
          pairId,
          participantId: second.id,
          roundId: round.id,
          body: "Racing answer.",
        }),
      ),
    ]);
    expect([passed, answered].filter((result) => !(result instanceof Error))).toHaveLength(1);
    const [stored] = await db.select().from(privateRound).where(eq(privateRound.id, round.id));
    if (stored?.status === "declined") {
      await expect(
        declinePrivateRound(db, { pairId, participantId: second.id, roundId: round.id }),
      ).resolves.toMatchObject({ state: "DECLINED" });
      expect(
        await capture(
          markPrivateRevealViewed(db, { pairId, participantId: second.id, roundId: round.id }),
        ),
      ).toMatchObject({ code: "REVEAL_NOT_READY" });
      expect(
        await capture(
          setPrivateReaction(db, {
            pairId,
            participantId: second.id,
            roundId: round.id,
            value: "heart",
          }),
        ),
      ).toMatchObject({ code: "REVEAL_NOT_READY" });
      expect(
        await capture(
          setPrivateReply(db, {
            pairId,
            participantId: second.id,
            roundId: round.id,
            body: "No reply.",
          }),
        ),
      ).toMatchObject({ code: "REVEAL_NOT_READY" });
    }
  });

  test("Reveal Views are independent and only both views permit creator candidate progression", async () => {
    const { pairId, first, second } = await createJoinedPair();
    const started = await startOrResumePrivateConversation(db, {
      pairId,
      participantId: first.id,
      category: "deep",
      clientRequestId: randomUUID(),
    });
    if (started.state !== "CANDIDATE") throw new Error("Expected candidate.");
    const asked = await askPrivateQuestionCandidate(db, {
      pairId,
      participantId: first.id,
      conversationId: started.id,
      candidateId: started.candidate.id,
      clientRequestId: randomUUID(),
    });
    await submitPrivateAnswer(db, {
      pairId,
      participantId: first.id,
      roundId: asked.roundId,
      body: "Creator answer.",
    });
    await submitPrivateAnswer(db, {
      pairId,
      participantId: second.id,
      roundId: asked.roundId,
      body: "Other answer.",
    });
    await markPrivateRevealViewed(db, { pairId, participantId: first.id, roundId: asked.roundId });
    expect(
      await db.select().from(privateRevealView).where(eq(privateRevealView.roundId, asked.roundId)),
    ).toHaveLength(1);
    expect(
      (
        await startOrResumePrivateConversation(db, {
          pairId,
          participantId: first.id,
          category: "deep",
          clientRequestId: randomUUID(),
        })
      ).state,
    ).toBe("CURRENT_ROUND");
    expect(
      (
        await startOrResumePrivateConversation(db, {
          pairId,
          participantId: second.id,
          category: "deep",
          clientRequestId: randomUUID(),
        })
      ).state,
    ).toBe("CURRENT_ROUND");
    await markPrivateRevealViewed(db, { pairId, participantId: second.id, roundId: asked.roundId });
    expect(
      (
        await startOrResumePrivateConversation(db, {
          pairId,
          participantId: first.id,
          category: "deep",
          clientRequestId: randomUUID(),
        })
      ).state,
    ).toMatch(/CANDIDATE|EXHAUSTED/);
    expect(
      (
        await startOrResumePrivateConversation(db, {
          pairId,
          participantId: second.id,
          category: "deep",
          clientRequestId: randomUUID(),
        })
      ).state,
    ).toBe("WAITING_FOR_CREATOR");
  });
});
