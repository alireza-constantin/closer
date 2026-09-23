import { createHash, randomUUID } from "node:crypto";

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import "./test-env";

const { createDb } = await import("./index");
const {
  CloserDomainError,
  advanceTogetherSession,
  createAdminQuestion,
  createAdminQuestionRevision,
  activateQuestion,
  createPairForParticipant,
  endTogetherSession,
  getTogetherQuestionPageForParticipant,
  getTogetherSessionPlaybackForParticipant,
  getTogetherSessionForParticipant,
  listEligibleTogetherQuestions,
  issueOrReuseInitialInvite,
  redeemInitialInvite,
  resolveOrCreateParticipant,
  setTogetherSessionLike,
  startTogetherSession,
  withdrawQuestionRevision,
} = await import("./closer");
const {
  pair,
  pairMembership,
  pairMembershipEra,
  participant,
  togetherSession,
  togetherSessionQuestion,
  question,
  questionLifecycleEvent,
  questionRevision,
  privateAnswer,
  privateRound,
} = await import("./schema/closer");
const { user } = await import("./schema/auth");
const { and, eq, inArray } = await import("drizzle-orm");

const db = createDb();
const createdAuthUserIds: string[] = [];
const createdPairIds: string[] = [];
const createdQuestionIds: string[] = [];
const testAdminUserId = "00000000-0000-4000-8000-000000009002";

async function createAnonymousAuthUser(name = "Together test user") {
  const id = randomUUID();
  createdAuthUserIds.push(id);
  await db.insert(user).values({
    id,
    name,
    email: `${id}@test.closer.invalid`,
    isAnonymous: true,
  });
  return id;
}

async function createTestAdminActor() {
  await db
    .insert(user)
    .values({
      id: testAdminUserId,
      name: "Together test Admin actor",
      email: "together-test-admin@closer.invalid",
      isAnonymous: false,
    })
    .onConflictDoNothing();
  return testAdminUserId;
}

async function createParticipant(displayName: string) {
  const authUserId = await createAnonymousAuthUser(displayName);
  return resolveOrCreateParticipant(db, { authUserId, displayName });
}

async function issueFreshInitialInvite(participantId: string, pairId: string) {
  const invite = await issueOrReuseInitialInvite(db, { participantId, pairId });
  if (invite.state !== "issued") throw new Error("Fresh pair unexpectedly had an invitation.");
  return invite.token;
}

async function createPair(relationshipType: "partner" | "friend" = "partner", joined = true) {
  const creator = await createParticipant("Creator");
  const result = await createPairForParticipant(db, {
    participantId: creator.id,
    intendedPersonName: "Other person",
    relationshipType,
  });
  createdPairIds.push(result.pair.id);
  if (!joined) return { ...result, creator, invitee: null };

  const token = await issueFreshInitialInvite(creator.id, result.pair.id);
  const invitee = await createParticipant("Other");
  await redeemInitialInvite(db, { token, participantId: invitee.id });
  return { ...result, creator, invitee };
}

async function createTogetherQuestion(input: {
  category: "fun" | "deep" | "memories" | "relationship" | "friendship";
  intensity: "light" | "medium" | "deep";
}) {
  const adminUserId = await createTestAdminActor();
  const created = await createAdminQuestion(db, {
    text: `Ticket 07 ${input.category} ${input.intensity} ${randomUUID()}`,
    category: input.category,
    relationshipFit:
      input.category === "relationship"
        ? "partner"
        : input.category === "friendship"
          ? "friend"
          : "both",
    modeFit: "together",
    intensity: input.intensity,
    adminUserId,
  });
  createdQuestionIds.push(created.question.id);
  await activateQuestion(db, { questionId: created.question.id, adminUserId });
  return { ...created, adminUserId };
}

async function captureError(promise: Promise<unknown>) {
  return promise.then(
    () => null,
    (error: unknown) => error,
  );
}

afterEach(async () => {
  if (createdPairIds.length > 0) {
    await db.delete(togetherSession).where(inArray(togetherSession.pairId, createdPairIds));
    await db.delete(pairMembershipEra).where(inArray(pairMembershipEra.pairId, createdPairIds));
    await db.delete(pairMembership).where(inArray(pairMembership.pairId, createdPairIds));
    await db.delete(pair).where(inArray(pair.id, createdPairIds));
  }
  await db
    .delete(questionLifecycleEvent)
    .where(eq(questionLifecycleEvent.adminUserId, testAdminUserId));
  if (createdQuestionIds.length > 0) {
    await db
      .update(question)
      .set({ currentRevisionId: null })
      .where(inArray(question.id, createdQuestionIds));
    await db
      .delete(questionRevision)
      .where(inArray(questionRevision.questionId, createdQuestionIds));
    await db.delete(question).where(inArray(question.id, createdQuestionIds));
  }
  if (createdAuthUserIds.length > 0) {
    await db.delete(participant).where(inArray(participant.authUserId, createdAuthUserIds));
    await db.delete(user).where(inArray(user.id, createdAuthUserIds));
  }
  createdPairIds.length = 0;
  createdAuthUserIds.length = 0;
  createdQuestionIds.length = 0;
});

afterAll(async () => {
  await db.$client.end();
});

