import "server-only";

import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  isNotNull,
  isNull,
  max,
  type SQL,
  sql,
} from "drizzle-orm";

import { db } from "@Closer/db";
import {
  activateQuestion,
  createAdminQuestion,
  createAdminQuestionRevision,
  deactivateQuestion,
  findDuplicateQuestionsByText,
  reactivateQuestion,
  restoreAdminQuestionRevision,
  withdrawQuestionRevision,
} from "@Closer/db/closer";
import { question, questionLifecycleEvent, questionRevision } from "@Closer/db/schema/closer";
import { user } from "@Closer/db/schema/auth";

import type {
  AdminQuestionListQuery,
  QuestionRevisionFields,
} from "@/contracts/admin/question.schema";
import type { AdminSession } from "@/server/http/admin-http";

const RECENT_EDITORIAL_ACTIVITY_LIMIT = 20;

function toIso(value: Date | string) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function actorLabel(name: string | null | undefined) {
  return name?.trim() || "Admin";
}

function questionListFilters(input: AdminQuestionListQuery): SQL[] {
  const filters: SQL[] = [];
  if (input.search) filters.push(ilike(questionRevision.text, `%${input.search}%`));
  if (input.category) filters.push(eq(questionRevision.category, input.category));
  if (input.intensity) filters.push(eq(questionRevision.intensity, input.intensity));
  if (input.relationshipFit)
    filters.push(eq(questionRevision.relationshipFit, input.relationshipFit));
  if (input.modeFit) filters.push(eq(questionRevision.modeFit, input.modeFit));
  if (input.activity === "active") filters.push(eq(question.isActive, true));
  if (input.activity === "inactive") filters.push(eq(question.isActive, false));
  if (input.revisionHealth === "safe") filters.push(isNull(questionRevision.withdrawnAt));
  if (input.revisionHealth === "withdrawn") filters.push(isNotNull(questionRevision.withdrawnAt));
  return filters;
}

function latestLifecycleChanges() {
  return db
    .select({
      questionId: questionLifecycleEvent.questionId,
      changedAt: max(questionLifecycleEvent.occurredAt).as("changed_at"),
    })
    .from(questionLifecycleEvent)
    .groupBy(questionLifecycleEvent.questionId)
    .as("latest_lifecycle_changes");
}

function lastChangedAtExpression(latestLifecycle: ReturnType<typeof latestLifecycleChanges>) {
  return sql<Date>`greatest(
    ${question.createdAt},
    ${questionRevision.createdAt},
    coalesce(${latestLifecycle.changedAt}, ${question.createdAt})
  )`;
}

export async function listAdminQuestions(input: AdminQuestionListQuery, _admin: AdminSession) {
  const latestLifecycle = latestLifecycleChanges();
  const filters = questionListFilters(input);
  const where = filters.length ? and(...filters) : undefined;
  const offset = (input.page - 1) * input.pageSize;

  const [totalResult, rows] = await Promise.all([
    db
      .select({ total: count() })
      .from(question)
      .innerJoin(questionRevision, eq(question.currentRevisionId, questionRevision.id))
      .where(where),
    db
      .select({
        questionId: question.id,
        currentRevisionId: questionRevision.id,
        isActive: question.isActive,
        createdAt: question.createdAt,
        lastChangedAt: lastChangedAtExpression(latestLifecycle),
        revisionNumber: questionRevision.revisionNumber,
        text: questionRevision.text,
        category: questionRevision.category,
        relationshipFit: questionRevision.relationshipFit,
        modeFit: questionRevision.modeFit,
        intensity: questionRevision.intensity,
        revisionCreatedAt: questionRevision.createdAt,
        withdrawnAt: questionRevision.withdrawnAt,
        actorName: user.name,
      })
      .from(question)
      .innerJoin(questionRevision, eq(question.currentRevisionId, questionRevision.id))
      .leftJoin(user, eq(questionRevision.createdByAdminUserId, user.id))
      .leftJoin(latestLifecycle, eq(question.id, latestLifecycle.questionId))
      .where(where)
      .orderBy(desc(lastChangedAtExpression(latestLifecycle)), asc(question.id))
      .limit(input.pageSize)
      .offset(offset),
  ]);

  const rowsTotal = totalResult[0]?.total ?? 0;
  return {
    items: rows.map((row) => {
      const revisionHealth = row.withdrawnAt ? "withdrawn" : "safe";
      return {
        questionId: row.questionId,
        currentRevisionId: row.currentRevisionId,
        isActive: row.isActive,
        activity: row.isActive ? ("active" as const) : ("inactive" as const),
        revisionHealth,
        blockedFromActivation: !row.isActive && revisionHealth === "withdrawn",
        createdAt: toIso(row.createdAt),
        lastChangedAt: toIso(row.lastChangedAt),
        currentRevision: {
          revisionNumber: row.revisionNumber,
          text: row.text,
          category: row.category,
          relationshipFit: row.relationshipFit,
          modeFit: row.modeFit,
          intensity: row.intensity,
          createdAt: toIso(row.revisionCreatedAt),
          withdrawnAt: row.withdrawnAt ? toIso(row.withdrawnAt) : null,
          actorLabel: row.actorName ? actorLabel(row.actorName) : "Pre-Admin catalog",
        },
      };
    }),
    page: input.page,
    pageSize: input.pageSize,
    total: rowsTotal,
  };
}

