import { randomUUID } from "node:crypto";

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import dotenv from "dotenv";
import { and, eq, inArray, isNull } from "drizzle-orm";

dotenv.config({ path: new URL("../../../apps/web/.env", import.meta.url) });

const { createDb } = await import("./index");
const {
  CloserDomainError,
  createNextPrivateRound,
  createPairForParticipant,
  getPrivateRoundForParticipant,
  getPrivateRoundStatusForParticipant,
  issueOrReuseInitialInvite,
  listActivePrivateConversations,
  listEligiblePrivateQuestions,
  markPrivateRevealViewed,
  redeemInitialInvite,
  removePrivateReaction,
  removePrivateReply,
  resolveOrCreateParticipant,
  setPrivateReaction,
  setPrivateReply,
  submitPrivateAnswer,
  startOrResumePrivateConversation,
} = await import("./closer");
const { initialInvite, pair, pairMembership, participant, privateAnswer, privateConversation, privateRound } = await import("./schema/closer");
const { user } = await import("./schema/auth");

const db = createDb();
const authUserIds: string[] = [];
const pairIds: string[] = [];
const questionIds = {
  fun: "00000000-0000-4000-8000-000000000101",
  deep: "00000000-0000-4000-8000-000000000201",
  relationship: "00000000-0000-4000-8000-000000000401",
  friendship: "00000000-0000-4000-8000-000000000501",
} as const;

async function createAuthUser(name = "Test participant") {
  const id = randomUUID();
  authUserIds.push(id);
  await db.insert(user).values({ id, name, email: `${id}@private.closer.invalid`, isAnonymous: true });
  return id;
}

async function createParticipant(name: string) {
  return resolveOrCreateParticipant(db, { authUserId: await createAuthUser(name), displayName: name });
}

async function issueFreshInitialInvite(participantId: string, pairId: string) {
  const invite = await issueOrReuseInitialInvite(db, { participantId, pairId });
  if (invite.state !== "issued") throw new Error("Fresh pair unexpectedly had an invitation.");
  return invite.token;
}

async function createJoinedPair(relationshipType: "partner" | "friend" = "partner") {
  const first = await createParticipant("Ali");
  const created = await createPairForParticipant(db, { participantId: first.id, intendedPersonName: "Fafa", relationshipType });
  pairIds.push(created.pair.id);
  const second = await createParticipant("Fafa");
  const token = await issueFreshInitialInvite(first.id, created.pair.id);
  await redeemInitialInvite(db, { token, participantId: second.id });
  return { pairId: created.pair.id, first, second };
}

async function capture(promise: Promise<unknown>) {
  return promise.then(() => null, (error: unknown) => error);
}

async function createRound(pairId: string, participantId: string, questionId = questionIds.deep, clientRequestId = randomUUID()) {
  const categoryByQuestion = {
    [questionIds.fun]: "fun",
    [questionIds.deep]: "deep",
    [questionIds.relationship]: "relationship",
    [questionIds.friendship]: "friendship",
  } as const;
  const created = await startOrResumePrivateConversation(db, {
    pairId,
    participantId,
    category: categoryByQuestion[questionId],
    clientRequestId,
  });
  return { id: created.roundId, conversationId: created.conversationId };
}

async function makeReady(pairId: string, firstId: string, secondId: string, questionId = questionIds.deep) {
  const round = await createRound(pairId, firstId, questionId);
  await submitPrivateAnswer(db, { pairId, participantId: firstId, roundId: round.id, body: "First private answer" });
  await submitPrivateAnswer(db, { pairId, participantId: secondId, roundId: round.id, body: "Second private answer" });
  return round;
}

