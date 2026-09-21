import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, mock, test } from "bun:test";
import { inArray } from "drizzle-orm";
import dotenv from "dotenv";

import type { AdminQuestionListItem } from "@/contracts/admin/question.schema";
import type { AdminSession } from "@/server/http/admin-http";

dotenv.config({ path: new URL("../../../../../../apps/web/.env.local", import.meta.url) });

const { db } = await import("@Closer/db");
const { createAdminQuestion, createAdminQuestionRevision } = await import("@Closer/db/closer");
const {
  pair,
  pairMembership,
  pairMembershipEra,
  participant,
  privateConversation,
  privateQuestionCandidate,
  question,
  questionRevision,
  togetherSession,
  togetherSessionQuestion,
} = await import("@Closer/db/schema/closer");
const { user } = await import("@Closer/db/schema/auth");

mock.module("server-only", () => ({}));
const { getAdminQuestionAnalyticsDetail, listAdminQuestionAnalytics } =
  await import("./admin-question-analytics.service");

const adminUserId = `admin-analytics-${randomUUID()}`;
const pairIds: string[] = [];
const participantIds: string[] = [];
const authUserIds: string[] = [];
const questionIds: string[] = [];
const privateConversationByPairAndCategory = new Map<string, string>();
const togetherSessionByPairQuestionRevision = new Map<string, string>();

await db.insert(user).values({
  id: adminUserId,
  name: "Admin analytics test actor",
  email: `${adminUserId}@closer.invalid`,
  isAnonymous: false,
});

async function createPairFixture(index: number) {
  const pairId = randomUUID();
  const firstParticipantId = randomUUID();
  const secondParticipantId = randomUUID();
  const firstAuthUserId = randomUUID();
  const secondAuthUserId = randomUUID();
  const firstMembershipId = randomUUID();
  const secondMembershipId = randomUUID();
  const membershipEraId = randomUUID();

  authUserIds.push(firstAuthUserId, secondAuthUserId);
  participantIds.push(firstParticipantId, secondParticipantId);
  pairIds.push(pairId);

  await db.insert(user).values([
    {
      id: firstAuthUserId,
      name: `Analytics Pair ${index} A`,
      email: `${firstAuthUserId}@closer.invalid`,
      isAnonymous: true,
    },
    {
      id: secondAuthUserId,
      name: `Analytics Pair ${index} B`,
      email: `${secondAuthUserId}@closer.invalid`,
      isAnonymous: true,
    },
  ]);
  await db.insert(participant).values([
    { id: firstParticipantId, authUserId: firstAuthUserId, displayName: `Person ${index} A` },
    { id: secondParticipantId, authUserId: secondAuthUserId, displayName: `Person ${index} B` },
  ]);
  await db.insert(pair).values({ id: pairId, relationshipType: "partner" });
  await db.insert(pairMembership).values([
    { id: firstMembershipId, pairId, participantId: firstParticipantId, slot: "first" },
    { id: secondMembershipId, pairId, participantId: secondParticipantId, slot: "second" },
  ]);
  await db.insert(pairMembershipEra).values({
    id: membershipEraId,
    pairId,
    firstMembershipId,
    secondMembershipId,
  });

  const fixture = { pairId, participantId: firstParticipantId, membershipEraId };
  return fixture;
}

const questionFields = {
  text: "How does this question help you connect?",
  category: "fun" as const,
  relationshipFit: "both" as const,
  modeFit: "both" as const,
  intensity: "medium" as const,
};
const historicalFields = {
  ...questionFields,
  text: "What is one small thing that made you smile?",
};
const suppressedQuestionFields = {
  text: "What helps you feel understood?",
  category: "deep" as const,
  relationshipFit: "both" as const,
  modeFit: "both" as const,
  intensity: "deep" as const,
};

const primaryCreated = await createAdminQuestion(db, { ...historicalFields, adminUserId });
const primaryQuestionId = primaryCreated.question.id;
const primaryHistoricalRevisionId = primaryCreated.revision.id;
questionIds.push(primaryQuestionId);
const currentCreated = await createAdminQuestionRevision(db, {
  ...questionFields,
  questionId: primaryQuestionId,
  expectedCurrentRevisionId: primaryHistoricalRevisionId,
  adminUserId,
});
const primaryCurrentRevisionId = currentCreated.revision.id;

const suppressedCreated = await createAdminQuestion(db, {
  ...suppressedQuestionFields,
  adminUserId,
});
questionIds.push(suppressedCreated.question.id);

const pairFixtures = await Promise.all(
  Array.from({ length: 5 }, (_, index) => createPairFixture(index + 1)),
);

async function conversationFor(
  pairFixture: (typeof pairFixtures)[number],
  category: "fun" | "deep",
) {
  const key = `${pairFixture.pairId}:${category}`;
  const existing = privateConversationByPairAndCategory.get(key);
  if (existing) return existing;
  const conversationId = randomUUID();
  await db.insert(privateConversation).values({
    id: conversationId,
    pairId: pairFixture.pairId,
    membershipEraId: pairFixture.membershipEraId,
    createdByParticipantId: pairFixture.participantId,
    category,
  });
  privateConversationByPairAndCategory.set(key, conversationId);
  return conversationId;
}

