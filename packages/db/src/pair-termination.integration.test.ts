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
  declinePrivateRound,
  getFormerEraHistoryForParticipant,
  getInitialInviteLanding,
  getRejoinInviteLanding,
  issueOrReuseInitialInvite,
  issueRejoinInvite,
  markPrivateRevealViewed,
  redeemInitialInvite,
  redeemRejoinInvite,
  resolveOrCreateParticipant,
  setPrivateQuestionCandidateLike,
  setPrivateReaction,
  setPrivateReply,
  skipPrivateQuestionCandidate,
  startOrResumePrivateConversation,
  startTogetherSession,
  submitPrivateAnswer,
  terminatePair,
} = await import("./closer");
const { initialInvite, pair, pairMembership, pairMembershipEra, participant, privateQuestionCandidate, privateRound, question, questionRevision, rejoinInvite, togetherSession } = await import("./schema/closer");
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

async function createGuestAuthUser(displayName: string) {
  const authUserId = randomUUID();
  userIds.push(authUserId);
  await db.insert(user).values({ id: authUserId, name: displayName, email: `${authUserId}@termination.closer.invalid`, isAnonymous: true });
  return authUserId;
}

async function createGuest(displayName: string) {
  const authUserId = await createGuestAuthUser(displayName);
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

async function askCurrentCandidate(pairId: string, participantId: string, category: "deep" | "fun") {
  const conversation = await startOrResumePrivateConversation(db, { pairId, participantId, category, clientRequestId: randomUUID() });
  if (conversation.state !== "CANDIDATE") throw new Error("Expected a Private candidate.");
  const asked = await askPrivateQuestionCandidate(db, {
    pairId,
    participantId,
    conversationId: conversation.id,
    candidateId: conversation.candidate.id,
    clientRequestId: randomUUID(),
  });
  return { conversation, asked };
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
  expect(await capture(startTogetherSession(db, { pairId, participantId: first.id, category: "deep" }))).toBeInstanceOf(CloserDomainError);
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
  expect(await capture(startTogetherSession(db, { pairId: created.pair.id, participantId: first.id, category: "fun" }))).toBeInstanceOf(CloserDomainError);

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

test("termination serializes initial claim in both commit orders and never lets a credential revive a Pair", async () => {
  const first = await createGuest("Claim race first");
  const claimant = await createGuest("Claim race claimant");
  const raced = await createPairForParticipant(db, { participantId: first.id, intendedPersonName: "Claim race claimant", relationshipType: "partner" });
  pairIds.push(raced.pair.id);
  const racedInvite = await issueOrReuseInitialInvite(db, { pairId: raced.pair.id, participantId: first.id });
  if (racedInvite.state !== "issued") throw new Error("Expected an initial invitation.");

  const [claim, termination] = await Promise.allSettled([
    redeemInitialInvite(db, { token: racedInvite.token, participantId: claimant.id }),
    terminatePair(db, { pairId: raced.pair.id, participantId: first.id }),
  ]);
  expect(termination.status).toBe("fulfilled");
  expect(["fulfilled", "rejected"]).toContain(claim.status);
  const racedMemberships = await db.select().from(pairMembership).where(eq(pairMembership.pairId, raced.pair.id));
  expect(racedMemberships).toHaveLength(claim.status === "fulfilled" ? 2 : 1);
  expect(racedMemberships.every((membership) => membership.endedAt !== null)).toBe(true);
  expect(await getInitialInviteLanding(db, racedInvite.token)).toBeNull();

  const claimFirst = await createPairForParticipant(db, { participantId: first.id, intendedPersonName: "Claim first", relationshipType: "friend" });
  pairIds.push(claimFirst.pair.id);
  const claimFirstInvite = await issueOrReuseInitialInvite(db, { pairId: claimFirst.pair.id, participantId: first.id });
  if (claimFirstInvite.state !== "issued") throw new Error("Expected an initial invitation.");
  await redeemInitialInvite(db, { token: claimFirstInvite.token, participantId: claimant.id });
  await terminatePair(db, { pairId: claimFirst.pair.id, participantId: first.id });
  expect((await db.select().from(pairMembership).where(eq(pairMembership.pairId, claimFirst.pair.id))).every((membership) => membership.endedAt !== null)).toBe(true);

  const terminationFirst = await createPairForParticipant(db, { participantId: first.id, intendedPersonName: "Termination first", relationshipType: "partner" });
  pairIds.push(terminationFirst.pair.id);
  const terminationFirstInvite = await issueOrReuseInitialInvite(db, { pairId: terminationFirst.pair.id, participantId: first.id });
  if (terminationFirstInvite.state !== "issued") throw new Error("Expected an initial invitation.");
  await terminatePair(db, { pairId: terminationFirst.pair.id, participantId: first.id });
  expect(await capture(redeemInitialInvite(db, { token: terminationFirstInvite.token, participantId: claimant.id }))).toBeInstanceOf(CloserDomainError);
  expect((await db.select().from(pairMembership).where(eq(pairMembership.pairId, terminationFirst.pair.id)))).toHaveLength(1);
});

test("termination serializes guest replacement in both commit orders", async () => {
  const raced = await createJoinedPair();
  const racedInvite = await issueRejoinInvite(db, { pairId: raced.pairId, participantId: raced.first.id });
  const racedReplacementAuthUserId = await createGuestAuthUser("Replacement race participant");
  const [replacement, termination] = await Promise.allSettled([
    redeemRejoinInvite(db, { token: racedInvite.token, authUserId: racedReplacementAuthUserId, displayName: "Replacement race participant" }),
    terminatePair(db, { pairId: raced.pairId, participantId: raced.first.id }),
  ]);
  expect(termination.status).toBe("fulfilled");
  expect(["fulfilled", "rejected"]).toContain(replacement.status);
  const racedMemberships = await db.select().from(pairMembership).where(eq(pairMembership.pairId, raced.pairId));
  expect(racedMemberships.every((membership) => membership.endedAt !== null)).toBe(true);

  const replacementFirst = await createJoinedPair();
  const replacementFirstInvite = await issueRejoinInvite(db, { pairId: replacementFirst.pairId, participantId: replacementFirst.first.id });
  const replacementFirstAuthUserId = await createGuestAuthUser("Replacement first participant");
  const replacementFirstResult = await redeemRejoinInvite(db, { token: replacementFirstInvite.token, authUserId: replacementFirstAuthUserId, displayName: "Replacement first participant" });
  const replacementFirstMembership = (await db.select().from(pairMembership).where(and(eq(pairMembership.pairId, replacementFirst.pairId), eq(pairMembership.participantId, replacementFirstResult.participantId))))[0];
  expect(replacementFirstMembership).toBeDefined();
  expect((await db.select().from(pairMembershipEra).where(eq(pairMembershipEra.pairId, replacementFirst.pairId)))).toHaveLength(2);
  await terminatePair(db, { pairId: replacementFirst.pairId, participantId: replacementFirst.first.id });
  expect((await db.select().from(pairMembership).where(eq(pairMembership.pairId, replacementFirst.pairId))).every((membership) => membership.endedAt !== null)).toBe(true);

  const terminationFirst = await createJoinedPair();
  const terminationFirstInvite = await issueRejoinInvite(db, { pairId: terminationFirst.pairId, participantId: terminationFirst.first.id });
  const lateReplacementAuthUserId = await createGuestAuthUser("Late replacement participant");
  await terminatePair(db, { pairId: terminationFirst.pairId, participantId: terminationFirst.first.id });
  expect(await capture(redeemRejoinInvite(db, { token: terminationFirstInvite.token, authUserId: lateReplacementAuthUserId, displayName: "Late replacement participant" }))).toBeInstanceOf(CloserDomainError);
});

test("termination races retain only already-committed Together and candidate actions", async () => {
  await Promise.all([createTerminationQuestion("deep"), createTerminationQuestion("fun")]);
  const together = await createJoinedPair();
  const session = await startTogetherSession(db, { pairId: together.pairId, participantId: together.first.id, category: "deep" });
  const [advance, termination] = await Promise.allSettled([
    advanceTogetherSession(db, { pairId: together.pairId, participantId: together.first.id, sessionId: session.sessionId, action: "next" }),
    terminatePair(db, { pairId: together.pairId, participantId: together.first.id }),
  ]);
  expect(termination.status).toBe("fulfilled");
  expect(["fulfilled", "rejected"]).toContain(advance.status);
  expect((await db.select().from(togetherSession).where(eq(togetherSession.id, session.sessionId)))[0]?.endedAt).not.toBeNull();
  expect(await capture(advanceTogetherSession(db, { pairId: together.pairId, participantId: together.first.id, sessionId: session.sessionId, action: "next" }))).toBeInstanceOf(CloserDomainError);

  const askRace = await createJoinedPair();
  const candidate = await startOrResumePrivateConversation(db, { pairId: askRace.pairId, participantId: askRace.first.id, category: "fun", clientRequestId: randomUUID() });
  if (candidate.state !== "CANDIDATE") throw new Error("Expected a Private candidate.");
  const [ask, askTermination] = await Promise.allSettled([
    askPrivateQuestionCandidate(db, { pairId: askRace.pairId, participantId: askRace.first.id, conversationId: candidate.id, candidateId: candidate.candidate.id, clientRequestId: randomUUID() }),
    terminatePair(db, { pairId: askRace.pairId, participantId: askRace.first.id }),
  ]);
  expect(askTermination.status).toBe("fulfilled");
  const askedRounds = await db.select().from(privateRound).where(eq(privateRound.conversationId, candidate.id));
  expect(askedRounds).toHaveLength(ask.status === "fulfilled" ? 1 : 0);
  expect(await capture(setPrivateQuestionCandidateLike(db, { pairId: askRace.pairId, participantId: askRace.first.id, conversationId: candidate.id, candidateId: candidate.candidate.id, liked: true }))).toBeInstanceOf(CloserDomainError);

  const skipFirst = await createJoinedPair();
  const skipped = await startOrResumePrivateConversation(db, { pairId: skipFirst.pairId, participantId: skipFirst.first.id, category: "fun", clientRequestId: randomUUID() });
  if (skipped.state !== "CANDIDATE") throw new Error("Expected a Private candidate.");
  await skipPrivateQuestionCandidate(db, { pairId: skipFirst.pairId, participantId: skipFirst.first.id, conversationId: skipped.id, candidateId: skipped.candidate.id, clientRequestId: randomUUID() });
  await terminatePair(db, { pairId: skipFirst.pairId, participantId: skipFirst.first.id });
  expect((await db.select().from(privateQuestionCandidate).where(eq(privateQuestionCandidate.id, skipped.candidate.id)))[0]?.state).toBe("skipped");

  const likeFirst = await createJoinedPair();
  const liked = await startOrResumePrivateConversation(db, { pairId: likeFirst.pairId, participantId: likeFirst.first.id, category: "fun", clientRequestId: randomUUID() });
  if (liked.state !== "CANDIDATE") throw new Error("Expected a Private candidate.");
  await setPrivateQuestionCandidateLike(db, { pairId: likeFirst.pairId, participantId: likeFirst.first.id, conversationId: liked.id, candidateId: liked.candidate.id, liked: true });
  await terminatePair(db, { pairId: likeFirst.pairId, participantId: likeFirst.first.id });
  expect((await db.select().from(privateQuestionCandidate).where(eq(privateQuestionCandidate.id, liked.candidate.id)))[0]).toMatchObject({ liked: true, state: "invalidated" });

  const skipRace = await createJoinedPair();
  const skipCandidate = await startOrResumePrivateConversation(db, { pairId: skipRace.pairId, participantId: skipRace.first.id, category: "fun", clientRequestId: randomUUID() });
  if (skipCandidate.state !== "CANDIDATE") throw new Error("Expected a Private candidate.");
  const [skip, skipTermination] = await Promise.allSettled([
    skipPrivateQuestionCandidate(db, { pairId: skipRace.pairId, participantId: skipRace.first.id, conversationId: skipCandidate.id, candidateId: skipCandidate.candidate.id, clientRequestId: randomUUID() }),
    terminatePair(db, { pairId: skipRace.pairId, participantId: skipRace.first.id }),
  ]);
  expect(skipTermination.status).toBe("fulfilled");
  expect((await db.select().from(privateQuestionCandidate).where(eq(privateQuestionCandidate.id, skipCandidate.candidate.id)))[0]?.state).toBe(skip.status === "fulfilled" ? "skipped" : "invalidated");
  expect(await capture(skipPrivateQuestionCandidate(db, { pairId: skipRace.pairId, participantId: skipRace.first.id, conversationId: skipCandidate.id, candidateId: skipCandidate.candidate.id, clientRequestId: randomUUID() }))).toBeInstanceOf(CloserDomainError);

  const likeRace = await createJoinedPair();
  const likeCandidate = await startOrResumePrivateConversation(db, { pairId: likeRace.pairId, participantId: likeRace.first.id, category: "fun", clientRequestId: randomUUID() });
  if (likeCandidate.state !== "CANDIDATE") throw new Error("Expected a Private candidate.");
  const [like, likeTermination] = await Promise.allSettled([
    setPrivateQuestionCandidateLike(db, { pairId: likeRace.pairId, participantId: likeRace.first.id, conversationId: likeCandidate.id, candidateId: likeCandidate.candidate.id, liked: true }),
    terminatePair(db, { pairId: likeRace.pairId, participantId: likeRace.first.id }),
  ]);
  expect(likeTermination.status).toBe("fulfilled");
  expect((await db.select().from(privateQuestionCandidate).where(eq(privateQuestionCandidate.id, likeCandidate.candidate.id)))[0]).toMatchObject({ liked: like.status === "fulfilled", state: "invalidated" });

  const togetherFirst = await createJoinedPair();
  const advancedSession = await startTogetherSession(db, { pairId: togetherFirst.pairId, participantId: togetherFirst.first.id, category: "deep" });
  await advanceTogetherSession(db, { pairId: togetherFirst.pairId, participantId: togetherFirst.first.id, sessionId: advancedSession.sessionId, action: "next" });
  await terminatePair(db, { pairId: togetherFirst.pairId, participantId: togetherFirst.first.id });
  const togetherHistory = await getFormerEraHistoryForParticipant(db, { pairId: togetherFirst.pairId, participantId: togetherFirst.first.id });
  expect(togetherHistory.eras[0]?.togetherSessions.find((item) => item.id === advancedSession.sessionId)?.questions[0]?.advanced).toBe(true);

  const askFirst = await createJoinedPair();
  const asked = await askCurrentCandidate(askFirst.pairId, askFirst.first.id, "fun");
  await terminatePair(db, { pairId: askFirst.pairId, participantId: askFirst.first.id });
  expect(await db.select().from(privateRound).where(eq(privateRound.id, asked.asked.roundId))).toHaveLength(1);
});

test("termination races preserve committed Decline, Reveal, reaction, and reply history and reject later mutations", async () => {
  await Promise.all([createTerminationQuestion("deep"), createTerminationQuestion("fun")]);
  const declinedPair = await createJoinedPair();
  const declined = await askCurrentCandidate(declinedPair.pairId, declinedPair.first.id, "deep");
  const [decline, declineTermination] = await Promise.allSettled([
    declinePrivateRound(db, { pairId: declinedPair.pairId, participantId: declinedPair.second.id, roundId: declined.asked.roundId }),
    terminatePair(db, { pairId: declinedPair.pairId, participantId: declinedPair.first.id }),
  ]);
  expect(declineTermination.status).toBe("fulfilled");
  const declinedHistory = await getFormerEraHistoryForParticipant(db, { pairId: declinedPair.pairId, participantId: declinedPair.first.id });
  const declinedRound = declinedHistory.eras[0]?.privateConversations.flatMap((conversation) => conversation.rounds).find((round) => round.id === declined.asked.roundId);
  expect(declinedRound?.status).toBe(decline.status === "fulfilled" ? "passed" : "answered");

  const declineFirstPair = await createJoinedPair();
  const declinedFirst = await askCurrentCandidate(declineFirstPair.pairId, declineFirstPair.first.id, "deep");
  await declinePrivateRound(db, { pairId: declineFirstPair.pairId, participantId: declineFirstPair.second.id, roundId: declinedFirst.asked.roundId });
  await terminatePair(db, { pairId: declineFirstPair.pairId, participantId: declineFirstPair.first.id });
  const declineFirstHistory = await getFormerEraHistoryForParticipant(db, { pairId: declineFirstPair.pairId, participantId: declineFirstPair.first.id });
  expect(declineFirstHistory.eras[0]?.privateConversations.flatMap((conversation) => conversation.rounds).find((round) => round.id === declinedFirst.asked.roundId)?.status).toBe("passed");

  const revealPair = await createJoinedPair();
  const revealed = await askCurrentCandidate(revealPair.pairId, revealPair.first.id, "deep");
  await submitPrivateAnswer(db, { pairId: revealPair.pairId, participantId: revealPair.first.id, roundId: revealed.asked.roundId, body: "First reveal answer" });
  await submitPrivateAnswer(db, { pairId: revealPair.pairId, participantId: revealPair.second.id, roundId: revealed.asked.roundId, body: "Second reveal answer" });
  const [reveal, revealTermination] = await Promise.allSettled([
    markPrivateRevealViewed(db, { pairId: revealPair.pairId, participantId: revealPair.first.id, roundId: revealed.asked.roundId }),
    terminatePair(db, { pairId: revealPair.pairId, participantId: revealPair.second.id }),
  ]);
  expect(revealTermination.status).toBe("fulfilled");
  expect(["fulfilled", "rejected"]).toContain(reveal.status);
  expect(await capture(markPrivateRevealViewed(db, { pairId: revealPair.pairId, participantId: revealPair.second.id, roundId: revealed.asked.roundId }))).toBeInstanceOf(CloserDomainError);

  const revealFirstPair = await createJoinedPair();
  const revealedFirst = await askCurrentCandidate(revealFirstPair.pairId, revealFirstPair.first.id, "deep");
  await submitPrivateAnswer(db, { pairId: revealFirstPair.pairId, participantId: revealFirstPair.first.id, roundId: revealedFirst.asked.roundId, body: "First answer before termination" });
  await submitPrivateAnswer(db, { pairId: revealFirstPair.pairId, participantId: revealFirstPair.second.id, roundId: revealedFirst.asked.roundId, body: "Second answer before termination" });
  await markPrivateRevealViewed(db, { pairId: revealFirstPair.pairId, participantId: revealFirstPair.first.id, roundId: revealedFirst.asked.roundId });
  await terminatePair(db, { pairId: revealFirstPair.pairId, participantId: revealFirstPair.second.id });
  expect((await getFormerEraHistoryForParticipant(db, { pairId: revealFirstPair.pairId, participantId: revealFirstPair.first.id })).eras[0]?.privateConversations.flatMap((conversation) => conversation.rounds).find((round) => round.id === revealedFirst.asked.roundId)?.answers).toHaveLength(2);

  const reactionPair = await createJoinedPair();
  const reacted = await askCurrentCandidate(reactionPair.pairId, reactionPair.first.id, "fun");
  await submitPrivateAnswer(db, { pairId: reactionPair.pairId, participantId: reactionPair.first.id, roundId: reacted.asked.roundId, body: "First reaction answer" });
  await submitPrivateAnswer(db, { pairId: reactionPair.pairId, participantId: reactionPair.second.id, roundId: reacted.asked.roundId, body: "Second reaction answer" });
  await markPrivateRevealViewed(db, { pairId: reactionPair.pairId, participantId: reactionPair.first.id, roundId: reacted.asked.roundId });
  await markPrivateRevealViewed(db, { pairId: reactionPair.pairId, participantId: reactionPair.second.id, roundId: reacted.asked.roundId });
  const [reaction, reactionTermination] = await Promise.allSettled([
    setPrivateReaction(db, { pairId: reactionPair.pairId, participantId: reactionPair.first.id, roundId: reacted.asked.roundId, value: "heart" }),
    terminatePair(db, { pairId: reactionPair.pairId, participantId: reactionPair.second.id }),
  ]);
  expect(reactionTermination.status).toBe("fulfilled");
  const reactionHistory = await getFormerEraHistoryForParticipant(db, { pairId: reactionPair.pairId, participantId: reactionPair.first.id });
  const reactionRound = reactionHistory.eras[0]?.privateConversations.flatMap((conversation) => conversation.rounds).find((round) => round.id === reacted.asked.roundId);
  expect(reactionRound?.reactions).toHaveLength(reaction.status === "fulfilled" ? 1 : 0);
  expect(await capture(setPrivateReply(db, { pairId: reactionPair.pairId, participantId: reactionPair.second.id, roundId: reacted.asked.roundId, body: "Late reply" }))).toBeInstanceOf(CloserDomainError);

  const replyFirstPair = await createJoinedPair();
  const replied = await askCurrentCandidate(replyFirstPair.pairId, replyFirstPair.first.id, "fun");
  await submitPrivateAnswer(db, { pairId: replyFirstPair.pairId, participantId: replyFirstPair.first.id, roundId: replied.asked.roundId, body: "First reply answer" });
  await submitPrivateAnswer(db, { pairId: replyFirstPair.pairId, participantId: replyFirstPair.second.id, roundId: replied.asked.roundId, body: "Second reply answer" });
  await markPrivateRevealViewed(db, { pairId: replyFirstPair.pairId, participantId: replyFirstPair.first.id, roundId: replied.asked.roundId });
  await markPrivateRevealViewed(db, { pairId: replyFirstPair.pairId, participantId: replyFirstPair.second.id, roundId: replied.asked.roundId });
  await setPrivateReply(db, { pairId: replyFirstPair.pairId, participantId: replyFirstPair.first.id, roundId: replied.asked.roundId, body: "Reply retained in history" });
  await terminatePair(db, { pairId: replyFirstPair.pairId, participantId: replyFirstPair.second.id });
  expect((await getFormerEraHistoryForParticipant(db, { pairId: replyFirstPair.pairId, participantId: replyFirstPair.first.id })).eras[0]?.privateConversations.flatMap((conversation) => conversation.rounds).find((round) => round.id === replied.asked.roundId)?.replies.map((reply) => reply.body)).toEqual(["Reply retained in history"]);

  const replyRacePair = await createJoinedPair();
  const replyRace = await askCurrentCandidate(replyRacePair.pairId, replyRacePair.first.id, "fun");
  await submitPrivateAnswer(db, { pairId: replyRacePair.pairId, participantId: replyRacePair.first.id, roundId: replyRace.asked.roundId, body: "First concurrent reply answer" });
  await submitPrivateAnswer(db, { pairId: replyRacePair.pairId, participantId: replyRacePair.second.id, roundId: replyRace.asked.roundId, body: "Second concurrent reply answer" });
  await markPrivateRevealViewed(db, { pairId: replyRacePair.pairId, participantId: replyRacePair.first.id, roundId: replyRace.asked.roundId });
  await markPrivateRevealViewed(db, { pairId: replyRacePair.pairId, participantId: replyRacePair.second.id, roundId: replyRace.asked.roundId });
  const [reply, replyTermination] = await Promise.allSettled([
    setPrivateReply(db, { pairId: replyRacePair.pairId, participantId: replyRacePair.first.id, roundId: replyRace.asked.roundId, body: "Concurrent reply" }),
    terminatePair(db, { pairId: replyRacePair.pairId, participantId: replyRacePair.second.id }),
  ]);
  expect(replyTermination.status).toBe("fulfilled");
  expect((await getFormerEraHistoryForParticipant(db, { pairId: replyRacePair.pairId, participantId: replyRacePair.first.id })).eras[0]?.privateConversations.flatMap((conversation) => conversation.rounds).find((round) => round.id === replyRace.asked.roundId)?.replies).toHaveLength(reply.status === "fulfilled" ? 1 : 0);
});
