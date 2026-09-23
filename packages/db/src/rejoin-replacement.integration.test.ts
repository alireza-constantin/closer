import { randomUUID } from "node:crypto";

import { afterAll, afterEach, expect, test } from "bun:test";
import "./test-env";
import { and, eq, inArray, isNull } from "drizzle-orm";

const { createDb } = await import("./index");
const {
  CloserDomainError,
  advanceTogetherSession,
  activateQuestion,
  createAdminQuestion,
  createAdminQuestionRevision,
  selectSharedOpenPrivateCandidate: askPrivateQuestionCandidate,
  createPairForParticipant,
  retireSharedOpenPrivateRound: declinePrivateRound,
  endTogetherSession,
  getFormerEraHistoryForParticipant,
  getPrivateRoundForParticipant,
  getTogetherSessionForParticipant,
  issueOrReuseInitialInvite,
  issueRejoinInvite,
  listActivePrivateConversations,
  markPrivateRevealViewed,
  redeemInitialInvite,
  redeemRejoinInvite,
  resolveOrCreateParticipant,
  revokeRejoinInvites,
  startOrResumePrivateConversation,
  startTogetherSession,
  setPrivateReaction,
  setPrivateQuestionCandidateLike,
  setPrivateReply,
  skipPrivateQuestionCandidate,
  submitPrivateAnswer,
  terminatePair,
} = await import("./closer");
const {
  pair,
  pairMembership,
  pairMembershipEra,
  privateAnswer,
  privateConversation,
  privateQuestionCandidate,
  privateRound,
  question,
  questionLifecycleEvent,
  questionRevision,
  togetherSession,
  togetherSessionQuestion,
  participant,
} = await import("./schema/closer");
const { user } = await import("./schema/auth");

const db = createDb();
const userIds: string[] = [];
const pairIds: string[] = [];
const testQuestionIds: string[] = [];
const testAdminUserId = "00000000-0000-4000-8000-000000009004";

async function createTestAdminActor() {
  await db
    .insert(user)
    .values({
      id: testAdminUserId,
      name: "Rejoin test Admin actor",
      email: "rejoin-test-admin@closer.invalid",
      isAnonymous: false,
    })
    .onConflictDoNothing();
  return testAdminUserId;
}

async function createTestQuestion(
  category: "deep" | "fun" | "memories" | "relationship",
  modeFit: "both" | "private" | "together" = "private",
) {
  const adminUserId = await createTestAdminActor();
  const created = await createAdminQuestion(db, {
    text: `Rejoin regression ${category} ${randomUUID()}`,
    category,
    relationshipFit: category === "relationship" ? "partner" : "both",
    modeFit,
    intensity: "light",
    adminUserId,
  });
  testQuestionIds.push(created.question.id);
  await activateQuestion(db, { questionId: created.question.id, adminUserId });
  return created;
}

async function createGuestAuthUser(displayName: string) {
  const id = randomUUID();
  userIds.push(id);
  await db.insert(user).values({
    id,
    name: displayName,
    email: `${id}@replacement.closer.invalid`,
    isAnonymous: true,
  });
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
  const invite = await issueOrReuseInitialInvite(db, {
    participantId: continuing.id,
    pairId: created.pair.id,
  });
  if (invite.state !== "issued") throw new Error("Expected a fresh initial invitation.");
  await redeemInitialInvite(db, { token: invite.token, participantId: former.id });
  return { pairId: created.pair.id, continuing, former };
}

async function capture(promise: Promise<unknown>) {
  return promise.then(
    () => null,
    (error: unknown) => error,
  );
}

async function createLegacyPrivateRound(pairId: string, participantId: string, category = "deep") {
  const started = await startOrResumePrivateConversation(db, {
    pairId,
    participantId,
    category,
    clientRequestId: randomUUID(),
  });
  if (started.state !== "CANDIDATE") {
    if (started.state === "CURRENT_ROUND")
      return { roundId: started.roundId, conversationId: started.id };
    throw new Error("Expected a candidate for the legacy Round fixture.");
  }
  const inserted = await db
    .insert(privateRound)
    .values({
      pairId,
      conversationId: started.id,
      questionId: started.candidate.question.id,
      questionRevisionId: started.candidate.question.questionRevisionId,
      questionNumber: 1,
      initiatorParticipantId: participantId,
    })
    .returning({ id: privateRound.id });
  await db
    .update(privateQuestionCandidate)
    .set({ state: "asked", resolvedAt: new Date() })
    .where(eq(privateQuestionCandidate.id, started.candidate.id));
  if (!inserted[0]) throw new Error("Legacy Round fixture did not create a Round.");
  return { roundId: inserted[0].id, conversationId: started.id };
}

