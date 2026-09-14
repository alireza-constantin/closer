import { randomUUID } from "node:crypto";

import { afterAll, afterEach, expect, test } from "bun:test";
import dotenv from "dotenv";
import { and, eq, inArray, isNull } from "drizzle-orm";

dotenv.config({ path: new URL("../../../apps/web/.env.local", import.meta.url) });

const { createDb } = await import("./index");
const {
  CloserDomainError,
  advanceTogetherSession,
  askPrivateQuestionCandidate,
  createQuestion,
  createPairForParticipant,
  getFormerEraHistoryForParticipant,
  getInitialInviteLanding,
  getRejoinInviteLanding,
  issueOrReuseInitialInvite,
  issueRejoinInvite,
  redeemInitialInvite,
  redeemRejoinInvite,
  resolveOrCreateParticipant,
  startOrResumePrivateConversation,
  startTogetherSession,
  submitPrivateAnswer,
  terminatePair,
} = await import("./closer");
const { initialInvite, pair, pairMembership, pairMembershipEra, participant, privateQuestionCandidate, question, questionRevision, rejoinInvite, togetherSession } = await import("./schema/closer");
const { user } = await import("./schema/auth");

const db = createDb();
const userIds: string[] = [];
const pairIds: string[] = [];
const questionIds: string[] = [];

async function createTerminationQuestion(category: "deep" | "fun") {
  const created = await createQuestion(db, {
    text: `A ${category} question for terminal Pair coverage.`,
    category,
    relationshipFit: "both",
    modeFit: "both",
    intensity: "light",
  });
  questionIds.push(created.question.id);
}

async function createGuest(displayName: string) {
  const authUserId = randomUUID();
  userIds.push(authUserId);
  await db.insert(user).values({ id: authUserId, name: displayName, email: `${authUserId}@termination.closer.invalid`, isAnonymous: true });
  return resolveOrCreateParticipant(db, { authUserId, displayName });
}

async function createJoinedPair() {
  const first = await createGuest("First at termination");
  const second = await createGuest("Second at termination");
  const created = await createPairForParticipant(db, { participantId: first.id, intendedPersonName: "Second at termination", relationshipType: "partner" });
  pairIds.push(created.pair.id);
  const invite = await issueOrReuseInitialInvite(db, { participantId: first.id, pairId: created.pair.id });
  if (invite.state !== "issued") throw new Error("Expected an initial invitation.");
  await redeemInitialInvite(db, { token: invite.token, participantId: second.id });
  return { pairId: created.pair.id, first, second };
}

async function capture(promise: Promise<unknown>) {
  return promise.then(() => null, (error: unknown) => error);
}

afterEach(async () => {
  if (pairIds.length) await db.delete(pair).where(inArray(pair.id, pairIds));
  if (questionIds.length) {
    await db.update(question).set({ currentRevisionId: null }).where(inArray(question.id, questionIds));
    await db.delete(questionRevision).where(inArray(questionRevision.questionId, questionIds));
    await db.delete(question).where(inArray(question.id, questionIds));
  }
  if (userIds.length) {
    await db.delete(participant).where(inArray(participant.authUserId, userIds));
    await db.delete(user).where(inArray(user.id, userIds));
  }
  pairIds.length = 0;
  userIds.length = 0;
  questionIds.length = 0;
});

afterAll(async () => { await db.$client.end(); });

