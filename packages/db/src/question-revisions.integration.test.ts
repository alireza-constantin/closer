import { randomUUID } from "node:crypto";

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import dotenv from "dotenv";
import { and, eq, inArray, isNull } from "drizzle-orm";

dotenv.config({ path: new URL("../../../apps/web/.env.local", import.meta.url) });

const { createDb } = await import("./index");
const {
  createQuestion,
  createQuestionRevision,
  createPairForParticipant,
  deactivateQuestion,
  getPrivateRoundForParticipant,
  getTogetherSessionForParticipant,
  issueOrReuseInitialInvite,
  listEligibleTogetherQuestions,
  redeemInitialInvite,
  resolveOrCreateParticipant,
  withdrawQuestionRevision,
} = await import("./closer");
const {
  initialInvite,
  pair,
  pairMembership,
  pairMembershipEra,
  participant,
  privateConversation,
  privateRound,
  question,
  questionRevision,
  togetherSession,
  togetherSessionQuestion,
} = await import("./schema/closer");
const { user } = await import("./schema/auth");

const db = createDb();
const authUserIds: string[] = [];
const pairIds: string[] = [];

async function createParticipant(name = "Question test participant") {
  const authUserId = randomUUID();
  authUserIds.push(authUserId);
  await db.insert(user).values({
    id: authUserId,
    name,
    email: `${authUserId}@question.closer.invalid`,
    isAnonymous: true,
  });
  return resolveOrCreateParticipant(db, { authUserId, displayName: name });
}

async function createUnclaimedPair() {
  const creator = await createParticipant();
  const created = await createPairForParticipant(db, {
    participantId: creator.id,
    intendedPersonName: "Their person",
    relationshipType: "partner",
  });
  pairIds.push(created.pair.id);
  return { creator, pair: created.pair };
}

async function createJoinedPair() {
  const first = await createUnclaimedPair();
  const second = await createParticipant("Question test partner");
  const invite = await issueOrReuseInitialInvite(db, {
    participantId: first.creator.id,
    pairId: first.pair.id,
  });
  if (invite.state !== "issued") throw new Error("Question test invite was not issued.");
  await redeemInitialInvite(db, { token: invite.token, participantId: second.id });
  return { pairId: first.pair.id, first: first.creator, second };
}

async function createTestQuestion() {
  return createQuestion(db, {
    text: "A first immutable question",
    category: "fun",
    relationshipFit: "both",
    modeFit: "both",
    intensity: "light",
  });
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
  pairIds.length = 0;
  authUserIds.length = 0;
});

afterAll(async () => {
  await db.$client.end();
});

describe("Ticket 06 logical Questions and immutable revisions", () => {
  test("creates one logical Question, revises immutable content, and switches current revision", async () => {
    const first = await createTestQuestion();
    const second = await createQuestionRevision(db, {
      questionId: first.question.id,
      text: "A revised immutable question",
      category: "deep",
      relationshipFit: "both",
      modeFit: "private",
      intensity: "deep",
    });

    expect(first.revision.id).not.toBe(second.revision.id);
    expect(second.question.id).toBe(first.question.id);
    expect(first.revision.text).toBe("A first immutable question");
    expect(first.revision.category).toBe("fun");
    expect(first.revision.intensity).toBe("light");
    expect(second.question.currentRevisionId).toBe(second.revision.id);
    expect(
      (
        await db.select().from(questionRevision).where(eq(questionRevision.id, first.revision.id))
      )[0]?.text,
    ).toBe("A first immutable question");
  });

  test("deactivation and withdrawal remove content from new occurrence selection without rewriting revisions", async () => {
    const { question: logicalQuestion, revision } = await createTestQuestion();
    const { creator, pair: pairRecord } = await createUnclaimedPair();
    await withdrawQuestionRevision(db, revision.id);
    expect(
      (
        await listEligibleTogetherQuestions(db, {
          participantId: creator.id,
          pairId: pairRecord.id,
          category: "fun",
        })
      ).some((item) => item.id === logicalQuestion.id),
    ).toBe(false);

    const activeRevision = await createQuestionRevision(db, {
      questionId: logicalQuestion.id,
      text: "A replacement current question",
      category: "fun",
      relationshipFit: "both",
      modeFit: "together",
      intensity: "medium",
    });
    await deactivateQuestion(db, logicalQuestion.id);
    expect(
      (
        await listEligibleTogetherQuestions(db, {
          participantId: creator.id,
          pairId: pairRecord.id,
          category: "fun",
        })
      ).some((item) => item.id === logicalQuestion.id),
    ).toBe(false);
    expect(
      (await db.select().from(questionRevision).where(eq(questionRevision.id, revision.id)))[0]
        ?.text,
    ).toBe("A first immutable question");
    expect(activeRevision.revision.questionId).toBe(logicalQuestion.id);
  });

  test("Together shown-question records keep their exact revision while logical identity stays stable", async () => {
    const { question: logicalQuestion, revision } = await createTestQuestion();
    const { creator, pair: pairRecord } = await createUnclaimedPair();
    const [session] = await db
      .insert(togetherSession)
      .values({ pairId: pairRecord.id, category: "fun", startedByParticipantId: creator.id })
      .returning();
    if (!session) throw new Error("Together test session was not created.");
    await db.insert(togetherSessionQuestion).values({
      sessionId: session.id,
      questionId: logicalQuestion.id,
      questionRevisionId: revision.id,
      position: 1,
    });

    await createQuestionRevision(db, {
      questionId: logicalQuestion.id,
      text: "Future wording",
      category: "fun",
      relationshipFit: "both",
      modeFit: "both",
      intensity: "deep",
    });
    const view = await getTogetherSessionForParticipant(db, {
      participantId: creator.id,
      pairId: pairRecord.id,
      sessionId: session.id,
    });
    expect(view.question).toMatchObject({
      id: logicalQuestion.id,
      questionRevisionId: revision.id,
      text: "A first immutable question",
    });
  });

  test("Private Rounds keep their exact revision while later revisions become current", async () => {
    const { question: logicalQuestion, revision } = await createTestQuestion();
    const { pairId, first, second } = await createJoinedPair();
    const era = (
      await db
        .select()
        .from(pairMembershipEra)
        .where(and(eq(pairMembershipEra.pairId, pairId), isNull(pairMembershipEra.endedAt)))
    )[0];
    if (!era) throw new Error("Private test era was not created.");
    const [conversation] = await db
      .insert(privateConversation)
      .values({
        pairId,
        category: "fun",
        createdByParticipantId: first.id,
        membershipEraId: era.id,
      })
      .returning();
    if (!conversation) throw new Error("Private test conversation was not created.");
    const [round] = await db
      .insert(privateRound)
      .values({
        pairId,
        conversationId: conversation.id,
        questionId: logicalQuestion.id,
        questionRevisionId: revision.id,
        questionNumber: 1,
        initiatorParticipantId: first.id,
      })
      .returning();
    if (!round) throw new Error("Private test round was not created.");

    await createQuestionRevision(db, {
      questionId: logicalQuestion.id,
      text: "Future private wording",
      category: "fun",
      relationshipFit: "both",
      modeFit: "private",
      intensity: "deep",
    });
    const view = await getPrivateRoundForParticipant(db, {
      participantId: second.id,
      pairId,
      roundId: round.id,
    });
    expect(view.question).toMatchObject({
      id: logicalQuestion.id,
      questionRevisionId: revision.id,
      text: "A first immutable question",
    });
  });
});