describe("Closer Slice 02 Together sessions", () => {
  test("partner and friend pairs receive only their valid Together categories", async () => {
    const partner = await createPair("partner");
    const friend = await createPair("friend");

    const partnerCategories = ["fun", "deep", "memories", "relationship"] as const;
    const friendCategories = ["fun", "deep", "memories", "friendship"] as const;
    for (const category of partnerCategories) {
      const started = await startTogetherSession(db, {
        pairId: partner.pair.id,
        participantId: partner.creator.id,
        category,
        clientRequestId: randomUUID(),
      });
      const view = await getTogetherSessionForParticipant(db, {
        pairId: partner.pair.id,
        participantId: partner.creator.id,
        sessionId: started.sessionId,
      });
      expect(view).toMatchObject({ category, relationshipType: "partner" });
      await endTogetherSession(db, {
        pairId: partner.pair.id,
        participantId: partner.creator.id,
        sessionId: started.sessionId,
      });
    }
    for (const category of friendCategories) {
      const started = await startTogetherSession(db, {
        pairId: friend.pair.id,
        participantId: friend.creator.id,
        category,
        clientRequestId: randomUUID(),
      });
      expect(
        await getTogetherSessionForParticipant(db, {
          pairId: friend.pair.id,
          participantId: friend.creator.id,
          sessionId: started.sessionId,
        }),
      ).toMatchObject({ category, relationshipType: "friend" });
      await endTogetherSession(db, {
        pairId: friend.pair.id,
        participantId: friend.creator.id,
        sessionId: started.sessionId,
      });
    }
  });

  test("a Partner Pair cannot start Friendship from a manually opened Friend picker", async () => {
    const partner = await createPair("partner");

    expect(
      await captureError(
        startTogetherSession(db, {
          pairId: partner.pair.id,
          participantId: partner.creator.id,
          category: "friendship",
          clientRequestId: randomUUID(),
        }),
      ),
    ).toMatchObject({ code: "QUESTION_UNAVAILABLE" });
  });

  test("a Friend Pair cannot start Relationship from a manually opened Partner picker", async () => {
    const friend = await createPair("friend");

    expect(
      await captureError(
        startTogetherSession(db, {
          pairId: friend.pair.id,
          participantId: friend.creator.id,
          category: "relationship",
          clientRequestId: randomUUID(),
        }),
      ),
    ).toMatchObject({ code: "QUESTION_UNAVAILABLE" });
  });

  test("Together can start from the creator phone before the second member joins", async () => {
    const pair = await createPair("partner", false);
    const started = await startTogetherSession(db, {
      pairId: pair.pair.id,
      participantId: pair.creator.id,
      category: "deep",
      clientRequestId: randomUUID(),
    });
    expect(started.questionId).toBeTruthy();
  });

  test("initial claim closes the pre-claim session, starts the first era, and does not grant its history to the claimant", async () => {
    const pair = await createPair("partner", false);
    const started = await startTogetherSession(db, {
      pairId: pair.pair.id,
      participantId: pair.creator.id,
      category: "deep",
      clientRequestId: randomUUID(),
    });
    const token = await issueFreshInitialInvite(pair.creator.id, pair.pair.id);
    const claimant = await createParticipant("Claimant");

    const claim = await redeemInitialInvite(db, { token, participantId: claimant.id });
    expect(claim.membershipEraId).toBeTruthy();
    expect(
      (
        await getTogetherSessionForParticipant(db, {
          pairId: pair.pair.id,
          participantId: pair.creator.id,
          sessionId: started.sessionId,
        })
      ).endedAt,
    ).not.toBeNull();
    expect(
      await captureError(
        getTogetherSessionForParticipant(db, {
          pairId: pair.pair.id,
          participantId: claimant.id,
          sessionId: started.sessionId,
        }),
      ),
    ).toMatchObject({ code: "TOGETHER_SESSION_NOT_FOUND" });
    expect(
      await captureError(
        advanceTogetherSession(db, {
          pairId: pair.pair.id,
          participantId: pair.creator.id,
          sessionId: started.sessionId,
          action: "next",
          clientRequestId: randomUUID(),
        }),
      ),
    ).toMatchObject({ code: "TOGETHER_SESSION_ENDED" });
  });

  test("Private-only questions are never selected for Together", async () => {
    const pair = await createPair("partner");
    const eligible = await listEligibleTogetherQuestions(db, {
      pairId: pair.pair.id,
      participantId: pair.creator.id,
      category: "deep",
    });
    expect(eligible.length).toBeGreaterThan(2);

    const started = await startTogetherSession(db, {
      pairId: pair.pair.id,
      participantId: pair.creator.id,
      category: "deep",
      clientRequestId: randomUUID(),
    });
    const selected = await db
      .select({ modeFit: questionRevision.modeFit })
      .from(question)
      .innerJoin(questionRevision, eq(question.currentRevisionId, questionRevision.id))
      .where(eq(question.id, started.questionId));
    expect(selected[0]?.modeFit).not.toBe("private");
  });

  test("starting a session persists the selected category and first shown question", async () => {
    const pair = await createPair("partner");
    const started = await startTogetherSession(db, {
      pairId: pair.pair.id,
      participantId: pair.creator.id,
      category: "deep",
      clientRequestId: randomUUID(),
    });
    const sessions = await db
      .select()
      .from(togetherSession)
      .where(eq(togetherSession.id, started.sessionId));
    const cards = await db
      .select()
      .from(togetherSessionQuestion)
      .where(eq(togetherSessionQuestion.sessionId, started.sessionId));
    expect(sessions[0]).toMatchObject({
      pairId: pair.pair.id,
      category: "deep",
      startedByParticipantId: pair.creator.id,
      endedAt: null,
    });
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      questionId: started.questionId,
      position: 1,
      advancedAt: null,
      skippedAt: null,
    });
  });

  test("a fresh session starts with a light preference and persists an injectable selection seed", async () => {
    const pair = await createPair("partner");
    const selectionSeed = "ticket-07-light-seed";
    const started = await startTogetherSession(db, {
      pairId: pair.pair.id,
      participantId: pair.creator.id,
      category: "fun",
      clientRequestId: randomUUID(),
      selectionSeed,
    });

    const session = (
      await db.select().from(togetherSession).where(eq(togetherSession.id, started.sessionId))
    )[0];
    const view = await getTogetherSessionForParticipant(db, {
      pairId: pair.pair.id,
      participantId: pair.creator.id,
      sessionId: started.sessionId,
    });
    expect(session?.selectionSeed).toBe(selectionSeed);
    expect(view.question?.intensity).toBe("light");
  });

  test("Next alone drives the two-light, two-medium, then deep-preferred ramp while Skip and Like do not", async () => {
    const pair = await createPair("friend");
    await Promise.all([
      createTogetherQuestion({ category: "friendship", intensity: "light" }),
      createTogetherQuestion({ category: "friendship", intensity: "light" }),
      createTogetherQuestion({ category: "friendship", intensity: "light" }),
      createTogetherQuestion({ category: "friendship", intensity: "medium" }),
      createTogetherQuestion({ category: "friendship", intensity: "medium" }),
      createTogetherQuestion({ category: "friendship", intensity: "deep" }),
    ]);
    const started = await startTogetherSession(db, {
      pairId: pair.pair.id,
      participantId: pair.creator.id,
      category: "friendship",
      clientRequestId: randomUUID(),
      selectionSeed: "ticket-07-ramp",
    });
    const intensity = async () =>
      (
        await getTogetherSessionForParticipant(db, {
          pairId: pair.pair.id,
          participantId: pair.creator.id,
          sessionId: started.sessionId,
        })
      ).question?.intensity;

    expect(await intensity()).toBe("light");
    await setTogetherSessionLike(db, {
      pairId: pair.pair.id,
      participantId: pair.creator.id,
      sessionId: started.sessionId,
      liked: true,
    });
    expect(await intensity()).toBe("light");
    await advanceTogetherSession(db, {
      pairId: pair.pair.id,
      participantId: pair.creator.id,
      sessionId: started.sessionId,
      action: "skip",
      clientRequestId: randomUUID(),
    });
    expect(await intensity()).toBe("light");
    await advanceTogetherSession(db, {
      pairId: pair.pair.id,
      participantId: pair.creator.id,
      sessionId: started.sessionId,
      action: "next",
      clientRequestId: randomUUID(),
    });
    expect(await intensity()).toBe("light");
    await advanceTogetherSession(db, {
      pairId: pair.pair.id,
      participantId: pair.creator.id,
      sessionId: started.sessionId,
      action: "next",
      clientRequestId: randomUUID(),
    });
    expect(await intensity()).toBe("medium");
    await advanceTogetherSession(db, {
      pairId: pair.pair.id,
      participantId: pair.creator.id,
      sessionId: started.sessionId,
      action: "next",
      clientRequestId: randomUUID(),
    });
    expect(await intensity()).toBe("medium");
    await advanceTogetherSession(db, {
      pairId: pair.pair.id,
      participantId: pair.creator.id,
      sessionId: started.sessionId,
      action: "next",
      clientRequestId: randomUUID(),
    });
    expect(await intensity()).toBe("deep");
    await advanceTogetherSession(db, {
      pairId: pair.pair.id,
      participantId: pair.creator.id,
      sessionId: started.sessionId,
      action: "next",
      clientRequestId: randomUUID(),
    });
    expect(await intensity()).toBe("deep");
  });

  test("each intensity target uses its documented fallback order", async () => {
    const partner = await createPair("partner");
    const friend = await createPair("friend");
    await Promise.all([
      createTogetherQuestion({ category: "relationship", intensity: "light" }),
      createTogetherQuestion({ category: "memories", intensity: "light" }),
      createTogetherQuestion({ category: "memories", intensity: "light" }),
      createTogetherQuestion({ category: "memories", intensity: "light" }),
      createTogetherQuestion({ category: "memories", intensity: "medium" }),
      createTogetherQuestion({ category: "memories", intensity: "medium" }),
    ]);

    const lightFallback = await startTogetherSession(db, {
      pairId: partner.pair.id,
      participantId: partner.creator.id,
      category: "relationship",
      clientRequestId: randomUUID(),
      selectionSeed: "ticket-07-light-fallback",
    });
    expect(
      (
        await getTogetherSessionForParticipant(db, {
          pairId: partner.pair.id,
          participantId: partner.creator.id,
          sessionId: lightFallback.sessionId,
        })
      ).question?.intensity,
    ).toBe("light");
    await advanceTogetherSession(db, {
      pairId: partner.pair.id,
      participantId: partner.creator.id,
      sessionId: lightFallback.sessionId,
      action: "skip",
      clientRequestId: randomUUID(),
    });
    expect(
      (
        await getTogetherSessionForParticipant(db, {
          pairId: partner.pair.id,
          participantId: partner.creator.id,
          sessionId: lightFallback.sessionId,
        })
      ).question?.intensity,
    ).toBe("light");
    await advanceTogetherSession(db, {
      pairId: partner.pair.id,
      participantId: partner.creator.id,
      sessionId: lightFallback.sessionId,
      action: "skip",
      clientRequestId: randomUUID(),
    });
    expect(
      (
        await getTogetherSessionForParticipant(db, {
          pairId: partner.pair.id,
          participantId: partner.creator.id,
          sessionId: lightFallback.sessionId,
        })
      ).question?.intensity,
    ).toBe("medium");
    await advanceTogetherSession(db, {
      pairId: partner.pair.id,
      participantId: partner.creator.id,
      sessionId: lightFallback.sessionId,
      action: "skip",
      clientRequestId: randomUUID(),
    });
    expect(
      (
        await getTogetherSessionForParticipant(db, {
          pairId: partner.pair.id,
          participantId: partner.creator.id,
          sessionId: lightFallback.sessionId,
        })
      ).question?.intensity,
    ).toBe("deep");

    const mediumFallback = await startTogetherSession(db, {
      pairId: friend.pair.id,
      participantId: friend.creator.id,
      category: "friendship",
      clientRequestId: randomUUID(),
      selectionSeed: "ticket-07-medium-fallback",
    });
    await advanceTogetherSession(db, {
      pairId: friend.pair.id,
      participantId: friend.creator.id,
      sessionId: mediumFallback.sessionId,
      action: "next",
      clientRequestId: randomUUID(),
    });
    await advanceTogetherSession(db, {
      pairId: friend.pair.id,
      participantId: friend.creator.id,
      sessionId: mediumFallback.sessionId,
      action: "next",
      clientRequestId: randomUUID(),
    });
    expect(
      (
        await getTogetherSessionForParticipant(db, {
          pairId: friend.pair.id,
          participantId: friend.creator.id,
          sessionId: mediumFallback.sessionId,
        })
      ).question?.intensity,
    ).toBe("deep");

    const deepFallback = await startTogetherSession(db, {
      pairId: partner.pair.id,
      participantId: partner.creator.id,
      category: "memories",
      clientRequestId: randomUUID(),
      selectionSeed: "ticket-07-deep-fallback",
    });
    // The legacy seed contributes one Deep question; consume it before asserting fallback to Medium.
    for (let index = 0; index < 5; index += 1) {
      await advanceTogetherSession(db, {
        pairId: partner.pair.id,
        participantId: partner.creator.id,
        sessionId: deepFallback.sessionId,
        action: "next",
        clientRequestId: randomUUID(),
      });
    }
    expect(
      (
        await getTogetherSessionForParticipant(db, {
          pairId: partner.pair.id,
          participantId: partner.creator.id,
          sessionId: deepFallback.sessionId,
        })
      ).question?.intensity,
    ).toBe("medium");
  });

  test("a seed produces reproducible Session-local ordering and a new session resets the consumed set", async () => {
    const pair = await createPair("friend");
    const first = await startTogetherSession(db, {
      pairId: pair.pair.id,
      participantId: pair.creator.id,
      category: "friendship",
      clientRequestId: randomUUID(),
      selectionSeed: "ticket-07-repeatable",
    });
    const second = await startTogetherSession(db, {
      pairId: pair.pair.id,
      participantId: pair.creator.id,
      category: "friendship",
      clientRequestId: randomUUID(),
      selectionSeed: "ticket-07-repeatable",
    });
    expect(first.questionId).toBe(second.questionId);
    await advanceTogetherSession(db, {
      pairId: pair.pair.id,
      participantId: pair.creator.id,
      sessionId: first.sessionId,
      action: "next",
      clientRequestId: randomUUID(),
    });
    await advanceTogetherSession(db, {
      pairId: pair.pair.id,
      participantId: pair.creator.id,
      sessionId: second.sessionId,
      action: "next",
      clientRequestId: randomUUID(),
    });
    expect(
      (
        await getTogetherSessionForParticipant(db, {
          pairId: pair.pair.id,
          participantId: pair.creator.id,
          sessionId: first.sessionId,
        })
      ).question?.id,
    ).toBe(
      (
        await getTogetherSessionForParticipant(db, {
          pairId: pair.pair.id,
          participantId: pair.creator.id,
          sessionId: second.sessionId,
        })
      ).question?.id,
    );
  });

  test("a later revision cannot repeat a consumed logical Question and never rewrites its shown card", async () => {
    const pair = await createPair("partner");
    const started = await startTogetherSession(db, {
      pairId: pair.pair.id,
      participantId: pair.creator.id,
      category: "fun",
      clientRequestId: randomUUID(),
      selectionSeed: "ticket-07-revision",
    });
    const original = await getTogetherSessionForParticipant(db, {
      pairId: pair.pair.id,
      participantId: pair.creator.id,
      sessionId: started.sessionId,
    });
    if (!original.question) throw new Error("A Together session should show its first Question.");
    const replacement = await createAdminQuestionRevision(db, {
      questionId: original.question.id,
      expectedCurrentRevisionId: original.question.questionRevisionId,
      adminUserId: await createTestAdminActor(),
      text: "Ticket 07 later wording",
      category: "fun",
      relationshipFit: "both",
      modeFit: "together",
      intensity: "light",
    });

    try {
      expect(
        (
          await getTogetherSessionForParticipant(db, {
            pairId: pair.pair.id,
            participantId: pair.creator.id,
            sessionId: started.sessionId,
          })
        ).question,
      ).toMatchObject({
        id: original.question.id,
        questionRevisionId: original.question.questionRevisionId,
        text: original.question.text,
      });
      await advanceTogetherSession(db, {
        pairId: pair.pair.id,
        participantId: pair.creator.id,
        sessionId: started.sessionId,
        action: "next",
        clientRequestId: randomUUID(),
      });
      expect(
        (
          await getTogetherSessionForParticipant(db, {
            pairId: pair.pair.id,
            participantId: pair.creator.id,
            sessionId: started.sessionId,
          })
        ).question?.id,
      ).not.toBe(original.question.id);
    } finally {
      await db
        .update(question)
        .set({ currentRevisionId: original.question.questionRevisionId })
        .where(eq(question.id, original.question.id));
      await db.delete(questionRevision).where(eq(questionRevision.id, replacement.revision.id));
    }
  });

  test("Next stays in the same session and category", async () => {
    const pair = await createPair("partner");
    const started = await startTogetherSession(db, {
      pairId: pair.pair.id,
      participantId: pair.creator.id,
      category: "deep",
      clientRequestId: randomUUID(),
    });
    const advanced = await advanceTogetherSession(db, {
      pairId: pair.pair.id,
      participantId: pair.creator.id,
      sessionId: started.sessionId,
      action: "next",
      clientRequestId: randomUUID(),
    });
    expect(advanced.kind).toBe("QUESTION");
    const view = await getTogetherSessionForParticipant(db, {
      pairId: pair.pair.id,
      participantId: pair.creator.id,
      sessionId: started.sessionId,
    });
    expect(view).toMatchObject({
      id: started.sessionId,
      category: "deep",
      question: { category: "deep" },
    });
    expect(view.question?.id).not.toBe(started.questionId);
  });

  test("Skip records the current card and stays in the same session/category", async () => {
    const pair = await createPair("partner");
    const started = await startTogetherSession(db, {
      pairId: pair.pair.id,
      participantId: pair.creator.id,
      category: "deep",
      clientRequestId: randomUUID(),
    });
    await advanceTogetherSession(db, {
      pairId: pair.pair.id,
      participantId: pair.creator.id,
      sessionId: started.sessionId,
      action: "skip",
      clientRequestId: randomUUID(),
    });
    const cards = await db
      .select()
      .from(togetherSessionQuestion)
      .where(eq(togetherSessionQuestion.sessionId, started.sessionId))
      .orderBy(togetherSessionQuestion.position);
    expect(cards).toHaveLength(2);
    expect(cards[0]?.skippedAt).not.toBeNull();
    expect(cards[0]?.advancedAt).not.toBeNull();
    expect(cards[1]?.advancedAt).toBeNull();
    expect(
      (
        await getTogetherSessionForParticipant(db, {
          pairId: pair.pair.id,
          participantId: pair.creator.id,
          sessionId: started.sessionId,
        })
      ).question?.category,
    ).toBe("deep");
  });

  test("shown questions are not repeated while unused eligible questions remain", async () => {
    const pair = await createPair("partner");
    const eligible = await listEligibleTogetherQuestions(db, {
      pairId: pair.pair.id,
      participantId: pair.creator.id,
      category: "deep",
    });
    const started = await startTogetherSession(db, {
      pairId: pair.pair.id,
      participantId: pair.creator.id,
      category: "deep",
      clientRequestId: randomUUID(),
    });
    const shown = new Set([started.questionId]);
    let exhausted = false;
    for (let index = 0; index < eligible.length + 1; index += 1) {
      const advanced = await advanceTogetherSession(db, {
        pairId: pair.pair.id,
        participantId: pair.creator.id,
        sessionId: started.sessionId,
        action: "next",
        clientRequestId: randomUUID(),
      });
      if (advanced.kind === "EXHAUSTED") {
        exhausted = true;
        break;
      }
      const next = await getTogetherSessionForParticipant(db, {
        pairId: pair.pair.id,
        participantId: pair.creator.id,
        sessionId: started.sessionId,
      });
      expect(next.question).not.toBeNull();
      expect(shown.has(next.question!.id)).toBe(false);
      shown.add(next.question!.id);
    }
    expect(exhausted).toBe(true);
    expect(shown.size).toBe(eligible.length);
  });

  test("Like persists on the shown card, toggles deterministically, and creates no answer", async () => {
    const pair = await createPair("partner");
    const started = await startTogetherSession(db, {
      pairId: pair.pair.id,
      participantId: pair.creator.id,
      category: "deep",
      clientRequestId: randomUUID(),
    });
    const liked = await setTogetherSessionLike(db, {
      pairId: pair.pair.id,
      participantId: pair.creator.id,
      sessionId: started.sessionId,
      liked: true,
    });
    expect(liked.question?.liked).toBe(true);
    const storedLiked = await db
      .select({ likedAt: togetherSessionQuestion.likedAt })
      .from(togetherSessionQuestion)
      .where(
        and(
          eq(togetherSessionQuestion.sessionId, started.sessionId),
          eq(togetherSessionQuestion.questionId, started.questionId),
        ),
      );
    expect(storedLiked[0]?.likedAt).not.toBeNull();

    expect(
      (
        await setTogetherSessionLike(db, {
          pairId: pair.pair.id,
          participantId: pair.creator.id,
          sessionId: started.sessionId,
          liked: false,
        })
      ).question?.liked,
    ).toBe(false);
    const privateAnswers = await db
      .select({ id: privateAnswer.id })
      .from(privateAnswer)
      .innerJoin(privateRound, eq(privateAnswer.roundId, privateRound.id))
      .where(eq(privateRound.pairId, pair.pair.id));
    expect(privateAnswers).toHaveLength(0);
  });

  test("End session persists endedAt and rejects later mutations while repeated end is safe", async () => {
    const pair = await createPair("partner");
    const started = await startTogetherSession(db, {
      pairId: pair.pair.id,
      participantId: pair.creator.id,
      category: "deep",
      clientRequestId: randomUUID(),
    });
    const ended = await endTogetherSession(db, {
      pairId: pair.pair.id,
      participantId: pair.creator.id,
      sessionId: started.sessionId,
    });
    expect(ended.endedAt).not.toBeNull();
    expect(
      (
        await endTogetherSession(db, {
          pairId: pair.pair.id,
          participantId: pair.creator.id,
          sessionId: started.sessionId,
        })
      ).endedAt,
    ).not.toBeNull();
    expect(
      await captureError(
        advanceTogetherSession(db, {
          pairId: pair.pair.id,
          participantId: pair.creator.id,
          sessionId: started.sessionId,
          action: "next",
          clientRequestId: randomUUID(),
        }),
      ),
    ).toMatchObject({ code: "TOGETHER_SESSION_ENDED" });
    expect(
      await captureError(
        setTogetherSessionLike(db, {
          pairId: pair.pair.id,
          participantId: pair.creator.id,
          sessionId: started.sessionId,
          liked: true,
        }),
      ),
    ).toMatchObject({ code: "TOGETHER_SESSION_ENDED" });
  });

  test("an unauthorized third participant cannot read or mutate another pair's session", async () => {
    const pair = await createPair("partner");
    const outsider = await createParticipant("Outsider");
    const started = await startTogetherSession(db, {
      pairId: pair.pair.id,
      participantId: pair.creator.id,
      category: "deep",
      clientRequestId: randomUUID(),
    });
    expect(
      await captureError(
        startTogetherSession(db, {
          pairId: pair.pair.id,
          participantId: outsider.id,
          category: "deep",
          clientRequestId: randomUUID(),
        }),
      ),
    ).toMatchObject({ code: "PAIR_NOT_FOUND" });
    expect(
      await captureError(
        getTogetherSessionForParticipant(db, {
          pairId: pair.pair.id,
          participantId: outsider.id,
          sessionId: started.sessionId,
        }),
      ),
    ).toMatchObject({ code: "PAIR_NOT_FOUND" });
    expect(
      await captureError(
        advanceTogetherSession(db, {
          pairId: pair.pair.id,
          participantId: outsider.id,
          sessionId: started.sessionId,
          action: "next",
          clientRequestId: randomUUID(),
        }),
      ),
    ).toMatchObject({ code: "PAIR_NOT_FOUND" });
  });

  test("shared-device actions have no individual attribution", async () => {
    const pair = await createPair("partner");
    const started = await startTogetherSession(db, {
      pairId: pair.pair.id,
      participantId: pair.creator.id,
      category: "deep",
      clientRequestId: randomUUID(),
    });
    const card = (
      await db
        .select()
        .from(togetherSessionQuestion)
        .where(eq(togetherSessionQuestion.sessionId, started.sessionId))
    )[0];
    expect(card).not.toHaveProperty("participantId");
    expect(
      (await db.select().from(togetherSession).where(eq(togetherSession.id, started.sessionId)))[0],
    ).toMatchObject({ startedByParticipantId: pair.creator.id });
  });

  test("retrying Next with the same request ID advances only once", async () => {
    const pair = await createPair("partner");
    const started = await startTogetherSession(db, {
      pairId: pair.pair.id,
      participantId: pair.creator.id,
      category: "deep",
      clientRequestId: randomUUID(),
    });
    const clientRequestId = randomUUID();
    const [first, retry] = await Promise.all([
      advanceTogetherSession(db, {
        pairId: pair.pair.id,
        participantId: pair.creator.id,
        sessionId: started.sessionId,
        action: "next",
        clientRequestId,
      }),
      advanceTogetherSession(db, {
        pairId: pair.pair.id,
        participantId: pair.creator.id,
        sessionId: started.sessionId,
        action: "next",
        clientRequestId,
      }),
    ]);
    expect(first).toEqual(retry);
    expect(
      await db
        .select()
        .from(togetherSessionQuestion)
        .where(eq(togetherSessionQuestion.sessionId, started.sessionId)),
    ).toHaveLength(2);
  });

  test("concurrent Next and Skip for one shown card commit only one transition", async () => {
    const pair = await createPair("partner");
    const started = await startTogetherSession(db, {
      pairId: pair.pair.id,
      participantId: pair.creator.id,
      category: "deep",
      clientRequestId: randomUUID(),
    });
    const results = await Promise.allSettled([
      advanceTogetherSession(db, {
        pairId: pair.pair.id,
        participantId: pair.creator.id,
        sessionId: started.sessionId,
        action: "next",
        currentQuestionId: started.questionId,
        clientRequestId: randomUUID(),
      }),
      advanceTogetherSession(db, {
        pairId: pair.pair.id,
        participantId: pair.creator.id,
        sessionId: started.sessionId,
        action: "skip",
        currentQuestionId: started.questionId,
        clientRequestId: randomUUID(),
      }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find((result) => result.status === "rejected")).toMatchObject({
      reason: { code: "TOGETHER_ACTION_INVALID" },
    });
    expect(
      await db
        .select()
        .from(togetherSessionQuestion)
        .where(eq(togetherSessionQuestion.sessionId, started.sessionId)),
    ).toHaveLength(2);
  });

  test("multiple completed Together sessions can exist independently", async () => {
    const pair = await createPair("partner");
    const first = await startTogetherSession(db, {
      pairId: pair.pair.id,
      participantId: pair.creator.id,
      category: "deep",
      clientRequestId: randomUUID(),
    });
    const second = await startTogetherSession(db, {
      pairId: pair.pair.id,
      participantId: pair.creator.id,
      category: "fun",
      clientRequestId: randomUUID(),
    });
    await endTogetherSession(db, {
      pairId: pair.pair.id,
      participantId: pair.creator.id,
      sessionId: first.sessionId,
    });
    await endTogetherSession(db, {
      pairId: pair.pair.id,
      participantId: pair.creator.id,
      sessionId: second.sessionId,
    });
    const sessions = await db
      .select()
      .from(togetherSession)
      .where(eq(togetherSession.pairId, pair.pair.id));
    expect(sessions).toHaveLength(2);
    expect(sessions.every((session) => session.endedAt !== null)).toBe(true);
  });

  test("a duplicate Start request resolves to one session", async () => {
    const pair = await createPair("partner");
    const clientRequestId = randomUUID();
    const [first, retry] = await Promise.all([
      startTogetherSession(db, {
        pairId: pair.pair.id,
        participantId: pair.creator.id,
        category: "deep",
        clientRequestId,
      }),
      startTogetherSession(db, {
        pairId: pair.pair.id,
        participantId: pair.creator.id,
        category: "deep",
        clientRequestId,
      }),
    ]);
    expect(first).toEqual(retry);
    expect(
      await db.select().from(togetherSession).where(eq(togetherSession.pairId, pair.pair.id)),
    ).toHaveLength(1);
  });

  test("initial playback exposes at most twenty deterministic, non-consumed Questions per intensity band", async () => {
    const pair = await createPair("partner");
    const questionsByBand = {
      light: await Promise.all(
        Array.from({ length: 21 }, () =>
          createTogetherQuestion({ category: "deep", intensity: "light" }),
        ),
      ),
      medium: await Promise.all(
        Array.from({ length: 21 }, () =>
          createTogetherQuestion({ category: "deep", intensity: "medium" }),
        ),
      ),
      deep: await Promise.all(
        Array.from({ length: 21 }, () =>
          createTogetherQuestion({ category: "deep", intensity: "deep" }),
        ),
      ),
    };
    const selectionSeed = "together-page-window";
    const started = await startTogetherSession(db, {
      pairId: pair.pair.id,
      participantId: pair.creator.id,
      category: "deep",
      clientRequestId: randomUUID(),
      selectionSeed,
    });
    const playback = await getTogetherSessionPlaybackForParticipant(db, {
      pairId: pair.pair.id,
      participantId: pair.creator.id,
      sessionId: started.sessionId,
    });

    expect(playback.pages.light.items).toHaveLength(20);
    expect(playback.pages.medium.items).toHaveLength(20);
    expect(playback.pages.deep.items).toHaveLength(20);
    expect(playback.pages.medium.hasMore).toBe(true);
    expect(playback.pages.light.items.map((item) => item.questionId)).not.toContain(
      started.questionId,
    );
    expect(
      await db
        .select()
        .from(togetherSessionQuestion)
        .where(eq(togetherSessionQuestion.sessionId, started.sessionId)),
    ).toHaveLength(1);

    const eligibleMediumQuestions = await listEligibleTogetherQuestions(db, {
      pairId: pair.pair.id,
      participantId: pair.creator.id,
      category: "deep",
    });
    const expectedMediumOrder = eligibleMediumQuestions
      .filter((eligible) => eligible.intensity === "medium" && eligible.id !== started.questionId)
      .map((eligible) => eligible.id)
      .toSorted((left, right) => {
        const leftRank = createHash("sha256")
          .update(`closer:together:${selectionSeed}:${left}`)
          .digest("hex");
        const rightRank = createHash("sha256")
          .update(`closer:together:${selectionSeed}:${right}`)
          .digest("hex");
        return leftRank.localeCompare(rightRank) || left.localeCompare(right);
      });
    expect(playback.pages.medium.items.map((item) => item.questionId)).toEqual(
      expectedMediumOrder.slice(0, 20),
    );
  });

  test("a Together question cursor continues the same canonical band order without duplicate logical Questions", async () => {
    const pair = await createPair("partner");
    await Promise.all(
      Array.from({ length: 23 }, () =>
        createTogetherQuestion({ category: "deep", intensity: "medium" }),
      ),
    );
    await Promise.all(
      Array.from({ length: 2 }, () =>
        createTogetherQuestion({ category: "deep", intensity: "light" }),
      ),
    );
    const started = await startTogetherSession(db, {
      pairId: pair.pair.id,
      participantId: pair.creator.id,
      category: "deep",
      clientRequestId: randomUUID(),
      selectionSeed: "together-page-cursor",
    });
    const firstPage = await getTogetherQuestionPageForParticipant(db, {
      pairId: pair.pair.id,
      participantId: pair.creator.id,
      sessionId: started.sessionId,
      band: "medium",
    });
    const secondPage = await getTogetherQuestionPageForParticipant(db, {
      pairId: pair.pair.id,
      participantId: pair.creator.id,
      sessionId: started.sessionId,
      band: "medium",
      cursor: firstPage.nextCursor ?? undefined,
    });

    expect(firstPage.items).toHaveLength(20);
    expect(firstPage.hasMore).toBe(true);
    expect(secondPage.items.length).toBeGreaterThan(0);
    expect(secondPage.hasMore).toBe(false);
    expect(
      new Set([...firstPage.items, ...secondPage.items].map((item) => item.questionId)).size,
    ).toBe(firstPage.items.length + secondPage.items.length);
    expect(
      await db
        .select()
        .from(togetherSessionQuestion)
        .where(eq(togetherSessionQuestion.sessionId, started.sessionId)),
    ).toHaveLength(1);
  });

  test("a client cannot force a non-canonical prefetched Question to become the next card", async () => {
    const pair = await createPair("partner");
    await Promise.all(
      Array.from({ length: 3 }, () =>
        createTogetherQuestion({ category: "deep", intensity: "light" }),
      ),
    );
    const started = await startTogetherSession(db, {
      pairId: pair.pair.id,
      participantId: pair.creator.id,
      category: "deep",
      clientRequestId: randomUUID(),
      selectionSeed: "together-stale-client-next",
    });
    const page = await getTogetherQuestionPageForParticipant(db, {
      pairId: pair.pair.id,
      participantId: pair.creator.id,
      sessionId: started.sessionId,
      band: "light",
    });
    const invalidChoice = page.items[1]!;
    const canonicalChoice = page.items[0]!;

    expect(
      await captureError(
        advanceTogetherSession(db, {
          pairId: pair.pair.id,
          participantId: pair.creator.id,
          sessionId: started.sessionId,
          action: "next",
          currentQuestionId: started.questionId,
          nextQuestionId: invalidChoice.questionId,
          nextQuestionRevisionId: invalidChoice.questionRevisionId,
          clientRequestId: randomUUID(),
        }),
      ),
    ).toMatchObject({ code: "TOGETHER_ACTION_INVALID" });
    expect(
      (
        await getTogetherSessionForParticipant(db, {
          pairId: pair.pair.id,
          participantId: pair.creator.id,
          sessionId: started.sessionId,
        })
      ).question?.id,
    ).toBe(started.questionId);

    const transition = await advanceTogetherSession(db, {
      pairId: pair.pair.id,
      participantId: pair.creator.id,
      sessionId: started.sessionId,
      action: "next",
      currentQuestionId: started.questionId,
      nextQuestionId: canonicalChoice.questionId,
      nextQuestionRevisionId: canonicalChoice.questionRevisionId,
      clientRequestId: randomUUID(),
    });
    expect(transition).toMatchObject({ kind: "QUESTION", questionId: canonicalChoice.questionId });
  });

  test("a withdrawn prefetched revision cannot become a newly shown Together occurrence", async () => {
    const pair = await createPair("partner");
    await Promise.all(
      Array.from({ length: 3 }, () =>
        createTogetherQuestion({ category: "deep", intensity: "light" }),
      ),
    );
    const started = await startTogetherSession(db, {
      pairId: pair.pair.id,
      participantId: pair.creator.id,
      category: "deep",
      clientRequestId: randomUUID(),
      selectionSeed: "together-withdrawn-prefetch",
    });
    const page = await getTogetherQuestionPageForParticipant(db, {
      pairId: pair.pair.id,
      participantId: pair.creator.id,
      sessionId: started.sessionId,
      band: "light",
    });
    const withdrawn = page.items[0]!;
    await withdrawQuestionRevision(db, {
      questionRevisionId: withdrawn.questionRevisionId,
      adminUserId: await createTestAdminActor(),
      reason: "Together safety regression fixture.",
    });

    expect(
      await captureError(
        advanceTogetherSession(db, {
          pairId: pair.pair.id,
          participantId: pair.creator.id,
          sessionId: started.sessionId,
          action: "next",
          currentQuestionId: started.questionId,
          nextQuestionId: withdrawn.questionId,
          nextQuestionRevisionId: withdrawn.questionRevisionId,
          clientRequestId: randomUUID(),
        }),
      ),
    ).toMatchObject({ code: "TOGETHER_ACTION_INVALID" });
    expect(
      (
        await getTogetherSessionForParticipant(db, {
          pairId: pair.pair.id,
          participantId: pair.creator.id,
          sessionId: started.sessionId,
        })
      ).question?.id,
    ).toBe(started.questionId);
  });

  test("question pages reject an ended Together Session", async () => {
    const pair = await createPair("partner");
    const started = await startTogetherSession(db, {
      pairId: pair.pair.id,
      participantId: pair.creator.id,
      category: "deep",
      clientRequestId: randomUUID(),
    });
    await endTogetherSession(db, {
      pairId: pair.pair.id,
      participantId: pair.creator.id,
      sessionId: started.sessionId,
    });

    expect(
      await captureError(
        getTogetherQuestionPageForParticipant(db, {
          pairId: pair.pair.id,
          participantId: pair.creator.id,
          sessionId: started.sessionId,
          band: "light",
        }),
      ),
    ).toMatchObject({ code: "TOGETHER_SESSION_ENDED" });
  });
});