test("either claimed member can Unpair atomically and repeated termination is stable", async () => {
  await Promise.all([createTerminationQuestion("deep"), createTerminationQuestion("fun")]);
  const { pairId, first, second } = await createJoinedPair();
  const session = await startTogetherSession(db, { pairId, participantId: first.id, category: "deep" });
  const candidate = await startOrResumePrivateConversation(db, { pairId, participantId: first.id, category: "fun", clientRequestId: randomUUID() });
  if (candidate.state !== "CANDIDATE") throw new Error("Expected a Private candidate.");
  const rejoin = await issueRejoinInvite(db, { pairId, participantId: first.id });

  const terminated = await terminatePair(db, { pairId, participantId: second.id });
  const repeated = await terminatePair(db, { pairId, participantId: first.id });
  expect(repeated.terminatedAt).toEqual(terminated.terminatedAt);

  const [storedPair] = await db.select().from(pair).where(eq(pair.id, pairId));
  expect(storedPair?.terminatedAt).toEqual(terminated.terminatedAt);
  const memberships = await db.select().from(pairMembership).where(eq(pairMembership.pairId, pairId));
  expect(memberships).toHaveLength(2);
  expect(memberships.every((membership) => membership.endedAt !== null && membership.endedDisplayName !== null)).toBe(true);
  expect(memberships.find((membership) => membership.participantId === first.id)?.endedDisplayName).toBe("First at termination");
  expect(memberships.find((membership) => membership.participantId === second.id)?.endedDisplayName).toBe("Second at termination");
  await db.update(participant).set({ displayName: "Renamed after termination" }).where(eq(participant.id, first.id));
  expect((await db.select().from(pairMembership).where(and(eq(pairMembership.pairId, pairId), eq(pairMembership.participantId, first.id))))[0]?.endedDisplayName).toBe("First at termination");
  expect((await db.select().from(pairMembershipEra).where(and(eq(pairMembershipEra.pairId, pairId), isNull(pairMembershipEra.endedAt))))).toHaveLength(0);
  expect((await db.select().from(privateQuestionCandidate).where(eq(privateQuestionCandidate.id, candidate.candidate.id)))[0]).toMatchObject({ state: "invalidated" });
  expect((await db.select().from(togetherSession).where(eq(togetherSession.id, session.sessionId)))[0]?.endedAt).not.toBeNull();
  expect((await db.select().from(rejoinInvite).where(eq(rejoinInvite.pairId, pairId)))[0]?.revokedAt).not.toBeNull();
  expect(await getRejoinInviteLanding(db, rejoin.token)).toBeNull();
  expect(await capture(advanceTogetherSession(db, { pairId, participantId: first.id, sessionId: session.sessionId, action: "next" }))).toBeInstanceOf(CloserDomainError);
  expect(await capture(startOrResumePrivateConversation(db, { pairId, participantId: first.id, category: "deep", clientRequestId: randomUUID() }))).toBeInstanceOf(CloserDomainError);

  const history = await getFormerEraHistoryForParticipant(db, { pairId, participantId: first.id });
  expect(history.formerPair.terminatedAt).not.toBeNull();
  expect(history.eras).toHaveLength(1);

  const fresh = await createPairForParticipant(db, { participantId: first.id, intendedPersonName: "Second at termination", relationshipType: "partner" });
  pairIds.push(fresh.pair.id);
  const freshInvite = await issueOrReuseInitialInvite(db, { pairId: fresh.pair.id, participantId: first.id });
  if (freshInvite.state !== "issued") throw new Error("Expected a fresh invitation for the new Pair.");
  await redeemInitialInvite(db, { token: freshInvite.token, participantId: second.id });
  expect(fresh.pair.id).not.toBe(pairId);
  const freshHistory = await getFormerEraHistoryForParticipant(db, { pairId: fresh.pair.id, participantId: first.id });
  expect(freshHistory.eras).toEqual([]);
});

test("an unclaimed member can End this space without manufacturing a second participant", async () => {
  await createTerminationQuestion("fun");
  const first = await createGuest("Solo at termination");
  const created = await createPairForParticipant(db, { participantId: first.id, intendedPersonName: "Intended only", relationshipType: "friend" });
  pairIds.push(created.pair.id);
  const invite = await issueOrReuseInitialInvite(db, { pairId: created.pair.id, participantId: first.id });
  if (invite.state !== "issued") throw new Error("Expected an initial invitation.");
  const session = await startTogetherSession(db, { pairId: created.pair.id, participantId: first.id, category: "fun" });

  await terminatePair(db, { pairId: created.pair.id, participantId: first.id });

  const memberships = await db.select().from(pairMembership).where(eq(pairMembership.pairId, created.pair.id));
  expect(memberships).toHaveLength(1);
  expect(memberships[0]).toMatchObject({ participantId: first.id, endedDisplayName: "Solo at termination" });
  expect((await db.select().from(initialInvite).where(eq(initialInvite.pairId, created.pair.id)))[0]?.revokedAt).not.toBeNull();
  expect(await getInitialInviteLanding(db, invite.token)).toBeNull();
  expect((await db.select().from(togetherSession).where(eq(togetherSession.id, session.sessionId)))[0]?.endedAt).not.toBeNull();
  expect(await capture(redeemInitialInvite(db, { token: invite.token, participantId: await createGuest("Late claimant") }))).toBeInstanceOf(CloserDomainError);

  const history = await getFormerEraHistoryForParticipant(db, { pairId: created.pair.id, participantId: first.id });
  expect(history.formerPair.intendedPersonName).toBe("Intended only");
  expect(history.eras).toEqual([]);
  expect(history.preClaimTogetherSessions).toHaveLength(1);
});