afterEach(async () => {
  if (pairIds.length) {
    await db.delete(privateConversation).where(inArray(privateConversation.pairId, pairIds));
    await db.delete(togetherSession).where(inArray(togetherSession.pairId, pairIds));
    await db.delete(pairMembershipEra).where(inArray(pairMembershipEra.pairId, pairIds));
    await db.delete(pairMembership).where(inArray(pairMembership.pairId, pairIds));
    await db.delete(pair).where(inArray(pair.id, pairIds));
  }
  if (testQuestionIds.length) {
    await db
      .delete(questionLifecycleEvent)
      .where(inArray(questionLifecycleEvent.questionId, testQuestionIds));
    await db
      .update(question)
      .set({ currentRevisionId: null })
      .where(inArray(question.id, testQuestionIds));
    await db.delete(questionRevision).where(inArray(questionRevision.questionId, testQuestionIds));
    await db.delete(question).where(inArray(question.id, testQuestionIds));
  }
  if (userIds.length) {
    await db.delete(participant).where(inArray(participant.authUserId, userIds));
    await db.delete(user).where(inArray(user.id, userIds));
  }
  pairIds.length = 0;
  userIds.length = 0;
  testQuestionIds.length = 0;
});

afterAll(async () => {
  await db.$client.end();
});

test("guest replacement atomically closes the old exact era and isolates its activity", async () => {
  const { pairId, continuing, former } = await createJoinedPair();
  const oldTogether = await startTogetherSession(db, {
    pairId,
    participantId: continuing.id,
    category: "deep",
  });
  const oldPrivate = await createLegacyPrivateRound(pairId, continuing.id);
  await submitPrivateAnswer(db, {
    pairId,
    participantId: continuing.id,
    roundId: oldPrivate.roundId,
    body: "Only the continuing member answered.",
  });
  const credential = await issueRejoinInvite(db, { pairId, participantId: continuing.id });
  const existingParticipant = await createGuest("Existing identity");
  const existingIdentity = (
    await db
      .select({ authUserId: participant.authUserId })
      .from(participant)
      .where(eq(participant.id, existingParticipant.id))
  )[0]!;
  expect(
    await capture(
      redeemRejoinInvite(db, {
        token: credential.token,
        authUserId: existingIdentity.authUserId,
        displayName: "Existing identity",
      }),
    ),
  ).toBeInstanceOf(CloserDomainError);
  const replacementAuthUserId = await createGuestAuthUser("Replacement");

  const redeemed = await redeemRejoinInvite(db, {
    token: credential.token,
    authUserId: replacementAuthUserId,
    displayName: "Replacement",
  });
  const replacement = { id: redeemed.participantId };
  expect(redeemed.pairId).toBe(pairId);

  const memberships = await db
    .select()
    .from(pairMembership)
    .where(eq(pairMembership.pairId, pairId));
  const oldMembership = memberships.find((membership) => membership.participantId === former.id)!;
  const newMembership = memberships.find(
    (membership) => membership.participantId === replacement.id,
  )!;
  expect(oldMembership.endedAt).not.toBeNull();
  expect(oldMembership.endedDisplayName).toBe("Former name");
  expect(newMembership.slot).toBe(oldMembership.slot);
  expect(newMembership.id).not.toBe(oldMembership.id);

  const eras = await db
    .select()
    .from(pairMembershipEra)
    .where(eq(pairMembershipEra.pairId, pairId));
  expect(eras.filter((era) => era.endedAt === null)).toHaveLength(1);
  const oldEra = eras.find((era) => era.endedAt !== null)!;
  const newEra = eras.find((era) => era.endedAt === null)!;
  expect([oldEra.firstMembershipId, oldEra.secondMembershipId]).toContain(oldMembership.id);
  expect([newEra.firstMembershipId, newEra.secondMembershipId]).toContain(newMembership.id);
  expect([newEra.firstMembershipId, newEra.secondMembershipId]).toContain(
    memberships.find((membership) => membership.participantId === continuing.id)!.id,
  );

  expect(
    (
      await db.select().from(togetherSession).where(eq(togetherSession.id, oldTogether.sessionId))
    )[0]?.endedAt,
  ).not.toBeNull();
  expect(
    await capture(
      getTogetherSessionForParticipant(db, {
        pairId,
        participantId: replacement.id,
        sessionId: oldTogether.sessionId,
      }),
    ),
  ).toBeInstanceOf(CloserDomainError);
  expect(
    await capture(
      advanceTogetherSession(db, {
        pairId,
        participantId: continuing.id,
        sessionId: oldTogether.sessionId,
        action: "next",
      }),
    ),
  ).toBeInstanceOf(CloserDomainError);
  expect(
    await capture(
      getPrivateRoundForParticipant(db, {
        pairId,
        participantId: replacement.id,
        roundId: oldPrivate.roundId,
      }),
    ),
  ).toBeInstanceOf(CloserDomainError);
  expect(
    await listActivePrivateConversations(db, { pairId, participantId: replacement.id }),
  ).toEqual([]);
  expect(
    (
      await getPrivateRoundForParticipant(db, {
        pairId,
        participantId: continuing.id,
        roundId: oldPrivate.roundId,
      })
    ).yourAnswer,
  ).toBe("Only the continuing member answered.");
  expect(
    await capture(
      submitPrivateAnswer(db, {
        pairId,
        participantId: former.id,
        roundId: oldPrivate.roundId,
        body: "Late former answer",
      }),
    ),
  ).toBeInstanceOf(CloserDomainError);
  expect(
    await capture(
      redeemRejoinInvite(db, {
        token: credential.token,
        authUserId: await createGuestAuthUser("Second replacement"),
        displayName: "Second replacement",
      }),
    ),
  ).toBeInstanceOf(CloserDomainError);

  const newPrivate = await startOrResumePrivateConversation(db, {
    pairId,
    participantId: replacement.id,
    category: "deep",
    clientRequestId: randomUUID(),
  });
  expect(newPrivate.conversationId).not.toBe(oldPrivate.conversationId);
  expect(
    (
      await db
        .select()
        .from(privateConversation)
        .where(eq(privateConversation.id, newPrivate.conversationId))
    )[0]?.membershipEraId,
  ).toBe(newEra.id);
});