export async function getAdminQuestionDetail(questionId: string, _admin: AdminSession) {
  const [row] = await db
    .select({
      questionId: question.id,
      currentRevisionId: questionRevision.id,
      isActive: question.isActive,
      createdAt: question.createdAt,
      revisionId: questionRevision.id,
      revisionNumber: questionRevision.revisionNumber,
      text: questionRevision.text,
      category: questionRevision.category,
      relationshipFit: questionRevision.relationshipFit,
      modeFit: questionRevision.modeFit,
      intensity: questionRevision.intensity,
      revisionCreatedAt: questionRevision.createdAt,
      withdrawnAt: questionRevision.withdrawnAt,
      actorName: user.name,
    })
    .from(question)
    .innerJoin(questionRevision, eq(question.currentRevisionId, questionRevision.id))
    .leftJoin(user, eq(questionRevision.createdByAdminUserId, user.id))
    .where(eq(question.id, questionId))
    .limit(1);

  if (!row) return null;

  const recentEditorialActivity = await db
    .select({
      eventId: questionLifecycleEvent.id,
      action: questionLifecycleEvent.action,
      revisionId: questionLifecycleEvent.revisionId,
      occurredAt: questionLifecycleEvent.occurredAt,
      reason: questionLifecycleEvent.reason,
      actorName: user.name,
    })
    .from(questionLifecycleEvent)
    .innerJoin(user, eq(questionLifecycleEvent.adminUserId, user.id))
    .where(eq(questionLifecycleEvent.questionId, questionId))
    .orderBy(desc(questionLifecycleEvent.occurredAt), desc(questionLifecycleEvent.id))
    .limit(RECENT_EDITORIAL_ACTIVITY_LIMIT);

  const revisionHealth = row.withdrawnAt ? "withdrawn" : "safe";
  return {
    questionId: row.questionId,
    currentRevisionId: row.currentRevisionId,
    isActive: row.isActive,
    activity: row.isActive ? ("active" as const) : ("inactive" as const),
    revisionHealth,
    blockedFromActivation: !row.isActive && revisionHealth === "withdrawn",
    createdAt: toIso(row.createdAt),
    currentRevision: {
      revisionId: row.revisionId,
      revisionNumber: row.revisionNumber,
      text: row.text,
      category: row.category,
      relationshipFit: row.relationshipFit,
      modeFit: row.modeFit,
      intensity: row.intensity,
      createdAt: toIso(row.revisionCreatedAt),
      withdrawnAt: row.withdrawnAt ? toIso(row.withdrawnAt) : null,
      actorLabel: row.actorName ? actorLabel(row.actorName) : "Pre-Admin catalog",
      isCurrent: true as const,
    },
    recentEditorialActivity: recentEditorialActivity.map((event) => ({
      eventId: event.eventId,
      action: event.action,
      revisionId: event.revisionId,
      occurredAt: toIso(event.occurredAt),
      reason: event.reason,
      actorLabel: actorLabel(event.actorName),
    })),
  };
}

