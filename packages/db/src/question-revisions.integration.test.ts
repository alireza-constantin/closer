import { randomUUID } from "node:crypto";

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import "./test-env";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";

const { createDb } = await import("./index");
const {
  activateQuestion,
  createAdminQuestion,
  createAdminQuestionRevision,
  createPairForParticipant,
  deactivateQuestion,
  findDuplicateQuestionsByText,
  getPrivateRoundForParticipant,
  getTogetherSessionForParticipant,
  issueOrReuseInitialInvite,
  listEligibleTogetherQuestions,
  redeemInitialInvite,
  resolveOrCreateParticipant,
  reactivateQuestion,
  restoreAdminQuestionRevision,
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
  questionLifecycleEvent,
  questionRevision,
  togetherSession,
  togetherSessionQuestion,
} = await import("./schema/closer");
const { user } = await import("./schema/auth");

const db = createDb();
const authUserIds: string[] = [];
const pairIds: string[] = [];
const questionIds: string[] = [];

async function expectDatabaseFailure(query: PromiseLike<unknown>) {
  try {
    await query;
  } catch {
    return;
  }
  throw new Error("Expected the database query to fail.");
}

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

async function createAdminActor() {
  const id = randomUUID();
  authUserIds.push(id);
  await db.insert(user).values({
    id,
    name: "Question test Admin",
    email: `${id}@question.closer.invalid`,
    isAnonymous: false,
  });
  return id;
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
  const adminUserId = await createAdminActor();
  const created = await createAdminQuestion(db, {
    text: "A first immutable question",
    category: "fun",
    relationshipFit: "both",
    modeFit: "both",
    intensity: "light",
    adminUserId,
  });
  questionIds.push(created.question.id);
  await activateQuestion(db, { questionId: created.question.id, adminUserId });
  return { ...created, adminUserId };
}

afterEach(async () => {
  if (pairIds.length) {
    await db.delete(initialInvite).where(inArray(initialInvite.pairId, pairIds));
    await db.delete(privateConversation).where(inArray(privateConversation.pairId, pairIds));
    await db.delete(pairMembershipEra).where(inArray(pairMembershipEra.pairId, pairIds));
    await db.delete(pairMembership).where(inArray(pairMembership.pairId, pairIds));
    await db.delete(pair).where(inArray(pair.id, pairIds));
  }
  if (questionIds.length) {
    await db
      .delete(questionLifecycleEvent)
      .where(inArray(questionLifecycleEvent.questionId, questionIds));
    await db
      .update(question)
      .set({ currentRevisionId: null })
      .where(inArray(question.id, questionIds));
    await db.delete(questionRevision).where(inArray(questionRevision.questionId, questionIds));
    await db.delete(question).where(inArray(question.id, questionIds));
  }
  if (authUserIds.length) {
    await db.delete(participant).where(inArray(participant.authUserId, authUserIds));
    await db.delete(user).where(inArray(user.id, authUserIds));
  }
  pairIds.length = 0;
  authUserIds.length = 0;
  questionIds.length = 0;
});

afterAll(async () => {
  await db.$client.end();
});

