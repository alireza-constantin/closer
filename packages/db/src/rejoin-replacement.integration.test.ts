import { randomUUID } from "node:crypto";

import { afterAll, afterEach, expect, test } from "bun:test";
import dotenv from "dotenv";
import { and, eq, inArray, isNull } from "drizzle-orm";

dotenv.config({ path: new URL("../../../apps/web/.env", import.meta.url) });

const { createDb } = await import("./index");
const {
  CloserDomainError,
  advanceTogetherSession,
  createPairForParticipant,
  getPrivateRoundForParticipant,
  getTogetherSessionForParticipant,
  issueOrReuseInitialInvite,
  issueRejoinInvite,
  listActivePrivateConversations,
  redeemInitialInvite,
  redeemRejoinInvite,
  resolveOrCreateParticipant,
  revokeRejoinInvites,
  startOrResumePrivateConversation,
  startTogetherSession,
  submitPrivateAnswer,
} = await import("./closer");
const { pair, pairMembership, pairMembershipEra, privateAnswer, privateConversation, togetherSession, participant } = await import("./schema/closer");
const { user } = await import("./schema/auth");

const db = createDb();
const userIds: string[] = [];
const pairIds: string[] = [];

async function createGuestAuthUser(displayName: string) {
  const id = randomUUID();
  userIds.push(id);
  await db.insert(user).values({ id, name: displayName, email: `${id}@replacement.closer.invalid`, isAnonymous: true });
  return id;
}

async function createGuest(displayName: string) {
  const authUserId = await createGuestAuthUser(displayName);
  return resolveOrCreateParticipant(db, { authUserId, displayName });
}

async function createJoinedPair() {
  const continuing = await createGuest("Continuing");
  const former = await createGuest("Former name");
  const created = await createPairForParticipant(db, {
    participantId: continuing.id,
    intendedPersonName: "Former name",
    relationshipType: "partner",
  });
  pairIds.push(created.pair.id);
  const invite = await issueOrReuseInitialInvite(db, { participantId: continuing.id, pairId: created.pair.id });
  if (invite.state !== "issued") throw new Error("Expected a fresh initial invitation.");
  await redeemInitialInvite(db, { token: invite.token, participantId: former.id });
  return { pairId: created.pair.id, continuing, former };
}

async function capture(promise: Promise<unknown>) {
  return promise.then(() => null, (error: unknown) => error);
}

afterEach(async () => {
  if (pairIds.length) {
    await db.delete(privateConversation).where(inArray(privateConversation.pairId, pairIds));
    await db.delete(togetherSession).where(inArray(togetherSession.pairId, pairIds));
    await db.delete(pairMembershipEra).where(inArray(pairMembershipEra.pairId, pairIds));
    await db.delete(pairMembership).where(inArray(pairMembership.pairId, pairIds));
    await db.delete(pair).where(inArray(pair.id, pairIds));
  }
  if (userIds.length) {
    await db.delete(participant).where(inArray(participant.authUserId, userIds));
    await db.delete(user).where(inArray(user.id, userIds));
  }
  pairIds.length = 0;
  userIds.length = 0;
});

afterAll(async () => { await db.$client.end(); });