export async function listAdminQuestionRevisions(
  input: {
    questionId: string;
    page: number;
    pageSize: number;
  },
  _admin: AdminSession,
) {
  const where = eq(questionRevision.questionId, input.questionId);
  const [questionExists, totalResult, rows] = await Promise.all([
    db.select({ id: question.id }).from(question).where(eq(question.id, input.questionId)).limit(1),
    db.select({ total: count() }).from(questionRevision).where(where),
    db
      .select({
        revisionId: questionRevision.id,
        revisionNumber: questionRevision.revisionNumber,
        text: questionRevision.text,
        category: questionRevision.category,
        relationshipFit: questionRevision.relationshipFit,
        modeFit: questionRevision.modeFit,
        intensity: questionRevision.intensity,
        createdAt: questionRevision.createdAt,
        withdrawnAt: questionRevision.withdrawnAt,
        actorName: user.name,
        currentRevisionId: question.currentRevisionId,
      })
      .from(questionRevision)
      .innerJoin(question, eq(questionRevision.questionId, question.id))
      .leftJoin(user, eq(questionRevision.createdByAdminUserId, user.id))
      .where(where)
      .orderBy(desc(questionRevision.revisionNumber))
      .limit(input.pageSize)
      .offset((input.page - 1) * input.pageSize),
  ]);

  if (!questionExists[0]) return null;

  return {
    items: rows.map((row) => ({
      revisionId: row.revisionId,
      revisionNumber: row.revisionNumber,
      text: row.text,
      category: row.category,
      relationshipFit: row.relationshipFit,
      modeFit: row.modeFit,
      intensity: row.intensity,
      createdAt: toIso(row.createdAt),
      withdrawnAt: row.withdrawnAt ? toIso(row.withdrawnAt) : null,
      actorLabel: row.actorName ? actorLabel(row.actorName) : "Pre-Admin catalog",
      isCurrent: row.currentRevisionId === row.revisionId,
    })),
    page: input.page,
    pageSize: input.pageSize,
    total: totalResult[0]?.total ?? 0,
  };
}

export async function findAdminQuestionDuplicates(
  input: {
    text: string;
    excludeQuestionId?: string;
  },
  _admin: AdminSession,
) {
  return {
    matches: await findDuplicateQuestionsByText(db, input),
  };
}

export function createCatalogQuestion(input: QuestionRevisionFields, adminUserId: string) {
  return createAdminQuestion(db, { ...input, adminUserId });
}

export function createCatalogRevision(
  input: QuestionRevisionFields & {
    questionId: string;
    expectedCurrentRevisionId: string;
  },
  adminUserId: string,
) {
  return createAdminQuestionRevision(db, { ...input, adminUserId });
}

export function restoreCatalogRevision(input: {
  questionId: string;
  sourceRevisionId: string;
  expectedCurrentRevisionId: string;
  adminUserId: string;
}) {
  return restoreAdminQuestionRevision(db, input);
}

export function changeCatalogQuestionActivity(
  action: "activate" | "deactivate" | "reactivate",
  input: { questionId: string; adminUserId: string; reason?: string },
) {
  if (action === "activate") return activateQuestion(db, input);
  if (action === "deactivate") return deactivateQuestion(db, input);
  return reactivateQuestion(db, input);
}

export async function withdrawCatalogRevision(input: {
  questionId: string;
  revisionId: string;
  adminUserId: string;
  reason: string;
}) {
  const [revision] = await db
    .select({ id: questionRevision.id })
    .from(questionRevision)
    .where(
      and(
        eq(questionRevision.id, input.revisionId),
        eq(questionRevision.questionId, input.questionId),
      ),
    )
    .limit(1);
  if (!revision) return null;

  return withdrawQuestionRevision(db, {
    questionRevisionId: input.revisionId,
    adminUserId: input.adminUserId,
    reason: input.reason,
  });
}