async function addPrivateCandidate(
  pairFixture: (typeof pairFixtures)[number],
  fields: { questionId: string; revisionId: string; category: "fun" | "deep" },
  state: "asked" | "skipped" | "unresolved" | "invalidated",
  liked: boolean,
) {
  const conversationId = await conversationFor(pairFixture, fields.category);
  await db.insert(privateQuestionCandidate).values({
    conversationId,
    questionId: fields.questionId,
    questionRevisionId: fields.revisionId,
    state,
    likedAt: liked ? new Date() : null,
    resolvedAt: state === "unresolved" ? null : new Date(),
  });
}

async function togetherSessionFor(
  pairFixture: (typeof pairFixtures)[number],
  questionId: string,
  revisionId: string,
  category: "fun" | "deep",
) {
  const key = `${pairFixture.pairId}:${questionId}:${revisionId}`;
  const existing = togetherSessionByPairQuestionRevision.get(key);
  if (existing) return existing;
  const sessionId = randomUUID();
  await db.insert(togetherSession).values({
    id: sessionId,
    pairId: pairFixture.pairId,
    membershipEraId: pairFixture.membershipEraId,
    startedByParticipantId: pairFixture.participantId,
    category,
  });
  togetherSessionByPairQuestionRevision.set(key, sessionId);
  return sessionId;
}

async function addTogetherOccurrence(
  pairFixture: (typeof pairFixtures)[number],
  fields: { questionId: string; revisionId: string; category: "fun" | "deep" },
  action: "continue" | "skip" | "unresolved",
  liked: boolean,
) {
  const sessionId = await togetherSessionFor(
    pairFixture,
    fields.questionId,
    fields.revisionId,
    fields.category,
  );
  await db.insert(togetherSessionQuestion).values({
    sessionId,
    questionId: fields.questionId,
    questionRevisionId: fields.revisionId,
    position: 1,
    advancedAt: action === "unresolved" ? null : new Date(),
    skippedAt: action === "skip" ? new Date() : null,
    likedAt: liked ? new Date() : null,
  });
}

for (const [index, fixture] of pairFixtures.entries()) {
  const currentState = (["asked", "asked", "skipped", "unresolved", "unresolved"] as const)[index]!;
  const currentLiked = index === 0 || index === 2 || index === 3;
  await addPrivateCandidate(
    fixture,
    { questionId: primaryQuestionId, revisionId: primaryCurrentRevisionId, category: "fun" },
    currentState,
    currentLiked,
  );
  await addPrivateCandidate(
    fixture,
    { questionId: primaryQuestionId, revisionId: primaryHistoricalRevisionId, category: "fun" },
    "asked",
    index < 2,
  );
  await addTogetherOccurrence(
    fixture,
    { questionId: primaryQuestionId, revisionId: primaryCurrentRevisionId, category: "fun" },
    index === 2 ? "skip" : index === 4 ? "unresolved" : "continue",
    index === 0 || index === 2 || index === 4,
  );
  await addTogetherOccurrence(
    fixture,
    { questionId: primaryQuestionId, revisionId: primaryHistoricalRevisionId, category: "fun" },
    "continue",
    index < 2,
  );

  if (index < 4) {
    await addPrivateCandidate(
      fixture,
      {
        questionId: suppressedCreated.question.id,
        revisionId: suppressedCreated.revision.id,
        category: "deep",
      },
      "asked",
      false,
    );
    await addTogetherOccurrence(
      fixture,
      {
        questionId: suppressedCreated.question.id,
        revisionId: suppressedCreated.revision.id,
        category: "deep",
      },
      "continue",
      false,
    );
  }
}

await addPrivateCandidate(
  pairFixtures[0]!,
  { questionId: primaryQuestionId, revisionId: primaryCurrentRevisionId, category: "fun" },
  "invalidated",
  true,
);

const admin = {} as AdminSession;
const questionItems: AdminQuestionListItem[] = [
  {
    questionId: primaryQuestionId,
    currentRevisionId: primaryCurrentRevisionId,
    isActive: false,
    activity: "inactive",
    revisionHealth: "safe",
    blockedFromActivation: false,
    createdAt: new Date().toISOString(),
    lastChangedAt: new Date().toISOString(),
    currentRevision: {
      revisionNumber: currentCreated.revision.revisionNumber,
      text: questionFields.text,
      category: questionFields.category,
      relationshipFit: questionFields.relationshipFit,
      modeFit: questionFields.modeFit,
      intensity: questionFields.intensity,
      createdAt: new Date().toISOString(),
      withdrawnAt: null,
      actorLabel: "Test Admin",
    },
  },
  {
    questionId: suppressedCreated.question.id,
    currentRevisionId: suppressedCreated.revision.id,
    isActive: false,
    activity: "inactive",
    revisionHealth: "safe",
    blockedFromActivation: false,
    createdAt: new Date().toISOString(),
    lastChangedAt: new Date().toISOString(),
    currentRevision: {
      revisionNumber: suppressedCreated.revision.revisionNumber,
      text: suppressedQuestionFields.text,
      category: suppressedQuestionFields.category,
      relationshipFit: suppressedQuestionFields.relationshipFit,
      modeFit: suppressedQuestionFields.modeFit,
      intensity: suppressedQuestionFields.intensity,
      createdAt: new Date().toISOString(),
      withdrawnAt: null,
      actorLabel: "Test Admin",
    },
  },
];

