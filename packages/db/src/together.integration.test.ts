import { randomUUID } from "node:crypto";

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import dotenv from "dotenv";

dotenv.config({ path: new URL("../../../apps/web/.env", import.meta.url) });

const { createDb } = await import("./index");
const {
  CloserDomainError,
  advanceTogetherSession,
  createPairForParticipant,
  endTogetherSession,
  getTogetherSessionForParticipant,
  listEligibleTogetherQuestions,
  issueOrReuseInitialInvite,
  redeemInitialInvite,
  resolveOrCreateParticipant,
  setTogetherSessionLike,
  startTogetherSession,
} = await import("./closer");
const { pair, pairMembership, pairMembershipEra, participant, togetherSession, togetherSessionQuestion, question, privateAnswer, privateRound } = await import("./schema/closer");
const { user } = await import("./schema/auth");
const { and, eq, inArray } = await import("drizzle-orm");

const db = createDb();
const createdAuthUserIds: string[] = [];
const createdPairIds: string[] = [];

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

async function createParticipant(displayName: string) {
  const authUserId = await createAnonymousAuthUser(displayName);
  return resolveOrCreateParticipant(db, { authUserId, displayName });
}

async function issueFreshInitialInvite(participantId: string, pairId: string) {
  const invite = await issueOrReuseInitialInvite(db, { participantId, pairId });
  if (invite.state !== "issued") throw new Error("Fresh pair unexpectedly had an invitation.");
  return invite.token;
}

