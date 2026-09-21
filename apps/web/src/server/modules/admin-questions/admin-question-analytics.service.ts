import "server-only";

import { and, count, eq, inArray, sql } from "drizzle-orm";

import { db } from "@Closer/db";
import {
  privateConversation,
  privateQuestionCandidate,
  question,
  questionRevision,
  togetherSession,
  togetherSessionQuestion,
} from "@Closer/db/schema/closer";

import {
  adminPrivateQuestionAnalyticsItemSchema,
  adminQuestionAnalyticsDetailSchema,
  adminTogetherQuestionAnalyticsItemSchema,
  type AdminPrivateQuestionAnalyticsItem,
  type AdminQuestionAnalyticsDetail,
  type AdminQuestionAnalyticsQuery,
  type AdminQuestionListItem,
  type AdminTogetherQuestionAnalyticsItem,
} from "@/contracts/admin/question.schema";
import type { AdminSession } from "@/server/http/admin-http";

const MIN_ANALYTICS_PAIRS = 5;

type PrivateAggregate = {
  questionId: string;
  validOffers: number;
  decisions: number;
  asked: number;
  skipped: number;
  likedDecisions: number;
};

type TogetherAggregate = {
  questionId: string;
  shown: number;
  decisions: number;
  continued: number;
  skipped: number;
  likedDecisions: number;
};

type AnalyticsScope = "current" | "all" | "revision";
type AnalyticsMode = "private" | "together";

async function queryPrivateAggregates(questionIds: string[], revisionIds?: string[]) {
  if (!questionIds.length) return [];
  const conditions = [inArray(privateQuestionCandidate.questionId, questionIds)];
  if (revisionIds) {
    if (!revisionIds.length) return [];
    conditions.push(inArray(privateQuestionCandidate.questionRevisionId, revisionIds));
  }

  return db
    .select({
      questionId: privateQuestionCandidate.questionId,
      validOffers: count(
        sql`case when ${privateQuestionCandidate.state} in ('unresolved', 'asked', 'skipped') then 1 end`,
      ),
      decisions: count(
        sql`case when ${privateQuestionCandidate.state} in ('asked', 'skipped') then 1 end`,
      ),
      asked: count(sql`case when ${privateQuestionCandidate.state} = 'asked' then 1 end`),
      skipped: count(sql`case when ${privateQuestionCandidate.state} = 'skipped' then 1 end`),
      likedDecisions: count(
        sql`case when ${privateQuestionCandidate.state} in ('asked', 'skipped') and ${privateQuestionCandidate.likedAt} is not null then 1 end`,
      ),
    })
    .from(privateQuestionCandidate)
    .innerJoin(
      privateConversation,
      eq(privateQuestionCandidate.conversationId, privateConversation.id),
    )
    .where(and(...conditions))
    .groupBy(privateQuestionCandidate.questionId)
    .having(
      sql`count(distinct case when ${privateQuestionCandidate.state} in ('unresolved', 'asked', 'skipped') then ${privateConversation.pairId} end) >= ${MIN_ANALYTICS_PAIRS}`,
    );
}

async function queryTogetherAggregates(questionIds: string[], revisionIds?: string[]) {
  if (!questionIds.length) return [];
  const conditions = [inArray(togetherSessionQuestion.questionId, questionIds)];
  if (revisionIds) {
    if (!revisionIds.length) return [];
    conditions.push(inArray(togetherSessionQuestion.questionRevisionId, revisionIds));
  }

  return db
    .select({
      questionId: togetherSessionQuestion.questionId,
      shown: count(togetherSessionQuestion.id),
      decisions: count(sql`case when ${togetherSessionQuestion.advancedAt} is not null then 1 end`),
      continued: count(
        sql`case when ${togetherSessionQuestion.advancedAt} is not null and ${togetherSessionQuestion.skippedAt} is null then 1 end`,
      ),
      skipped: count(
        sql`case when ${togetherSessionQuestion.advancedAt} is not null and ${togetherSessionQuestion.skippedAt} is not null then 1 end`,
      ),
      likedDecisions: count(
        sql`case when ${togetherSessionQuestion.advancedAt} is not null and ${togetherSessionQuestion.likedAt} is not null then 1 end`,
      ),
    })
    .from(togetherSessionQuestion)
    .innerJoin(togetherSession, eq(togetherSessionQuestion.sessionId, togetherSession.id))
    .where(and(...conditions))
    .groupBy(togetherSessionQuestion.questionId)
    .having(sql`count(distinct ${togetherSession.pairId}) >= ${MIN_ANALYTICS_PAIRS}`);
}

function ratio(numerator: number, denominator: number) {
  return denominator === 0 ? null : numerator / denominator;
}