afterAll(async () => {
  await db
    .delete(privateQuestionCandidate)
    .where(inArray(privateQuestionCandidate.questionId, questionIds));
  await db
    .delete(togetherSessionQuestion)
    .where(inArray(togetherSessionQuestion.questionId, questionIds));
  await db
    .update(question)
    .set({ currentRevisionId: null })
    .where(inArray(question.id, questionIds));
  await db.delete(questionRevision).where(inArray(questionRevision.questionId, questionIds));
  await db.delete(question).where(inArray(question.id, questionIds));
  await db.delete(pair).where(inArray(pair.id, pairIds));
  await db.delete(participant).where(inArray(participant.id, participantIds));
  await db.delete(user).where(inArray(user.id, [...authUserIds, adminUserId]));
});

describe("Admin question analytics", () => {
  test("uses canonical current-revision formulas and suppresses buckets below five Pairs", async () => {
    const privateMetrics = await listAdminQuestionAnalytics(
      { questions: questionItems, revisionScope: "current", mode: "private" },
      admin,
    );
    const privatePrimary = privateMetrics.find((item) => item.questionId === primaryQuestionId)!;
    const privateSuppressed = privateMetrics.find(
      (item) => item.questionId === suppressedCreated.question.id,
    )!;
    expect(privatePrimary).toEqual({
      questionId: primaryQuestionId,
      status: "available",
      validOffers: 5,
      decisions: 3,
      decisionRate: 0.6,
      askRate: 2 / 3,
      skipRate: 1 / 3,
      likeRate: 2 / 3,
    });
    expect(privateSuppressed).toEqual({
      questionId: suppressedCreated.question.id,
      status: "insufficient_data",
      validOffers: null,
      decisions: null,
      decisionRate: null,
      askRate: null,
      skipRate: null,
      likeRate: null,
    });
    expect(JSON.stringify(privateSuppressed)).not.toMatch(
      /pair|participant|session|answer|reply|numerator|denominator/i,
    );

    const togetherMetrics = await listAdminQuestionAnalytics(
      { questions: questionItems, revisionScope: "current", mode: "together" },
      admin,
    );
    expect(togetherMetrics.find((item) => item.questionId === primaryQuestionId)).toEqual({
      questionId: primaryQuestionId,
      status: "available",
      shown: 5,
      decisions: 4,
      continueRate: 0.75,
      skipRate: 0.25,
      likeRate: 0.5,
    });
    const togetherSuppressed = togetherMetrics.find(
      (item) => item.questionId === suppressedCreated.question.id,
    );
    expect(togetherSuppressed).toMatchObject({
      status: "insufficient_data",
      shown: null,
      decisions: null,
      continueRate: null,
      skipRate: null,
      likeRate: null,
    });
    expect(JSON.stringify(togetherSuppressed)).not.toMatch(
      /pair|participant|session|answer|reply|numerator|denominator/i,
    );
  });

  test("supports historical revision selection and an explicitly aggregate all-revisions scope", async () => {
    const historical = await getAdminQuestionAnalyticsDetail(
      {
        questionId: primaryQuestionId,
        revisionScope: "revision",
        revisionId: primaryHistoricalRevisionId,
      },
      admin,
    );
    expect(historical).toMatchObject({
      revisionScope: "revision",
      selectedRevisionId: primaryHistoricalRevisionId,
      selectedRevisionNumber: 1,
      private: { status: "available", validOffers: 5, decisions: 5, likeRate: 0.4 },
      together: { status: "available", shown: 5, decisions: 5, continueRate: 1, likeRate: 0.4 },
    });

    const allRevisions = await getAdminQuestionAnalyticsDetail(
      { questionId: primaryQuestionId, revisionScope: "all" },
      admin,
    );
    expect(allRevisions).toMatchObject({
      revisionScope: "all",
      selectedRevisionId: null,
      selectedRevisionNumber: null,
      private: {
        status: "available",
        validOffers: 10,
        decisions: 8,
        decisionRate: 0.8,
        likeRate: 0.5,
      },
      together: {
        status: "available",
        shown: 10,
        decisions: 9,
        continueRate: 8 / 9,
        likeRate: 4 / 9,
      },
    });
  });
});