async function createPair(
  relationshipType: "partner" | "friend" = "partner",
  joined = true,
) {
  const creator = await createParticipant("Creator");
  const result = await createPairForParticipant(db, { participantId: creator.id, intendedPersonName: "Other person", relationshipType });
  createdPairIds.push(result.pair.id);
  if (!joined) return { ...result, creator, invitee: null };

  const token = await issueFreshInitialInvite(creator.id, result.pair.id);
  const invitee = await createParticipant("Other");
  await redeemInitialInvite(db, { token, participantId: invitee.id });
  return { ...result, creator, invitee };
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
  if (createdAuthUserIds.length > 0) {
    await db.delete(participant).where(inArray(participant.authUserId, createdAuthUserIds));
    await db.delete(user).where(inArray(user.id, createdAuthUserIds));
  }
  createdPairIds.length = 0;
  createdAuthUserIds.length = 0;
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
      const view = await getTogetherSessionForParticipant(db, { pairId: partner.pair.id, participantId: partner.creator.id, sessionId: started.sessionId });
      expect(view.category).toBe(category);
      await endTogetherSession(db, { pairId: partner.pair.id, participantId: partner.creator.id, sessionId: started.sessionId });
    }
    for (const category of friendCategories) {
      const started = await startTogetherSession(db, {
        pairId: friend.pair.id,
        participantId: friend.creator.id,
        category,
        clientRequestId: randomUUID(),
      });
      expect((await getTogetherSessionForParticipant(db, { pairId: friend.pair.id, participantId: friend.creator.id, sessionId: started.sessionId })).category).toBe(category);
      await endTogetherSession(db, { pairId: friend.pair.id, participantId: friend.creator.id, sessionId: started.sessionId });
    }
  });

  test("relationship-specific categories are rejected for the other relationship", async () => {
    const partner = await createPair("partner");
    const friend = await createPair("friend");

    expect(await captureError(startTogetherSession(db, { pairId: partner.pair.id, participantId: partner.creator.id, category: "friendship", clientRequestId: randomUUID() }))).toMatchObject({ code: "QUESTION_UNAVAILABLE" });
    expect(await captureError(startTogetherSession(db, { pairId: friend.pair.id, participantId: friend.creator.id, category: "relationship", clientRequestId: randomUUID() }))).toMatchObject({ code: "QUESTION_UNAVAILABLE" });
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
    expect((await getTogetherSessionForParticipant(db, {
      pairId: pair.pair.id,
      participantId: pair.creator.id,
      sessionId: started.sessionId,
    })).endedAt).not.toBeNull();
    expect(await captureError(getTogetherSessionForParticipant(db, {
      pairId: pair.pair.id,
      participantId: claimant.id,
      sessionId: started.sessionId,
    }))).toMatchObject({ code: "TOGETHER_SESSION_NOT_FOUND" });
    expect(await captureError(advanceTogetherSession(db, {
      pairId: pair.pair.id,
      participantId: pair.creator.id,
      sessionId: started.sessionId,
      action: "next",
      clientRequestId: randomUUID(),
    }))).toMatchObject({ code: "TOGETHER_SESSION_ENDED" });
  });

  test("Private-only questions are never selected for Together", async () => {
    const pair = await createPair("partner");
    const eligible = await listEligibleTogetherQuestions(db, { pairId: pair.pair.id, participantId: pair.creator.id, category: "deep" });
    expect(eligible.length).toBeGreaterThan(2);

    const started = await startTogetherSession(db, { pairId: pair.pair.id, participantId: pair.creator.id, category: "deep", clientRequestId: randomUUID() });
    const selected = await db.select({ modeFit: question.modeFit }).from(question).where(eq(question.id, started.questionId));
    expect(selected[0]?.modeFit).not.toBe("private");
  });

  test("starting a session persists the selected category and first shown question", async () => {
    const pair = await createPair("partner");
    const started = await startTogetherSession(db, { pairId: pair.pair.id, participantId: pair.creator.id, category: "deep", clientRequestId: randomUUID() });
    const sessions = await db.select().from(togetherSession).where(eq(togetherSession.id, started.sessionId));
    const cards = await db.select().from(togetherSessionQuestion).where(eq(togetherSessionQuestion.sessionId, started.sessionId));
    expect(sessions[0]).toMatchObject({ pairId: pair.pair.id, category: "deep", startedByParticipantId: pair.creator.id, endedAt: null });
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ questionId: started.questionId, position: 1, advancedAt: null, skippedAt: null });
  });

  test("Next stays in the same session and category", async () => {
    const pair = await createPair("partner");
    const started = await startTogetherSession(db, { pairId: pair.pair.id, participantId: pair.creator.id, category: "deep", clientRequestId: randomUUID() });
    const advanced = await advanceTogetherSession(db, { pairId: pair.pair.id, participantId: pair.creator.id, sessionId: started.sessionId, action: "next", clientRequestId: randomUUID() });
    expect(advanced.kind).toBe("QUESTION");
    const view = await getTogetherSessionForParticipant(db, { pairId: pair.pair.id, participantId: pair.creator.id, sessionId: started.sessionId });
    expect(view).toMatchObject({ id: started.sessionId, category: "deep", question: { category: "deep" } });
    expect(view.question?.id).not.toBe(started.questionId);
  });

  test("Skip records the current card and stays in the same session/category", async () => {
    const pair = await createPair("partner");
    const started = await startTogetherSession(db, { pairId: pair.pair.id, participantId: pair.creator.id, category: "deep", clientRequestId: randomUUID() });
    await advanceTogetherSession(db, { pairId: pair.pair.id, participantId: pair.creator.id, sessionId: started.sessionId, action: "skip", clientRequestId: randomUUID() });
    const cards = await db.select().from(togetherSessionQuestion).where(eq(togetherSessionQuestion.sessionId, started.sessionId)).orderBy(togetherSessionQuestion.position);
    expect(cards).toHaveLength(2);
    expect(cards[0]?.skippedAt).not.toBeNull();
    expect(cards[0]?.advancedAt).not.toBeNull();
    expect(cards[1]?.advancedAt).toBeNull();
    expect((await getTogetherSessionForParticipant(db, { pairId: pair.pair.id, participantId: pair.creator.id, sessionId: started.sessionId })).question?.category).toBe("deep");
  });

  test("shown questions are not repeated while unused eligible questions remain", async () => {
    const pair = await createPair("partner");
    const eligible = await listEligibleTogetherQuestions(db, { pairId: pair.pair.id, participantId: pair.creator.id, category: "deep" });
    const started = await startTogetherSession(db, { pairId: pair.pair.id, participantId: pair.creator.id, category: "deep", clientRequestId: randomUUID() });
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
      const next = await getTogetherSessionForParticipant(db, { pairId: pair.pair.id, participantId: pair.creator.id, sessionId: started.sessionId });
      expect(next.question).not.toBeNull();
      expect(shown.has(next.question!.id)).toBe(false);
      shown.add(next.question!.id);
    }
    expect(exhausted).toBe(true);
    expect(shown.size).toBe(eligible.length);
  });

  test("Like persists on the shown card, toggles deterministically, and creates no answer", async () => {
    const pair = await createPair("partner");
    const started = await startTogetherSession(db, { pairId: pair.pair.id, participantId: pair.creator.id, category: "deep", clientRequestId: randomUUID() });
    const liked = await setTogetherSessionLike(db, { pairId: pair.pair.id, participantId: pair.creator.id, sessionId: started.sessionId, liked: true });
    expect(liked.question?.liked).toBe(true);
    const storedLiked = await db.select({ likedAt: togetherSessionQuestion.likedAt }).from(togetherSessionQuestion).where(and(eq(togetherSessionQuestion.sessionId, started.sessionId), eq(togetherSessionQuestion.questionId, started.questionId)));
    expect(storedLiked[0]?.likedAt).not.toBeNull();

    expect((await setTogetherSessionLike(db, { pairId: pair.pair.id, participantId: pair.creator.id, sessionId: started.sessionId, liked: false })).question?.liked).toBe(false);
    const privateAnswers = await db
      .select({ id: privateAnswer.id })
      .from(privateAnswer)
      .innerJoin(privateRound, eq(privateAnswer.roundId, privateRound.id))
      .where(eq(privateRound.pairId, pair.pair.id));
    expect(privateAnswers).toHaveLength(0);
  });

  test("End session persists endedAt and rejects later mutations while repeated end is safe", async () => {
    const pair = await createPair("partner");
    const started = await startTogetherSession(db, { pairId: pair.pair.id, participantId: pair.creator.id, category: "deep", clientRequestId: randomUUID() });
    const ended = await endTogetherSession(db, { pairId: pair.pair.id, participantId: pair.creator.id, sessionId: started.sessionId });
    expect(ended.endedAt).not.toBeNull();
    expect((await endTogetherSession(db, { pairId: pair.pair.id, participantId: pair.creator.id, sessionId: started.sessionId })).endedAt).not.toBeNull();
    expect(await captureError(advanceTogetherSession(db, { pairId: pair.pair.id, participantId: pair.creator.id, sessionId: started.sessionId, action: "next", clientRequestId: randomUUID() }))).toMatchObject({ code: "TOGETHER_SESSION_ENDED" });
    expect(await captureError(setTogetherSessionLike(db, { pairId: pair.pair.id, participantId: pair.creator.id, sessionId: started.sessionId, liked: true }))).toMatchObject({ code: "TOGETHER_SESSION_ENDED" });
  });

  test("an unauthorized third participant cannot read or mutate another pair's session", async () => {
    const pair = await createPair("partner");
    const outsider = await createParticipant("Outsider");
    const started = await startTogetherSession(db, { pairId: pair.pair.id, participantId: pair.creator.id, category: "deep", clientRequestId: randomUUID() });
    expect(await captureError(getTogetherSessionForParticipant(db, { pairId: pair.pair.id, participantId: outsider.id, sessionId: started.sessionId }))).toMatchObject({ code: "PAIR_NOT_FOUND" });
    expect(await captureError(advanceTogetherSession(db, { pairId: pair.pair.id, participantId: outsider.id, sessionId: started.sessionId, action: "next", clientRequestId: randomUUID() }))).toMatchObject({ code: "PAIR_NOT_FOUND" });
  });

  test("shared-device actions have no individual attribution", async () => {
    const pair = await createPair("partner");
    const started = await startTogetherSession(db, { pairId: pair.pair.id, participantId: pair.creator.id, category: "deep", clientRequestId: randomUUID() });
    const card = (await db.select().from(togetherSessionQuestion).where(eq(togetherSessionQuestion.sessionId, started.sessionId)))[0];
    expect(card).not.toHaveProperty("participantId");
    expect((await db.select().from(togetherSession).where(eq(togetherSession.id, started.sessionId)))[0]).toMatchObject({ startedByParticipantId: pair.creator.id });
  });

  test("retrying Next with the same request ID advances only once", async () => {
    const pair = await createPair("partner");
    const started = await startTogetherSession(db, { pairId: pair.pair.id, participantId: pair.creator.id, category: "deep", clientRequestId: randomUUID() });
    const clientRequestId = randomUUID();
    const [first, retry] = await Promise.all([
      advanceTogetherSession(db, { pairId: pair.pair.id, participantId: pair.creator.id, sessionId: started.sessionId, action: "next", clientRequestId }),
      advanceTogetherSession(db, { pairId: pair.pair.id, participantId: pair.creator.id, sessionId: started.sessionId, action: "next", clientRequestId }),
    ]);
    expect(first).toEqual(retry);
    expect(await db.select().from(togetherSessionQuestion).where(eq(togetherSessionQuestion.sessionId, started.sessionId))).toHaveLength(2);
  });

  test("multiple completed Together sessions can exist independently", async () => {
    const pair = await createPair("partner");
    const first = await startTogetherSession(db, { pairId: pair.pair.id, participantId: pair.creator.id, category: "deep", clientRequestId: randomUUID() });
    const second = await startTogetherSession(db, { pairId: pair.pair.id, participantId: pair.creator.id, category: "fun", clientRequestId: randomUUID() });
    await endTogetherSession(db, { pairId: pair.pair.id, participantId: pair.creator.id, sessionId: first.sessionId });
    await endTogetherSession(db, { pairId: pair.pair.id, participantId: pair.creator.id, sessionId: second.sessionId });
    const sessions = await db.select().from(togetherSession).where(eq(togetherSession.pairId, pair.pair.id));
    expect(sessions).toHaveLength(2);
    expect(sessions.every((session) => session.endedAt !== null)).toBe(true);
  });

  test("a duplicate Start request resolves to one session", async () => {
    const pair = await createPair("partner");
    const clientRequestId = randomUUID();
    const [first, retry] = await Promise.all([
      startTogetherSession(db, { pairId: pair.pair.id, participantId: pair.creator.id, category: "deep", clientRequestId }),
      startTogetherSession(db, { pairId: pair.pair.id, participantId: pair.creator.id, category: "deep", clientRequestId }),
    ]);
    expect(first).toEqual(retry);
    expect(await db.select().from(togetherSession).where(eq(togetherSession.pairId, pair.pair.id))).toHaveLength(1);
  });
});