function privateMetrics(
  questionId: string,
  aggregate?: PrivateAggregate,
): AdminPrivateQuestionAnalyticsItem {
  if (!aggregate) {
    return adminPrivateQuestionAnalyticsItemSchema.parse({
      questionId,
      status: "insufficient_data",
      validOffers: null,
      decisions: null,
      decisionRate: null,
      askRate: null,
      skipRate: null,
      likeRate: null,
    });
  }

  return adminPrivateQuestionAnalyticsItemSchema.parse({
    questionId,
    status: "available",
    validOffers: aggregate.validOffers,
    decisions: aggregate.decisions,
    decisionRate: ratio(aggregate.decisions, aggregate.validOffers),
    askRate: ratio(aggregate.asked, aggregate.decisions),
    skipRate: ratio(aggregate.skipped, aggregate.decisions),
    likeRate: ratio(aggregate.likedDecisions, aggregate.decisions),
  });
}

function togetherMetrics(
  questionId: string,
  aggregate?: TogetherAggregate,
): AdminTogetherQuestionAnalyticsItem {
  if (!aggregate) {
    return adminTogetherQuestionAnalyticsItemSchema.parse({
      questionId,
      status: "insufficient_data",
      shown: null,
      decisions: null,
      continueRate: null,
      skipRate: null,
      likeRate: null,
    });
  }

  return adminTogetherQuestionAnalyticsItemSchema.parse({
    questionId,
    status: "available",
    shown: aggregate.shown,
    decisions: aggregate.decisions,
    continueRate: ratio(aggregate.continued, aggregate.decisions),
    skipRate: ratio(aggregate.skipped, aggregate.decisions),
    likeRate: ratio(aggregate.likedDecisions, aggregate.decisions),
  });
}

export async function listAdminQuestionAnalytics(
  input: {
    questions: Array<Pick<AdminQuestionListItem, "questionId" | "currentRevisionId">>;
    revisionScope: AdminQuestionAnalyticsQuery["revisionScope"];
    mode: AnalyticsMode;
  },
  _admin: AdminSession,
) {
  const questionIds = input.questions.map((item) => item.questionId);
  const currentRevisionIds =
    input.revisionScope === "current"
      ? input.questions.map((item) => item.currentRevisionId)
      : undefined;

  if (input.mode === "private") {
    const aggregates = await queryPrivateAggregates(questionIds, currentRevisionIds);
    const byQuestion = new Map(aggregates.map((item) => [item.questionId, item]));
    return input.questions.map((item) =>
      privateMetrics(item.questionId, byQuestion.get(item.questionId)),
    );
  }

  const aggregates = await queryTogetherAggregates(questionIds, currentRevisionIds);
  const byQuestion = new Map(aggregates.map((item) => [item.questionId, item]));
  return input.questions.map((item) =>
    togetherMetrics(item.questionId, byQuestion.get(item.questionId)),
  );
}

export async function getAdminQuestionAnalyticsDetail(
  input: {
    questionId: string;
    revisionScope: AnalyticsScope;
    revisionId?: string;
  },
  _admin: AdminSession,
): Promise<AdminQuestionAnalyticsDetail | null> {
  const [questionRow] = await db
    .select({ currentRevisionId: question.currentRevisionId })
    .from(question)
    .where(eq(question.id, input.questionId))
    .limit(1);
  if (!questionRow?.currentRevisionId) return null;

  let selectedRevisionId: string | null = null;
  let selectedRevisionNumber: number | null = null;
  let revisionIds: string[] | undefined;

  if (input.revisionScope === "current") {
    selectedRevisionId = questionRow.currentRevisionId;
    revisionIds = [selectedRevisionId];
  } else if (input.revisionScope === "revision") {
    if (!input.revisionId) return null;
    const [selectedRevision] = await db
      .select({ id: questionRevision.id, revisionNumber: questionRevision.revisionNumber })
      .from(questionRevision)
      .where(
        and(
          eq(questionRevision.id, input.revisionId),
          eq(questionRevision.questionId, input.questionId),
        ),
      )
      .limit(1);
    if (!selectedRevision) return null;
    selectedRevisionId = selectedRevision.id;
    selectedRevisionNumber = selectedRevision.revisionNumber;
    revisionIds = [selectedRevision.id];
  }

  if (input.revisionScope === "current") {
    const [currentRevision] = await db
      .select({ revisionNumber: questionRevision.revisionNumber })
      .from(questionRevision)
      .where(eq(questionRevision.id, questionRow.currentRevisionId))
      .limit(1);
    selectedRevisionNumber = currentRevision?.revisionNumber ?? null;
  }

  const [privateAggregates, togetherAggregates] = await Promise.all([
    queryPrivateAggregates([input.questionId], revisionIds),
    queryTogetherAggregates([input.questionId], revisionIds),
  ]);

  return adminQuestionAnalyticsDetailSchema.parse({
    questionId: input.questionId,
    revisionScope: input.revisionScope,
    selectedRevisionId,
    selectedRevisionNumber,
    private: privateMetrics(input.questionId, privateAggregates[0]),
    together: togetherMetrics(input.questionId, togetherAggregates[0]),
  });
}