test("termination and answer serialization retain only the transaction that commits first", async () => {
  await createTerminationQuestion("deep");
  const { pairId, first, second } = await createJoinedPair();
  const candidate = await startOrResumePrivateConversation(db, { pairId, participantId: first.id, category: "deep", clientRequestId: randomUUID() });
  if (candidate.state !== "CANDIDATE") throw new Error("Expected a Private candidate.");
  const asked = await askPrivateQuestionCandidate(db, { pairId, participantId: first.id, conversationId: candidate.id, candidateId: candidate.candidate.id, clientRequestId: randomUUID() });
  await submitPrivateAnswer(db, { pairId, participantId: first.id, roundId: asked.roundId, body: "First answer" });

  const [answer, termination] = await Promise.allSettled([
    submitPrivateAnswer(db, { pairId, participantId: second.id, roundId: asked.roundId, body: "Second answer" }),
    terminatePair(db, { pairId, participantId: first.id }),
  ]);
  expect(termination.status).toBe("fulfilled");
  expect(["fulfilled", "rejected"]).toContain(answer.status);
  const history = await getFormerEraHistoryForParticipant(db, { pairId, participantId: first.id });
  const round = history.eras[0]?.privateConversations.flatMap((conversation) => conversation.rounds).find((item) => item.id === asked.roundId);
  expect(round?.answers).toHaveLength(answer.status === "fulfilled" ? 2 : 1);
});

test("an answer committed before termination remains mutually visible in Former-Pair history", async () => {
  await createTerminationQuestion("deep");
  const { pairId, first, second } = await createJoinedPair();
  const candidate = await startOrResumePrivateConversation(db, { pairId, participantId: first.id, category: "deep", clientRequestId: randomUUID() });
  if (candidate.state !== "CANDIDATE") throw new Error("Expected a Private candidate.");
  const asked = await askPrivateQuestionCandidate(db, { pairId, participantId: first.id, conversationId: candidate.id, candidateId: candidate.candidate.id, clientRequestId: randomUUID() });
  await submitPrivateAnswer(db, { pairId, participantId: first.id, roundId: asked.roundId, body: "First answer" });
  await submitPrivateAnswer(db, { pairId, participantId: second.id, roundId: asked.roundId, body: "Second answer" });
  await terminatePair(db, { pairId, participantId: first.id });

  const firstHistory = await getFormerEraHistoryForParticipant(db, { pairId, participantId: first.id });
  const secondHistory = await getFormerEraHistoryForParticipant(db, { pairId, participantId: second.id });
  const roundFor = (history: typeof firstHistory) => history.eras[0]?.privateConversations.flatMap((conversation) => conversation.rounds).find((round) => round.id === asked.roundId);
  expect(roundFor(firstHistory)?.answers).toHaveLength(2);
  expect(roundFor(secondHistory)?.answers).toHaveLength(2);
});

test("termination committed before an answer preserves author-only Former-Pair history", async () => {
  await createTerminationQuestion("deep");
  const { pairId, first, second } = await createJoinedPair();
  const candidate = await startOrResumePrivateConversation(db, { pairId, participantId: first.id, category: "deep", clientRequestId: randomUUID() });
  if (candidate.state !== "CANDIDATE") throw new Error("Expected a Private candidate.");
  const asked = await askPrivateQuestionCandidate(db, { pairId, participantId: first.id, conversationId: candidate.id, candidateId: candidate.candidate.id, clientRequestId: randomUUID() });
  await submitPrivateAnswer(db, { pairId, participantId: first.id, roundId: asked.roundId, body: "Only first answer" });
  await terminatePair(db, { pairId, participantId: first.id });
  expect(await capture(submitPrivateAnswer(db, { pairId, participantId: second.id, roundId: asked.roundId, body: "Late second answer" }))).toBeInstanceOf(CloserDomainError);

  const firstHistory = await getFormerEraHistoryForParticipant(db, { pairId, participantId: first.id });
  const secondHistory = await getFormerEraHistoryForParticipant(db, { pairId, participantId: second.id });
  const roundFor = (history: typeof firstHistory) => history.eras[0]?.privateConversations.flatMap((conversation) => conversation.rounds).find((round) => round.id === asked.roundId);
  expect(roundFor(firstHistory)?.answers.map((answer) => answer.body)).toEqual(["Only first answer"]);
  expect(roundFor(secondHistory)?.answers).toEqual([]);
});