test("guest replacement atomically closes the old exact era and isolates its activity", async () => {
  const { pairId, continuing, former } = await createJoinedPair();
  const oldTogether = await startTogetherSession(db, { pairId, participantId: continuing.id, category: "deep" });
  const oldPrivate = await startOrResumePrivateConversation(db, {
    pairId,
    participantId: continuing.id,
    category: "deep",
    clientRequestId: randomUUID(),
  });
  await submitPrivateAnswer(db, { pairId, participantId: continuing.id, roundId: oldPrivate.roundId, body: "Only the continuing member answered." });
  const credential = await issueRejoinInvite(db, { pairId, participantId: continuing.id });
  const existingParticipant = await createGuest("Existing identity");
  const existingIdentity = (await db.select({ authUserId: participant.authUserId }).from(participant).where(eq(participant.id, existingParticipant.id)))[0]!;
  expect(await capture(redeemRejoinInvite(db, { token: credential.token, authUserId: existingIdentity.authUserId, displayName: "Existing identity" }))).toBeInstanceOf(CloserDomainError);
  const replacementAuthUserId = await createGuestAuthUser("Replacement");

  const redeemed = await redeemRejoinInvite(db, { token: credential.token, authUserId: replacementAuthUserId, displayName: "Replacement" });
  const replacement = { id: redeemed.participantId };
  expect(redeemed.pairId).toBe(pairId);

  const memberships = await db.select().from(pairMembership).where(eq(pairMembership.pairId, pairId));
  const oldMembership = memberships.find((membership) => membership.participantId === former.id)!;
  const newMembership = memberships.find((membership) => membership.participantId === replacement.id)!;
  expect(oldMembership.endedAt).not.toBeNull();
  expect(oldMembership.endedDisplayName).toBe("Former name");
  expect(newMembership.slot).toBe(oldMembership.slot);
  expect(newMembership.id).not.toBe(oldMembership.id);

  const eras = await db.select().from(pairMembershipEra).where(eq(pairMembershipEra.pairId, pairId));
  expect(eras.filter((era) => era.endedAt === null)).toHaveLength(1);
  const oldEra = eras.find((era) => era.endedAt !== null)!;
  const newEra = eras.find((era) => era.endedAt === null)!;
  expect([oldEra.firstMembershipId, oldEra.secondMembershipId]).toContain(oldMembership.id);
  expect([newEra.firstMembershipId, newEra.secondMembershipId]).toContain(newMembership.id);
  expect([newEra.firstMembershipId, newEra.secondMembershipId]).toContain(memberships.find((membership) => membership.participantId === continuing.id)!.id);

  expect((await db.select().from(togetherSession).where(eq(togetherSession.id, oldTogether.sessionId)))[0]?.endedAt).not.toBeNull();
  expect(await capture(getTogetherSessionForParticipant(db, { pairId, participantId: replacement.id, sessionId: oldTogether.sessionId }))).toBeInstanceOf(CloserDomainError);
  expect(await capture(advanceTogetherSession(db, { pairId, participantId: continuing.id, sessionId: oldTogether.sessionId, action: "next" }))).toBeInstanceOf(CloserDomainError);
  expect(await capture(getPrivateRoundForParticipant(db, { pairId, participantId: replacement.id, roundId: oldPrivate.roundId }))).toBeInstanceOf(CloserDomainError);
  expect(await listActivePrivateConversations(db, { pairId, participantId: replacement.id })).toEqual([]);
  expect((await getPrivateRoundForParticipant(db, { pairId, participantId: continuing.id, roundId: oldPrivate.roundId })).yourAnswer).toBe("Only the continuing member answered.");
  expect(await capture(submitPrivateAnswer(db, { pairId, participantId: former.id, roundId: oldPrivate.roundId, body: "Late former answer" }))).toBeInstanceOf(CloserDomainError);
  expect(await capture(redeemRejoinInvite(db, { token: credential.token, authUserId: await createGuestAuthUser("Second replacement"), displayName: "Second replacement" }))).toBeInstanceOf(CloserDomainError);

  const newPrivate = await startOrResumePrivateConversation(db, {
    pairId,
    participantId: replacement.id,
    category: "deep",
    clientRequestId: randomUUID(),
  });
  expect(newPrivate.conversationId).not.toBe(oldPrivate.conversationId);
  expect((await db.select().from(privateConversation).where(eq(privateConversation.id, newPrivate.conversationId)))[0]?.membershipEraId).toBe(newEra.id);
});