afterEach(async () => {
  if (pairIds.length) {
    await db.delete(initialInvite).where(inArray(initialInvite.pairId, pairIds));
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

afterAll(async () => { await db.$client.end(); });

describe("Closer Slice 01B Private rounds", () => {
  test("Private requires both participant slots before a conversation can start", async () => {
    const first = await createParticipant("Solo participant");
    const created = await createPairForParticipant(db, { participantId: first.id, intendedPersonName: "Fafa", relationshipType: "partner" });
    pairIds.push(created.pair.id);

    expect(await capture(startOrResumePrivateConversation(db, {
      pairId: created.pair.id,
      participantId: first.id,
      category: "deep",
      clientRequestId: randomUUID(),
    }))).toMatchObject({ code: "PAIR_NOT_READY" });
  });

  test("partner and friend pairs receive only their valid Private categories", async () => {
    const partner = await createJoinedPair("partner");
    const friend = await createJoinedPair("friend");
    expect((await listEligiblePrivateQuestions(db, { participantId: partner.first.id, pairId: partner.pairId, category: "relationship" })).length).toBeGreaterThan(0);
    expect((await listEligiblePrivateQuestions(db, { participantId: friend.first.id, pairId: friend.pairId, category: "friendship" })).length).toBeGreaterThan(0);
    expect(await capture(listEligiblePrivateQuestions(db, { participantId: partner.first.id, pairId: partner.pairId, category: "friendship" }))).toMatchObject({ code: "QUESTION_UNAVAILABLE" });
    expect(await capture(listEligiblePrivateQuestions(db, { participantId: friend.first.id, pairId: friend.pairId, category: "relationship" }))).toMatchObject({ code: "QUESTION_UNAVAILABLE" });
  });

  test("Private conversations and relationship categories stay isolated across a participant's spaces", async () => {
    const first = await createParticipant("Ali");
    const partnerSpace = await createPairForParticipant(db, { participantId: first.id, intendedPersonName: "Fafa", relationshipType: "partner" });
    pairIds.push(partnerSpace.pair.id);
    const partner = await createParticipant("Fafa");
    const partnerToken = await issueFreshInitialInvite(first.id, partnerSpace.pair.id);
    await redeemInitialInvite(db, { token: partnerToken, participantId: partner.id });

    const friendSpace = await createPairForParticipant(db, { participantId: first.id, intendedPersonName: "Nima", relationshipType: "friend" });
    pairIds.push(friendSpace.pair.id);
    const friend = await createParticipant("Nima");
    const friendToken = await issueFreshInitialInvite(first.id, friendSpace.pair.id);
    await redeemInitialInvite(db, { token: friendToken, participantId: friend.id });

    const partnerRound = await createRound(partnerSpace.pair.id, first.id, questionIds.relationship);
    expect(await listActivePrivateConversations(db, { pairId: friendSpace.pair.id, participantId: first.id })).toEqual([]);
    expect(await listEligiblePrivateQuestions(db, { pairId: partnerSpace.pair.id, participantId: first.id, category: "relationship" })).not.toEqual([]);
    expect(await listEligiblePrivateQuestions(db, { pairId: friendSpace.pair.id, participantId: first.id, category: "friendship" })).not.toEqual([]);
    expect(await capture(getPrivateRoundForParticipant(db, { pairId: friendSpace.pair.id, participantId: first.id, roundId: partnerRound.id }))).toMatchObject({ code: "ROUND_NOT_FOUND" });
  });

  test("multiple category conversations coexist and retain participant-relative independent state", async () => {
    const { pairId, first, second } = await createJoinedPair();
    const roundA = await createRound(pairId, first.id, questionIds.deep);
    const roundB = await createRound(pairId, first.id, questionIds.relationship);
    await submitPrivateAnswer(db, { pairId, participantId: first.id, roundId: roundA.id, body: "Answer for A" });
    const firstConversations = await listActivePrivateConversations(db, { participantId: first.id, pairId });
    const secondConversations = await listActivePrivateConversations(db, { participantId: second.id, pairId });
    expect(firstConversations).toEqual(expect.arrayContaining([expect.objectContaining({ id: roundA.conversationId, state: "WAITING" }), expect.objectContaining({ id: roundB.conversationId, state: "YOUR_TURN" })]));
    expect(secondConversations).toEqual(expect.arrayContaining([expect.objectContaining({ id: roundA.conversationId, state: "YOUR_TURN" }), expect.objectContaining({ id: roundB.conversationId, state: "YOUR_TURN" })]));
  });

  test("the active-round projection exposes a newly created round safely to the other participant", async () => {
    const { pairId, first, second } = await createJoinedPair();
    const round = await createRound(pairId, first.id);
    await submitPrivateAnswer(db, { pairId, participantId: first.id, roundId: round.id, body: "Ali answer stays private" });
    const secondConversations = await listActivePrivateConversations(db, { participantId: second.id, pairId });
    const summary = secondConversations.find((item) => item.id === round.conversationId);
    expect(summary).toMatchObject({ id: round.conversationId, state: "YOUR_TURN", currentRound: expect.objectContaining({ id: round.id }) });
    expect(JSON.stringify(summary)).not.toContain("Ali answer stays private");
    expect(summary).not.toHaveProperty("answers");
  });

  test("pre-reveal projections contain only the viewer's answer and never serialize the other answer", async () => {
    const { pairId, first, second } = await createJoinedPair();
    const round = await createRound(pairId, first.id);
    await submitPrivateAnswer(db, { pairId, participantId: first.id, roundId: round.id, body: "Ali confidential answer" });
    const firstView = await getPrivateRoundForParticipant(db, { pairId, participantId: first.id, roundId: round.id });
    const secondView = await getPrivateRoundForParticipant(db, { pairId, participantId: second.id, roundId: round.id });
    expect(firstView.yourAnswer).toBe("Ali confidential answer");
    expect(firstView).not.toHaveProperty("answers");
    expect(secondView.yourAnswer).toBeNull();
    expect(secondView).not.toHaveProperty("answers");
    expect(JSON.stringify(secondView)).not.toContain("Ali confidential answer");
    expect(await getPrivateRoundStatusForParticipant(db, { pairId, participantId: second.id, roundId: round.id })).toEqual({ state: "YOUR_TURN" });
  });

  test("only the second committed answer makes that round reveal-ready and reveals both answers", async () => {
    const { pairId, first, second } = await createJoinedPair();
    const roundA = await createRound(pairId, first.id);
    const roundB = await createRound(pairId, first.id, questionIds.relationship);
    await submitPrivateAnswer(db, { pairId, participantId: first.id, roundId: roundA.id, body: "A one" });
    await submitPrivateAnswer(db, { pairId, participantId: second.id, roundId: roundA.id, body: "A two" });
    const visibleToFirst = await getPrivateRoundForParticipant(db, { pairId, participantId: first.id, roundId: roundA.id });
    const visibleToSecond = await getPrivateRoundForParticipant(db, { pairId, participantId: second.id, roundId: roundA.id });
    expect(visibleToFirst.state).toBe("REVEAL_READY");
    expect(visibleToSecond.answers).toHaveLength(2);
    expect(visibleToFirst.answers?.map((answer) => answer.body)).toEqual(expect.arrayContaining(["A one", "A two"]));
    expect((await getPrivateRoundForParticipant(db, { pairId, participantId: first.id, roundId: roundB.id })).answers).toBeUndefined();
  });

  test("answers are trimmed, bounded, immutable, and deterministic for repeated concurrent submission", async () => {
    const { pairId, first } = await createJoinedPair();
    const round = await createRound(pairId, first.id);
    const repeated = await Promise.all([
      submitPrivateAnswer(db, { pairId, participantId: first.id, roundId: round.id, body: "  Kept answer  " }),
      submitPrivateAnswer(db, { pairId, participantId: first.id, roundId: round.id, body: "Kept answer" }),
    ]);
    expect(repeated.every((view) => view.yourAnswer === "Kept answer")).toBe(true);
    const rows = await db.select().from(privateAnswer).where(and(eq(privateAnswer.roundId, round.id), eq(privateAnswer.participantId, first.id)));
    expect(rows).toHaveLength(1);
    expect(await capture(submitPrivateAnswer(db, { pairId, participantId: first.id, roundId: round.id, body: "A different answer" }))).toMatchObject({ code: "ANSWER_IMMUTABLE" });
    expect(await capture(submitPrivateAnswer(db, { pairId, participantId: first.id, roundId: round.id, body: "   " }))).toMatchObject({ code: "ANSWER_INVALID" });
    expect(await capture(submitPrivateAnswer(db, { pairId, participantId: first.id, roundId: round.id, body: "x".repeat(2001) }))).toMatchObject({ code: "ANSWER_INVALID" });
  });

  test("reveal-view timing is independent and does not leak to another active round", async () => {
    const { pairId, first, second } = await createJoinedPair();
    const roundA = await makeReady(pairId, first.id, second.id);
    const roundB = await makeReady(pairId, first.id, second.id, questionIds.relationship);
    await markPrivateRevealViewed(db, { pairId, participantId: first.id, roundId: roundA.id });
    expect((await getPrivateRoundForParticipant(db, { pairId, participantId: first.id, roundId: roundA.id })).state).toBe("REVEAL_VIEWED");
    expect((await getPrivateRoundForParticipant(db, { pairId, participantId: second.id, roundId: roundA.id })).state).toBe("REVEAL_READY");
    expect((await getPrivateRoundForParticipant(db, { pairId, participantId: first.id, roundId: roundB.id })).state).toBe("REVEAL_READY");
  });

  test("a revealed participant owns one changeable reaction and one editable removable reply", async () => {
    const { pairId, first, second } = await createJoinedPair();
    const round = await makeReady(pairId, first.id, second.id);
    await markPrivateRevealViewed(db, { pairId, participantId: first.id, roundId: round.id });
    await setPrivateReaction(db, { pairId, participantId: first.id, roundId: round.id, value: "heart" });
    let view = await setPrivateReaction(db, { pairId, participantId: first.id, roundId: round.id, value: "laugh" });
    expect(view.reactions).toEqual([expect.objectContaining({ participantId: first.id, value: "laugh" })]);
    view = await removePrivateReaction(db, { pairId, participantId: first.id, roundId: round.id });
    expect(view.reactions).toEqual([]);
    await setPrivateReply(db, { pairId, participantId: first.id, roundId: round.id, body: "  I love that.  " });
    view = await setPrivateReply(db, { pairId, participantId: first.id, roundId: round.id, body: "I love that even more." });
    expect(view.replies).toEqual([expect.objectContaining({ participantId: first.id, body: "I love that even more.", isOwner: true })]);
    view = await removePrivateReply(db, { pairId, participantId: first.id, roundId: round.id });
    expect(view.replies).toEqual([]);
  });

  test("reactions are shared post-reveal and deterministically belong on the other answer", async () => {
    const { pairId, first, second } = await createJoinedPair();
    const round = await makeReady(pairId, first.id, second.id);
    await markPrivateRevealViewed(db, { pairId, participantId: first.id, roundId: round.id });
    await markPrivateRevealViewed(db, { pairId, participantId: second.id, roundId: round.id });
    await setPrivateReaction(db, { pairId, participantId: second.id, roundId: round.id, value: "heart" });
    await setPrivateReaction(db, { pairId, participantId: first.id, roundId: round.id, value: "laugh" });
    const firstView = await getPrivateRoundForParticipant(db, { pairId, participantId: first.id, roundId: round.id });
    const secondView = await getPrivateRoundForParticipant(db, { pairId, participantId: second.id, roundId: round.id });
    expect(firstView.reactions).toEqual(expect.arrayContaining([
      expect.objectContaining({ participantId: second.id, value: "heart" }),
      expect.objectContaining({ participantId: first.id, value: "laugh" }),
    ]));
    expect(secondView.reactions).toEqual(firstView.reactions);
    const answerOwnerByReactionOwner = new Map([
      [first.id, second.id],
      [second.id, first.id],
    ]);
    for (const reaction of firstView.reactions ?? []) {
      expect(answerOwnerByReactionOwner.get(reaction.participantId)).not.toBe(reaction.participantId);
    }
  });

  test("an authorized partner can read a post-reveal reply, while an outsider cannot operate on reactions or replies", async () => {
    const joined = await createJoinedPair();
    const unrelated = await createParticipant("No access");
    const round = await makeReady(joined.pairId, joined.first.id, joined.second.id);
    await markPrivateRevealViewed(db, { pairId: joined.pairId, participantId: joined.first.id, roundId: round.id });
    await setPrivateReply(db, { pairId: joined.pairId, participantId: joined.first.id, roundId: round.id, body: "I’m glad you said that." });
    const secondView = await getPrivateRoundForParticipant(db, { pairId: joined.pairId, participantId: joined.second.id, roundId: round.id });
    expect(secondView.replies).toEqual([expect.objectContaining({ participantId: joined.first.id, body: "I’m glad you said that.", isOwner: false })]);
    expect(await capture(setPrivateReaction(db, { pairId: joined.pairId, participantId: unrelated.id, roundId: round.id, value: "heart" }))).toMatchObject({ code: "PAIR_NOT_FOUND" });
    expect(await capture(setPrivateReply(db, { pairId: joined.pairId, participantId: unrelated.id, roundId: round.id, body: "Nope" }))).toMatchObject({ code: "PAIR_NOT_FOUND" });
  });

  test("a category conversation owns its first round and next question remains in that conversation", async () => {
    const { pairId, first, second } = await createJoinedPair();
    const firstRound = await createRound(pairId, first.id, questionIds.deep);
    const conversations = await db.select().from(privateConversation).where(eq(privateConversation.id, firstRound.conversationId));
    const persistedRound = await db.select().from(privateRound).where(eq(privateRound.id, firstRound.id));
    expect(conversations[0]).toMatchObject({ pairId, category: "deep" });
    expect(persistedRound[0]).toMatchObject({ pairId, conversationId: firstRound.conversationId });
    await submitPrivateAnswer(db, { pairId, participantId: first.id, roundId: firstRound.id, body: "First Deep answer" });
    await submitPrivateAnswer(db, { pairId, participantId: second.id, roundId: firstRound.id, body: "Second Deep answer" });
    const secondRound = await createNextPrivateRound(db, {
      pairId,
      participantId: first.id,
      conversationId: firstRound.conversationId,
      clientRequestId: randomUUID(),
    });
    const secondView = await getPrivateRoundForParticipant(db, { pairId, participantId: second.id, roundId: secondRound.roundId });
    expect(secondRound.roundId).not.toBe(firstRound.id);
    expect(secondRound.conversationId).toBe(firstRound.conversationId);
    expect(secondView.question.category).toBe("deep");
    expect(secondView.question.id).not.toBe(questionIds.deep);
  });

  test("next question prefers unused conversation prompts and cycles only after exhaustion", async () => {
    const { pairId, first, second } = await createJoinedPair();
    const candidates = await listEligiblePrivateQuestions(db, { pairId, participantId: first.id, category: "deep" });
    expect(candidates.length).toBeGreaterThan(2);
    let current = await createRound(pairId, first.id, questionIds.deep);
    const usedQuestionIds = [questionIds.deep];
    for (let index = 1; index < candidates.length; index += 1) {
      await submitPrivateAnswer(db, { pairId, participantId: first.id, roundId: current.id, body: `First answer ${index}` });
      await submitPrivateAnswer(db, { pairId, participantId: second.id, roundId: current.id, body: `Second answer ${index}` });
      const next = await createNextPrivateRound(db, { pairId, participantId: first.id, conversationId: current.conversationId, clientRequestId: randomUUID() });
      const view = await getPrivateRoundForParticipant(db, { pairId, participantId: first.id, roundId: next.roundId });
      expect(usedQuestionIds).not.toContain(view.question.id);
      usedQuestionIds.push(view.question.id);
      current = { id: next.roundId, conversationId: next.conversationId };
    }
    await submitPrivateAnswer(db, { pairId, participantId: first.id, roundId: current.id, body: "First exhausted answer" });
    await submitPrivateAnswer(db, { pairId, participantId: second.id, roundId: current.id, body: "Second exhausted answer" });
    const cycled = await createNextPrivateRound(db, { pairId, participantId: first.id, conversationId: current.conversationId, clientRequestId: randomUUID() });
    const cycledView = await getPrivateRoundForParticipant(db, { pairId, participantId: first.id, roundId: cycled.roundId });
    expect(usedQuestionIds).toContain(cycledView.question.id);
    expect(cycledView.question.id).not.toBe(usedQuestionIds.at(-1));
  });

  test("Pair Home returns one summary per conversation and resuming Deep leaves Fun intact", async () => {
    const { pairId, first, second } = await createJoinedPair();
    const deep = await createRound(pairId, first.id, questionIds.deep);
    await submitPrivateAnswer(db, { pairId, participantId: first.id, roundId: deep.id, body: "Deep waits" });
    const fun = await createRound(pairId, first.id, questionIds.fun);
    const resumedDeep = await startOrResumePrivateConversation(db, { pairId, participantId: second.id, category: "deep", clientRequestId: randomUUID() });
    const summaries = await listActivePrivateConversations(db, { pairId, participantId: first.id });
    expect(resumedDeep.roundId).toBe(deep.id);
    expect(summaries).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: deep.conversationId, currentRound: expect.objectContaining({ id: deep.id }), questionCount: 1, state: "WAITING" }),
      expect.objectContaining({ id: fun.conversationId, currentRound: expect.objectContaining({ id: fun.id }), questionCount: 1, state: "YOUR_TURN" }),
    ]));
  });

  test("conversation summaries derive ready to reveal and ready for next from the current round", async () => {
    const { pairId, first, second } = await createJoinedPair();
    const round = await makeReady(pairId, first.id, second.id);
    let firstSummary = (await listActivePrivateConversations(db, { pairId, participantId: first.id }))[0];
    let secondSummary = (await listActivePrivateConversations(db, { pairId, participantId: second.id }))[0];
    expect(firstSummary).toMatchObject({ currentRound: { id: round.id }, state: "REVEAL_READY" });
    expect(secondSummary).toMatchObject({ currentRound: { id: round.id }, state: "REVEAL_READY" });
    await markPrivateRevealViewed(db, { pairId, participantId: first.id, roundId: round.id });
    firstSummary = (await listActivePrivateConversations(db, { pairId, participantId: first.id }))[0];
    secondSummary = (await listActivePrivateConversations(db, { pairId, participantId: second.id }))[0];
    expect(firstSummary?.state).toBe("READY_FOR_NEXT");
    expect(secondSummary?.state).toBe("REVEAL_READY");
  });

  test("a participant outside the pair cannot read or operate on its round", async () => {
    const joined = await createJoinedPair();
    const unrelated = await createParticipant("No access");
    const round = await createRound(joined.pairId, joined.first.id);
    expect(await capture(getPrivateRoundForParticipant(db, { pairId: joined.pairId, participantId: unrelated.id, roundId: round.id }))).toMatchObject({ code: "PAIR_NOT_FOUND" });
    expect(await capture(submitPrivateAnswer(db, { pairId: joined.pairId, participantId: unrelated.id, roundId: round.id, body: "Nope" }))).toMatchObject({ code: "PAIR_NOT_FOUND" });
    expect(await capture(createNextPrivateRound(db, { pairId: joined.pairId, participantId: unrelated.id, conversationId: round.conversationId, clientRequestId: randomUUID() }))).toMatchObject({ code: "PAIR_NOT_FOUND" });
  });

  test("retrying Next creates only one unresolved current round", async () => {
    const { pairId, first, second } = await createJoinedPair();
    const current = await createRound(pairId, first.id, questionIds.deep);
    await submitPrivateAnswer(db, { pairId, participantId: first.id, roundId: current.id, body: "First ready answer" });
    await submitPrivateAnswer(db, { pairId, participantId: second.id, roundId: current.id, body: "Second ready answer" });
    const requestId = randomUUID();
    const [firstResult, retryResult] = await Promise.all([
      createNextPrivateRound(db, { pairId, participantId: first.id, conversationId: current.conversationId, clientRequestId: requestId }),
      createNextPrivateRound(db, { pairId, participantId: first.id, conversationId: current.conversationId, clientRequestId: requestId }),
    ]);
    const rounds = await db.select().from(privateRound).where(eq(privateRound.conversationId, current.conversationId));
    expect(firstResult.roundId).toBe(retryResult.roundId);
    expect(rounds).toHaveLength(2);
  });
});