describe("Ticket 06 logical Questions and immutable revisions", () => {
  test("creates one logical Question, revises immutable content, and switches current revision", async () => {
    const first = await createTestQuestion();
    const second = await createAdminQuestionRevision(db, {
      questionId: first.question.id,
      expectedCurrentRevisionId: first.revision.id,
      adminUserId: first.adminUserId,
      text: "A revised immutable question",
      category: "deep",
      relationshipFit: "both",
      modeFit: "private",
      intensity: "deep",
    });

    expect(first.revision.id).not.toBe(second.revision.id);
    expect(first.revision.revisionNumber).toBe(1);
    expect(second.revision.revisionNumber).toBe(2);
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

  test("serializes concurrent revisions and rejects the stale writer", async () => {
    const first = await createTestQuestion();
    const results = await Promise.allSettled([
      createAdminQuestionRevision(db, {
        questionId: first.question.id,
        expectedCurrentRevisionId: first.revision.id,
        adminUserId: first.adminUserId,
        text: "Concurrent revision A",
        category: "fun",
        relationshipFit: "both",
        modeFit: "both",
        intensity: "light",
      }),
      createAdminQuestionRevision(db, {
        questionId: first.question.id,
        expectedCurrentRevisionId: first.revision.id,
        adminUserId: first.adminUserId,
        text: "Concurrent revision B",
        category: "deep",
        relationshipFit: "both",
        modeFit: "both",
        intensity: "medium",
      }),
    ]);

    const committed = results.filter(
      (
        result,
      ): result is PromiseFulfilledResult<
        Awaited<ReturnType<typeof createAdminQuestionRevision>>
      > => result.status === "fulfilled",
    );
    const rejected = results.filter((result) => result.status === "rejected");
    expect(committed).toHaveLength(1);
    expect(committed[0]?.value.revision.revisionNumber).toBe(2);
    expect(rejected).toMatchObject([{ reason: { code: "QUESTION_REVISION_CONFLICT" } }]);
    const currentQuestion = (
      await db.select().from(question).where(eq(question.id, first.question.id))
    )[0];
    expect(committed[0]?.value.revision.id === currentQuestion?.currentRevisionId).toBe(true);
  });

  test("Admin creation starts Inactive and lifecycle history distinguishes publish from reactivate", async () => {
    const adminUserId = await createAdminActor();
    const created = await createAdminQuestion(db, {
      text: "An unpublished Admin question",
      category: "fun",
      relationshipFit: "both",
      modeFit: "both",
      intensity: "light",
      adminUserId,
    });
    questionIds.push(created.question.id);

    expect(created.question.isActive).toBe(false);
    expect(created.revision).toMatchObject({
      revisionNumber: 1,
      createdByAdminUserId: adminUserId,
    });
    await activateQuestion(db, { questionId: created.question.id, adminUserId });
    await deactivateQuestion(db, {
      questionId: created.question.id,
      adminUserId,
      reason: "Temporarily pause selection",
    });
    await reactivateQuestion(db, { questionId: created.question.id, adminUserId });

    const events = await db
      .select({ action: questionLifecycleEvent.action })
      .from(questionLifecycleEvent)
      .where(eq(questionLifecycleEvent.questionId, created.question.id))
      .orderBy(asc(questionLifecycleEvent.occurredAt), asc(questionLifecycleEvent.id));
    expect(events.map((event) => event.action)).toEqual([
      "activated",
      "deactivated",
      "reactivated",
    ]);
    await expect(
      activateQuestion(db, { questionId: created.question.id, adminUserId }),
    ).rejects.toMatchObject({ code: "QUESTION_STATE_CONFLICT" });
  });

  test("Admin revisions use stale-write protection and restore as a new later revision", async () => {
    const adminUserId = await createAdminActor();
    const created = await createAdminQuestion(db, {
      text: "Original Admin wording",
      category: "fun",
      relationshipFit: "both",
      modeFit: "together",
      intensity: "light",
      adminUserId,
    });
    questionIds.push(created.question.id);
    const revision = await createAdminQuestionRevision(db, {
      questionId: created.question.id,
      expectedCurrentRevisionId: created.revision.id,
      adminUserId,
      text: "Second Admin wording",
      category: "deep",
      relationshipFit: "both",
      modeFit: "private",
      intensity: "deep",
    });

    expect(revision.revision).toMatchObject({
      revisionNumber: 2,
      createdByAdminUserId: adminUserId,
    });
    expect(revision.question.isActive).toBe(false);
    await expect(
      createAdminQuestionRevision(db, {
        questionId: created.question.id,
        expectedCurrentRevisionId: created.revision.id,
        adminUserId,
        text: "Stale Admin wording",
        category: "deep",
        relationshipFit: "both",
        modeFit: "both",
        intensity: "medium",
      }),
    ).rejects.toMatchObject({ code: "QUESTION_REVISION_CONFLICT" });

    const restored = await restoreAdminQuestionRevision(db, {
      questionId: created.question.id,
      sourceRevisionId: created.revision.id,
      expectedCurrentRevisionId: revision.revision.id,
      adminUserId,
    });
    expect(restored.revision).toMatchObject({
      revisionNumber: 3,
      createdByAdminUserId: adminUserId,
      text: created.revision.text,
      category: created.revision.category,
      relationshipFit: created.revision.relationshipFit,
      modeFit: created.revision.modeFit,
      intensity: created.revision.intensity,
    });
    expect(restored.question.currentRevisionId).toBe(restored.revision.id);
    expect(restored.revision.id).not.toBe(created.revision.id);
    expect(restored.question.isActive).toBe(false);
  });

  test("activation waits for a safe current revision after withdrawal", async () => {
    const adminUserId = await createAdminActor();
    const created = await createAdminQuestion(db, {
      text: "Question awaiting safety review",
      category: "fun",
      relationshipFit: "both",
      modeFit: "both",
      intensity: "light",
      adminUserId,
    });
    questionIds.push(created.question.id);
    await withdrawQuestionRevision(db, {
      questionRevisionId: created.revision.id,
      adminUserId,
      reason: "Safety review required",
    });
    await expect(
      activateQuestion(db, { questionId: created.question.id, adminUserId }),
    ).rejects.toMatchObject({ code: "QUESTION_REVISION_WITHDRAWN" });

    const replacement = await createAdminQuestionRevision(db, {
      questionId: created.question.id,
      expectedCurrentRevisionId: created.revision.id,
      adminUserId,
      text: "Reviewed replacement wording",
      category: "fun",
      relationshipFit: "both",
      modeFit: "both",
      intensity: "medium",
    });
    expect(replacement.question.isActive).toBe(false);
    await activateQuestion(db, { questionId: created.question.id, adminUserId });
    expect(
      (await db.select().from(question).where(eq(question.id, created.question.id)))[0]?.isActive,
    ).toBe(true);
  });

  test("withdrawal is idempotent and preserves the first actor, time, and reason", async () => {
    const firstAdminUserId = await createAdminActor();
    const secondAdminUserId = await createAdminActor();
    const created = await createAdminQuestion(db, {
      text: "Question with a first withdrawal",
      category: "fun",
      relationshipFit: "both",
      modeFit: "both",
      intensity: "light",
      adminUserId: firstAdminUserId,
    });
    questionIds.push(created.question.id);

    const first = await withdrawQuestionRevision(db, {
      questionRevisionId: created.revision.id,
      adminUserId: firstAdminUserId,
      reason: "Initial safety reason",
    });
    const repeated = await withdrawQuestionRevision(db, {
      questionRevisionId: created.revision.id,
      adminUserId: secondAdminUserId,
      reason: "Later reason must not replace the first",
    });
    const events = await db
      .select()
      .from(questionLifecycleEvent)
      .where(eq(questionLifecycleEvent.revisionId, created.revision.id));

    expect(repeated.withdrawnAt).toEqual(first.withdrawnAt);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      adminUserId: firstAdminUserId,
      reason: "Initial safety reason",
      occurredAt: first.withdrawnAt,
    });
  });

  test("duplicate wording detection trims, collapses whitespace, and ignores case only", async () => {
    const adminUserId = await createAdminActor();
    const first = await createAdminQuestion(db, {
      text: "  Do\twe\nremember?  ",
      category: "fun",
      relationshipFit: "both",
      modeFit: "both",
      intensity: "light",
      adminUserId,
    });
    const second = await createAdminQuestion(db, {
      text: "Do we remember?",
      category: "deep",
      relationshipFit: "both",
      modeFit: "private",
      intensity: "medium",
      adminUserId,
    });
    questionIds.push(first.question.id, second.question.id);

    const matches = await findDuplicateQuestionsByText(db, { text: "do we remember?" });
    expect(matches.map((match) => match.questionId)).toEqual([
      first.question.id,
      second.question.id,
    ]);
    expect(
      await findDuplicateQuestionsByText(db, {
        text: "DO WE REMEMBER?",
        excludeQuestionId: first.question.id,
      }),
    ).toMatchObject([{ questionId: second.question.id }]);
    expect(await findDuplicateQuestionsByText(db, { text: "Do we recall?" })).toEqual([]);
  });

  test("database enforces ordinal uniqueness and current-revision ownership", async () => {
    const first = await createTestQuestion();
    const second = await createTestQuestion();

    await expectDatabaseFailure(
      db.insert(questionRevision).values({
        questionId: first.question.id,
        revisionNumber: first.revision.revisionNumber,
        text: "Duplicate ordinal",
        category: "fun",
        relationshipFit: "both",
        modeFit: "both",
        intensity: "light",
      }),
    );

    await expectDatabaseFailure(
      db
        .update(question)
        .set({ currentRevisionId: first.revision.id })
        .where(eq(question.id, second.question.id)),
    );
  });

  test("withdrawal lifecycle records require a reason and a revision owned by the Question", async () => {
    const { question: logicalQuestion, revision } = await createTestQuestion();
    const admin = await createParticipant("Question test Admin");

    await expectDatabaseFailure(
      db.insert(questionLifecycleEvent).values({
        questionId: logicalQuestion.id,
        revisionId: revision.id,
        action: "revision_withdrawn",
        adminUserId: admin.authUserId,
      }),
    );

    await db.insert(questionLifecycleEvent).values({
      questionId: logicalQuestion.id,
      revisionId: revision.id,
      action: "revision_withdrawn",
      adminUserId: admin.authUserId,
      reason: "Safety review",
    });
  });

  test("deactivation and withdrawal remove content from new occurrence selection without rewriting revisions", async () => {
    const { question: logicalQuestion, revision } = await createTestQuestion();
    const { creator, pair: pairRecord } = await createUnclaimedPair();
    const adminUserId = await createAdminActor();
    await withdrawQuestionRevision(db, {
      questionRevisionId: revision.id,
      adminUserId,
      reason: "The wording is unsafe for selection.",
    });
    expect(
      (
        await listEligibleTogetherQuestions(db, {
          participantId: creator.id,
          pairId: pairRecord.id,
          category: "fun",
        })
      ).some((item) => item.id === logicalQuestion.id),
    ).toBe(false);

    const activeRevision = await createAdminQuestionRevision(db, {
      questionId: logicalQuestion.id,
      expectedCurrentRevisionId: revision.id,
      adminUserId,
      text: "A replacement current question",
      category: "fun",
      relationshipFit: "both",
      modeFit: "together",
      intensity: "medium",
    });
    await deactivateQuestion(db, { questionId: logicalQuestion.id, adminUserId });
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
    const { question: logicalQuestion, revision, adminUserId } = await createTestQuestion();
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

    await createAdminQuestionRevision(db, {
      questionId: logicalQuestion.id,
      expectedCurrentRevisionId: revision.id,
      adminUserId,
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
    const { question: logicalQuestion, revision, adminUserId } = await createTestQuestion();
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

    await createAdminQuestionRevision(db, {
      questionId: logicalQuestion.id,
      expectedCurrentRevisionId: revision.id,
      adminUserId,
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