test("replacement serializes concurrent redemption and Pair-scoped Together and Private mutations", async () => {
  const concurrent = await createJoinedPair();
  const credential = await issueRejoinInvite(db, { pairId: concurrent.pairId, participantId: concurrent.continuing.id });
  const [firstAuthUserId, secondAuthUserId] = await Promise.all([
    createGuestAuthUser("Concurrent replacement A"),
    createGuestAuthUser("Concurrent replacement B"),
  ]);
  const redemptions = await Promise.allSettled([
    redeemRejoinInvite(db, { token: credential.token, authUserId: firstAuthUserId, displayName: "Concurrent replacement A" }),
    redeemRejoinInvite(db, { token: credential.token, authUserId: secondAuthUserId, displayName: "Concurrent replacement B" }),
  ]);
  expect(redemptions.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  const activeTargetMembers = await db
    .select()
    .from(pairMembership)
    .where(and(eq(pairMembership.pairId, concurrent.pairId), eq(pairMembership.slot, "second"), isNull(pairMembership.endedAt)));
  expect(activeTargetMembers).toHaveLength(1);
  expect((await db.select().from(pairMembershipEra).where(and(eq(pairMembershipEra.pairId, concurrent.pairId), isNull(pairMembershipEra.endedAt))))).toHaveLength(1);

  const togetherPair = await createJoinedPair();
  const session = await startTogetherSession(db, { pairId: togetherPair.pairId, participantId: togetherPair.continuing.id, category: "deep" });
  const togetherCredential = await issueRejoinInvite(db, { pairId: togetherPair.pairId, participantId: togetherPair.continuing.id });
  const togetherReplacementAuthUserId = await createGuestAuthUser("Together replacement");
  const [advance, togetherReplacement] = await Promise.allSettled([
    advanceTogetherSession(db, { pairId: togetherPair.pairId, participantId: togetherPair.continuing.id, sessionId: session.sessionId, action: "next" }),
    redeemRejoinInvite(db, { token: togetherCredential.token, authUserId: togetherReplacementAuthUserId, displayName: "Together replacement" }),
  ]);
  expect(togetherReplacement.status).toBe("fulfilled");
  expect((await db.select().from(togetherSession).where(eq(togetherSession.id, session.sessionId)))[0]?.endedAt).not.toBeNull();
  expect(["fulfilled", "rejected"]).toContain(advance.status);

  const privatePair = await createJoinedPair();
  const privateRound = await startOrResumePrivateConversation(db, { pairId: privatePair.pairId, participantId: privatePair.continuing.id, category: "deep", clientRequestId: randomUUID() });
  const privateCredential = await issueRejoinInvite(db, { pairId: privatePair.pairId, participantId: privatePair.continuing.id });
  const privateReplacementAuthUserId = await createGuestAuthUser("Private replacement");
  const [answer, privateReplacement] = await Promise.allSettled([
    submitPrivateAnswer(db, { pairId: privatePair.pairId, participantId: privatePair.former.id, roundId: privateRound.roundId, body: "May commit before replacement." }),
    redeemRejoinInvite(db, { token: privateCredential.token, authUserId: privateReplacementAuthUserId, displayName: "Private replacement" }),
  ]);
  expect(privateReplacement.status).toBe("fulfilled");
  expect(["fulfilled", "rejected"]).toContain(answer.status);
  expect(await db.select().from(privateAnswer).where(eq(privateAnswer.roundId, privateRound.roundId))).toHaveLength(answer.status === "fulfilled" ? 1 : 0);

  const credentialPair = await createJoinedPair();
  const revokeCredential = await issueRejoinInvite(db, { pairId: credentialPair.pairId, participantId: credentialPair.continuing.id });
  const revokeReplacementAuthUserId = await createGuestAuthUser("Revocation race replacement");
  const [, revokeRedemption] = await Promise.allSettled([
    revokeRejoinInvites(db, { pairId: credentialPair.pairId, participantId: credentialPair.continuing.id }),
    redeemRejoinInvite(db, { token: revokeCredential.token, authUserId: revokeReplacementAuthUserId, displayName: "Revocation race replacement" }),
  ]);
  expect(["fulfilled", "rejected"]).toContain(revokeRedemption.status);
});