test("rejoin replaces the participant while preserving its Pair slot and former era history", async () => {
  const { pairId, continuing, former } = await createJoinedPair();
  const oldPrivate = await createLegacyPrivateRound(pairId, former.id);
  await submitPrivateAnswer(db, {
    pairId,
    participantId: former.id,
    roundId: oldPrivate.roundId,
    body: "Former identity answer.",
  });
  const credential = await issueRejoinInvite(db, { pairId, participantId: continuing.id });
  const replacementAuthUserId = await createGuestAuthUser("Returning member");
  const oldMembership = (
    await db
      .select()
      .from(pairMembership)
      .where(
        and(
          eq(pairMembership.pairId, pairId),
          eq(pairMembership.participantId, former.id),
          isNull(pairMembership.endedAt),
        ),
      )
  )[0]!;
  const continuingMembership = (
    await db
      .select()
      .from(pairMembership)
      .where(
        and(
          eq(pairMembership.pairId, pairId),
          eq(pairMembership.participantId, continuing.id),
          isNull(pairMembership.endedAt),
        ),
      )
  )[0]!;
  const beforeEra = (
    await db
      .select()
      .from(pairMembershipEra)
      .where(and(eq(pairMembershipEra.pairId, pairId), isNull(pairMembershipEra.endedAt)))
  )[0]!;

  const replacement = await redeemRejoinInvite(db, {
    token: credential.token,
    authUserId: replacementAuthUserId,
    displayName: "Returning member",
  });

  expect(replacement.pairId).toBe(pairId);
  expect(replacement.participantId).not.toBe(former.id);
  expect(replacement.membershipEraId).not.toBe(beforeEra.id);

  const memberships = await db
    .select()
    .from(pairMembership)
    .where(eq(pairMembership.pairId, pairId));
  const formerMembership = memberships.find((membership) => membership.id === oldMembership.id)!;
  const replacementMembership = memberships.find(
    (membership) => membership.participantId === replacement.participantId,
  )!;
  expect(formerMembership.participantId).toBe(former.id);
  expect(formerMembership.endedAt).not.toBeNull();
  expect(replacementMembership.id).not.toBe(formerMembership.id);
  expect(replacementMembership.slot).toBe(formerMembership.slot);

  const eras = await db
    .select()
    .from(pairMembershipEra)
    .where(eq(pairMembershipEra.pairId, pairId));
  const formerEra = eras.find((era) => era.id === beforeEra.id)!;
  const replacementEra = eras.find((era) => era.id === replacement.membershipEraId)!;
  expect(formerEra.endedAt).not.toBeNull();
  expect([formerEra.firstMembershipId, formerEra.secondMembershipId]).toContain(oldMembership.id);
  expect(replacementEra.endedAt).toBeNull();
  expect([replacementEra.firstMembershipId, replacementEra.secondMembershipId]).toContain(
    replacementMembership.id,
  );
  expect([replacementEra.firstMembershipId, replacementEra.secondMembershipId]).toContain(
    continuingMembership.id,
  );

  expect(
    await capture(
      getPrivateRoundForParticipant(db, {
        pairId,
        participantId: replacement.participantId,
        roundId: oldPrivate.roundId,
      }),
    ),
  ).toBeInstanceOf(CloserDomainError);
  expect(
    await listActivePrivateConversations(db, { pairId, participantId: replacement.participantId }),
  ).toEqual([]);
  expect(
    (
      await db
        .select()
        .from(privateAnswer)
        .where(
          and(
            eq(privateAnswer.roundId, oldPrivate.roundId),
            eq(privateAnswer.participantId, former.id),
          ),
        )
    )[0]?.body,
  ).toBe("Former identity answer.");
  expect(
    (
      await db
        .select({ membershipEraId: privateConversation.membershipEraId })
        .from(privateRound)
        .innerJoin(privateConversation, eq(privateRound.conversationId, privateConversation.id))
        .where(eq(privateRound.id, oldPrivate.roundId))
    )[0]?.membershipEraId,
  ).toBe(beforeEra.id);
  expect(
    await capture(
      redeemRejoinInvite(db, {
        token: credential.token,
        authUserId: await createGuestAuthUser("Second rejoin attempt"),
        displayName: "Second rejoin attempt",
      }),
    ),
  ).toBeInstanceOf(CloserDomainError);
});

test("replacement serializes concurrent redemption and Pair-scoped Together and Private mutations", async () => {
  const concurrent = await createJoinedPair();
  const credential = await issueRejoinInvite(db, {
    pairId: concurrent.pairId,
    participantId: concurrent.continuing.id,
  });
  const [firstAuthUserId, secondAuthUserId] = await Promise.all([
    createGuestAuthUser("Concurrent replacement A"),
    createGuestAuthUser("Concurrent replacement B"),
  ]);
  const redemptions = await Promise.allSettled([
    redeemRejoinInvite(db, {
      token: credential.token,
      authUserId: firstAuthUserId,
      displayName: "Concurrent replacement A",
    }),
    redeemRejoinInvite(db, {
      token: credential.token,
      authUserId: secondAuthUserId,
      displayName: "Concurrent replacement B",
    }),
  ]);
  expect(redemptions.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  const activeTargetMembers = await db
    .select()
    .from(pairMembership)
    .where(
      and(
        eq(pairMembership.pairId, concurrent.pairId),
        eq(pairMembership.slot, "second"),
        isNull(pairMembership.endedAt),
      ),
    );
  expect(activeTargetMembers).toHaveLength(1);
  expect(
    await db
      .select()
      .from(pairMembershipEra)
      .where(
        and(eq(pairMembershipEra.pairId, concurrent.pairId), isNull(pairMembershipEra.endedAt)),
      ),
  ).toHaveLength(1);

  const togetherPair = await createJoinedPair();
  const session = await startTogetherSession(db, {
    pairId: togetherPair.pairId,
    participantId: togetherPair.continuing.id,
    category: "deep",
  });
  const togetherCredential = await issueRejoinInvite(db, {
    pairId: togetherPair.pairId,
    participantId: togetherPair.continuing.id,
  });
  const togetherReplacementAuthUserId = await createGuestAuthUser("Together replacement");
  const [advance, togetherReplacement] = await Promise.allSettled([
    advanceTogetherSession(db, {
      pairId: togetherPair.pairId,
      participantId: togetherPair.continuing.id,
      sessionId: session.sessionId,
      action: "next",
    }),
    redeemRejoinInvite(db, {
      token: togetherCredential.token,
      authUserId: togetherReplacementAuthUserId,
      displayName: "Together replacement",
    }),
  ]);
  expect(togetherReplacement.status).toBe("fulfilled");
  expect(
    (await db.select().from(togetherSession).where(eq(togetherSession.id, session.sessionId)))[0]
      ?.endedAt,
  ).not.toBeNull();
  expect(["fulfilled", "rejected"]).toContain(advance.status);

  const privatePair = await createJoinedPair();
  const privateRound = await createLegacyPrivateRound(
    privatePair.pairId,
    privatePair.continuing.id,
  );
  const privateCredential = await issueRejoinInvite(db, {
    pairId: privatePair.pairId,
    participantId: privatePair.continuing.id,
  });
  const privateReplacementAuthUserId = await createGuestAuthUser("Private replacement");
  const [answer, privateReplacement] = await Promise.allSettled([
    submitPrivateAnswer(db, {
      pairId: privatePair.pairId,
      participantId: privatePair.former.id,
      roundId: privateRound.roundId,
      body: "May commit before replacement.",
    }),
    redeemRejoinInvite(db, {
      token: privateCredential.token,
      authUserId: privateReplacementAuthUserId,
      displayName: "Private replacement",
    }),
  ]);
  expect(privateReplacement.status).toBe("fulfilled");
  expect(["fulfilled", "rejected"]).toContain(answer.status);
  expect(
    await db.select().from(privateAnswer).where(eq(privateAnswer.roundId, privateRound.roundId)),
  ).toHaveLength(answer.status === "fulfilled" ? 1 : 0);

  const credentialPair = await createJoinedPair();
  const revokeCredential = await issueRejoinInvite(db, {
    pairId: credentialPair.pairId,
    participantId: credentialPair.continuing.id,
  });
  const revokeReplacementAuthUserId = await createGuestAuthUser("Revocation race replacement");
  const [, revokeRedemption] = await Promise.allSettled([
    revokeRejoinInvites(db, {
      pairId: credentialPair.pairId,
      participantId: credentialPair.continuing.id,
    }),
    redeemRejoinInvite(db, {
      token: revokeCredential.token,
      authUserId: revokeReplacementAuthUserId,
      displayName: "Revocation race replacement",
    }),
  ]);
  expect(["fulfilled", "rejected"]).toContain(revokeRedemption.status);
});

test("former-era history is participant-relative, revision-pinned, and immutable", async () => {
  await Promise.all([
    createTestQuestion("deep", "both"),
    createTestQuestion("fun"),
    createTestQuestion("fun"),
    createTestQuestion("memories"),
    createTestQuestion("relationship"),
  ]);
  const { pairId, continuing, former } = await createJoinedPair();
  const mutualPair = await createJoinedPair();
  const mutualWithoutReveal = await createLegacyPrivateRound(
    mutualPair.pairId,
    mutualPair.continuing.id,
  );
  await submitPrivateAnswer(db, {
    pairId: mutualPair.pairId,
    participantId: mutualPair.continuing.id,
    roundId: mutualWithoutReveal.roundId,
    body: "Continuing's unseen answer.",
  });
  await submitPrivateAnswer(db, {
    pairId: mutualPair.pairId,
    participantId: mutualPair.former.id,
    roundId: mutualWithoutReveal.roundId,
    body: "Former's unseen answer.",
  });
  await terminatePair(db, {
    pairId: mutualPair.pairId,
    participantId: mutualPair.continuing.id,
  });

  const revealedRound = await createLegacyPrivateRound(pairId, continuing.id, "fun");
  await submitPrivateAnswer(db, {
    pairId,
    participantId: continuing.id,
    roundId: revealedRound.roundId,
    body: "Continuing's revealed answer.",
  });
  await submitPrivateAnswer(db, {
    pairId,
    participantId: former.id,
    roundId: revealedRound.roundId,
    body: "Former's revealed answer.",
  });
  await markPrivateRevealViewed(db, {
    pairId,
    participantId: continuing.id,
    roundId: revealedRound.roundId,
  });
  await markPrivateRevealViewed(db, {
    pairId,
    participantId: former.id,
    roundId: revealedRound.roundId,
  });
  await setPrivateReaction(db, {
    pairId,
    participantId: continuing.id,
    roundId: revealedRound.roundId,
    value: "heart",
  });
  await setPrivateReply(db, {
    pairId,
    participantId: former.id,
    roundId: revealedRound.roundId,
    body: "A saved reply.",
  });
  const oldCandidate = await startOrResumePrivateConversation(db, {
    pairId,
    participantId: continuing.id,
    category: "fun",
    clientRequestId: randomUUID(),
  });
  if (oldCandidate.state !== "CANDIDATE")
    throw new Error("Expected an unresolved old-era candidate.");

  const loneAnswer = await createLegacyPrivateRound(pairId, continuing.id, "memories");
  await submitPrivateAnswer(db, {
    pairId,
    participantId: former.id,
    roundId: loneAnswer.roundId,
    body: "Only Former may read this.",
  });
  await declinePrivateRound(db, {
    pairId,
    participantId: continuing.id,
    roundId: loneAnswer.roundId,
  });
  const declinedRound = await createLegacyPrivateRound(pairId, continuing.id, "relationship");
  await submitPrivateAnswer(db, {
    pairId,
    participantId: former.id,
    roundId: declinedRound.roundId,
    body: "A passed-round answer.",
  });
  await declinePrivateRound(db, {
    pairId,
    participantId: continuing.id,
    roundId: declinedRound.roundId,
  });
  const together = await startTogetherSession(db, {
    pairId,
    participantId: continuing.id,
    category: "deep",
  });
  await endTogetherSession(db, {
    pairId,
    participantId: continuing.id,
    sessionId: together.sessionId,
  });

  const credential = await issueRejoinInvite(db, { pairId, participantId: continuing.id });
  const replacementAuthUserId = await createGuestAuthUser("Replacement");
  const redeemed = await redeemRejoinInvite(db, {
    token: credential.token,
    authUserId: replacementAuthUserId,
    displayName: "Replacement",
  });
  const replacement = { id: redeemed.participantId };

  const originalRound = (
    await db.select().from(privateRound).where(eq(privateRound.id, mutualWithoutReveal.roundId))
  )[0]!;
  const originalRevision = (
    await db
      .select()
      .from(questionRevision)
      .where(eq(questionRevision.id, originalRound.questionRevisionId))
  )[0]!;
  const [originalQuestionState] = await db
    .select({ currentRevisionId: question.currentRevisionId })
    .from(question)
    .where(eq(question.id, originalRevision.questionId))
    .limit(1);
  if (!originalQuestionState?.currentRevisionId)
    throw new Error("Original Question has no current revision.");
  await createAdminQuestionRevision(db, {
    questionId: originalRevision.questionId,
    expectedCurrentRevisionId: originalQuestionState.currentRevisionId,
    adminUserId: await createTestAdminActor(),
    text: "A later edit must not replace history.",
    category: originalRevision.category,
    relationshipFit: originalRevision.relationshipFit,
    modeFit: originalRevision.modeFit,
    intensity: originalRevision.intensity,
  });
  const originalTogetherCard = (
    await db
      .select()
      .from(togetherSessionQuestion)
      .where(eq(togetherSessionQuestion.sessionId, together.sessionId))
  )[0]!;
  const originalTogetherRevision = (
    await db
      .select()
      .from(questionRevision)
      .where(eq(questionRevision.id, originalTogetherCard.questionRevisionId))
  )[0]!;
  const [originalTogetherQuestionState] = await db
    .select({ currentRevisionId: question.currentRevisionId })
    .from(question)
    .where(eq(question.id, originalTogetherRevision.questionId))
    .limit(1);
  if (!originalTogetherQuestionState?.currentRevisionId)
    throw new Error("Original Together Question has no current revision.");
  await createAdminQuestionRevision(db, {
    questionId: originalTogetherRevision.questionId,
    expectedCurrentRevisionId: originalTogetherQuestionState.currentRevisionId,
    adminUserId: await createTestAdminActor(),
    text: "A later Together edit must not replace history.",
    category: originalTogetherRevision.category,
    relationshipFit: originalTogetherRevision.relationshipFit,
    modeFit: originalTogetherRevision.modeFit,
    intensity: originalTogetherRevision.intensity,
  });
  await db
    .update(participant)
    .set({ displayName: "Renamed Former" })
    .where(eq(participant.id, former.id));

  const continuingHistory = await getFormerEraHistoryForParticipant(db, {
    pairId,
    participantId: continuing.id,
  });
  const formerHistory = await getFormerEraHistoryForParticipant(db, {
    pairId,
    participantId: former.id,
  });
  const replacementHistory = await getFormerEraHistoryForParticipant(db, {
    pairId,
    participantId: replacement.id,
  });
  const mutualContinuingHistory = await getFormerEraHistoryForParticipant(db, {
    pairId: mutualPair.pairId,
    participantId: mutualPair.continuing.id,
  });
  const mutualFormerHistory = await getFormerEraHistoryForParticipant(db, {
    pairId: mutualPair.pairId,
    participantId: mutualPair.former.id,
  });
  const continuingRounds = continuingHistory.eras[0]!.privateConversations.flatMap(
    (conversation) => conversation.rounds,
  );
  const formerRounds = formerHistory.eras[0]!.privateConversations.flatMap(
    (conversation) => conversation.rounds,
  );
  const mutualContinuingRounds = mutualContinuingHistory.eras[0]!.privateConversations.flatMap(
    (conversation) => conversation.rounds,
  );
  const mutualFormerRounds = mutualFormerHistory.eras[0]!.privateConversations.flatMap(
    (conversation) => conversation.rounds,
  );
  const continuingMutual = mutualContinuingRounds.find(
    (round) => round.id === mutualWithoutReveal.roundId,
  )!;
  const formerMutual = mutualFormerRounds.find(
    (round) => round.id === mutualWithoutReveal.roundId,
  )!;
  const continuingLone = continuingRounds.find((round) => round.id === loneAnswer.roundId)!;
  const formerLone = formerRounds.find((round) => round.id === loneAnswer.roundId)!;
  const continuingDeclined = continuingRounds.find((round) => round.id === declinedRound.roundId)!;
  const formerDeclined = formerRounds.find((round) => round.id === declinedRound.roundId)!;
  const revealedHistory = continuingRounds.find((round) => round.id === revealedRound.roundId)!;

  expect(continuingMutual.question.text).toBe(originalRevision.text);
  expect(continuingMutual.answers.map((answer) => answer.body)).toEqual([
    "Continuing's unseen answer.",
    "Former's unseen answer.",
  ]);
  expect(formerMutual.answers).toHaveLength(2);
  expect(
    continuingMutual.answers.find((answer) => answer.participantId === mutualPair.former.id)
      ?.displayName,
  ).toBe("Former name");
  expect(continuingLone.answers).toEqual([]);
  expect(formerLone.answers.map((answer) => answer.body)).toEqual(["Only Former may read this."]);
  expect(continuingDeclined.status).toBe("passed");
  expect(continuingDeclined.answers).toEqual([]);
  expect(formerDeclined.answers.map((answer) => answer.body)).toEqual(["A passed-round answer."]);
  expect(JSON.stringify(continuingDeclined)).not.toContain("declinedBy");
  expect(revealedHistory.reactions).toHaveLength(1);
  expect(revealedHistory.replies).toHaveLength(1);
  expect(continuingHistory.eras[0]!.togetherSessions[0]?.questions[0]?.text).toBe(
    originalTogetherRevision.text,
  );
  expect(JSON.stringify(continuingHistory)).not.toContain(oldCandidate.candidate.question.text);
  expect(replacementHistory.eras).toEqual([]);
  expect(replacementHistory.preClaimTogetherSessions).toEqual([]);
  expect(JSON.stringify(replacementHistory)).not.toContain(oldCandidate.candidate.question.text);
  expect(
    await capture(
      askPrivateQuestionCandidate(db, {
        pairId,
        participantId: continuing.id,
        conversationId: oldCandidate.id,
        candidateId: oldCandidate.candidate.id,
        clientRequestId: randomUUID(),
      }),
    ),
  ).toBeInstanceOf(CloserDomainError);
  expect(
    await capture(
      skipPrivateQuestionCandidate(db, {
        pairId,
        participantId: continuing.id,
        conversationId: oldCandidate.id,
        candidateId: oldCandidate.candidate.id,
      }),
    ),
  ).toBeInstanceOf(CloserDomainError);
  expect(
    await capture(
      setPrivateQuestionCandidateLike(db, {
        pairId,
        participantId: continuing.id,
        conversationId: oldCandidate.id,
        candidateId: oldCandidate.candidate.id,
        liked: true,
      }),
    ),
  ).toBeInstanceOf(CloserDomainError);
  expect(
    await capture(
      submitPrivateAnswer(db, {
        pairId: mutualPair.pairId,
        participantId: mutualPair.continuing.id,
        roundId: mutualWithoutReveal.roundId,
        body: "A late answer.",
      }),
    ),
  ).toBeInstanceOf(CloserDomainError);
  expect(
    await capture(
      declinePrivateRound(db, {
        pairId,
        participantId: continuing.id,
        roundId: mutualWithoutReveal.roundId,
      }),
    ),
  ).toBeInstanceOf(CloserDomainError);
  expect(
    await capture(
      markPrivateRevealViewed(db, {
        pairId,
        participantId: continuing.id,
        roundId: mutualWithoutReveal.roundId,
      }),
    ),
  ).toBeInstanceOf(CloserDomainError);
  expect(
    await capture(
      setPrivateReaction(db, {
        pairId,
        participantId: continuing.id,
        roundId: revealedRound.roundId,
        value: "laugh",
      }),
    ),
  ).toBeInstanceOf(CloserDomainError);
  expect(
    await capture(
      setPrivateReply(db, {
        pairId,
        participantId: former.id,
        roundId: revealedRound.roundId,
        body: "A changed reply.",
      }),
    ),
  ).toBeInstanceOf(CloserDomainError);
  expect(
    await capture(
      advanceTogetherSession(db, {
        pairId,
        participantId: continuing.id,
        sessionId: together.sessionId,
        action: "next",
      }),
    ),
  ).toBeInstanceOf(CloserDomainError);

  const newEraConversation = await startOrResumePrivateConversation(db, {
    pairId,
    participantId: replacement.id,
    category: "deep",
    clientRequestId: randomUUID(),
  });
  expect(newEraConversation.conversationId).not.toBe(mutualWithoutReveal.conversationId);
  expect(
    await capture(
      getFormerEraHistoryForParticipant(db, {
        pairId,
        participantId: (await createGuest("Outsider")).id,
      }),
    ),
  ).toBeInstanceOf(CloserDomainError);
});

test("pre-claim Together history stays with the original sole member", async () => {
  const original = await createGuest("Original");
  const claimant = await createGuest("Claimant");
  const created = await createPairForParticipant(db, {
    participantId: original.id,
    intendedPersonName: "Claimant",
    relationshipType: "partner",
  });
  pairIds.push(created.pair.id);
  const session = await startTogetherSession(db, {
    pairId: created.pair.id,
    participantId: original.id,
    category: "deep",
  });
  await endTogetherSession(db, {
    pairId: created.pair.id,
    participantId: original.id,
    sessionId: session.sessionId,
  });
  const invite = await issueOrReuseInitialInvite(db, {
    pairId: created.pair.id,
    participantId: original.id,
  });
  if (invite.state !== "issued") throw new Error("Expected an initial invitation.");
  await redeemInitialInvite(db, { token: invite.token, participantId: claimant.id });

  const originalHistory = await getFormerEraHistoryForParticipant(db, {
    pairId: created.pair.id,
    participantId: original.id,
  });
  const claimantHistory = await getFormerEraHistoryForParticipant(db, {
    pairId: created.pair.id,
    participantId: claimant.id,
  });
  expect(originalHistory.preClaimTogetherSessions.map((item) => item.id)).toContain(
    session.sessionId,
  );
  expect(claimantHistory.preClaimTogetherSessions).toEqual([]);
});
