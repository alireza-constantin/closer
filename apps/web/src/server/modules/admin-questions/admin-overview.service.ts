import "server-only";

import { and, count, desc, eq, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { db } from "@Closer/db";
import { question, questionLifecycleEvent, questionRevision } from "@Closer/db/schema/closer";
import { user } from "@Closer/db/schema/auth";

import type { AdminSession } from "@/server/http/admin-http";

const CRITICAL_INVENTORY_MAX = 5;
const LOW_INVENTORY_MAX = 11;
const WITHDRAWN_QUESTIONS_LIMIT = 8;
const RECENT_EDITORIAL_ACTIVITY_LIMIT = 10;

const categories = ["fun", "deep", "memories", "relationship", "friendship"] as const;
const relationships = ["partner", "friend"] as const;
const modes = ["private", "together"] as const;
const intensities = ["light", "medium", "deep"] as const;

type Category = (typeof categories)[number];
type Relationship = (typeof relationships)[number];
type Mode = (typeof modes)[number];
type Intensity = (typeof intensities)[number];
type InventoryLevel = "critical" | "low" | "healthy";

type InventoryLane = {
  category: Category;
  relationship: Relationship;
  mode: Mode;
  eligibleQuestions: number;
  intensityBreakdown: Record<Intensity, number>;
  level: InventoryLevel;
};

const eligibleRelationshipsByCategory: Record<Category, readonly Relationship[]> = {
  fun: relationships,
  deep: relationships,
  memories: relationships,
  relationship: ["partner"],
  friendship: ["friend"],
};

function categoryEligibilityCondition() {
  return or(
    and(ne(questionRevision.category, "relationship"), ne(questionRevision.category, "friendship")),
    and(
      eq(questionRevision.category, "relationship"),
      eq(questionRevision.relationshipFit, "partner"),
    ),
    and(
      eq(questionRevision.category, "friendship"),
      eq(questionRevision.relationshipFit, "friend"),
    ),
  );
}

function laneKey(category: Category, relationship: Relationship, mode: Mode) {
  return `${category}:${relationship}:${mode}`;
}

function iso(value: Date | string) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function actorLabel(name: string | null | undefined) {
  return name?.trim() || "Admin";
}

export function inventoryLevel(countValue: number): InventoryLevel {
  if (countValue <= CRITICAL_INVENTORY_MAX) return "critical";
  if (countValue <= LOW_INVENTORY_MAX) return "low";
  return "healthy";
}

async function getInventoryCoverageLanes() {
  const inventoryRows = await db
    .select({
      category: questionRevision.category,
      relationshipFit: questionRevision.relationshipFit,
      modeFit: questionRevision.modeFit,
      intensity: questionRevision.intensity,
      eligibleQuestions: count(question.id),
    })
    .from(question)
    .innerJoin(
      questionRevision,
      and(
        eq(question.id, questionRevision.questionId),
        eq(question.currentRevisionId, questionRevision.id),
      ),
    )
    .where(
      and(
        eq(question.isActive, true),
        isNull(questionRevision.withdrawnAt),
        categoryEligibilityCondition(),
      ),
    )
    .groupBy(
      questionRevision.category,
      questionRevision.relationshipFit,
      questionRevision.modeFit,
      questionRevision.intensity,
    );

  const laneMap = new Map<string, Omit<InventoryLane, "level">>();
  for (const category of categories) {
    for (const relationship of eligibleRelationshipsByCategory[category]) {
      for (const mode of modes) {
        laneMap.set(laneKey(category, relationship, mode), {
          category,
          relationship,
          mode,
          eligibleQuestions: 0,
          intensityBreakdown: { light: 0, medium: 0, deep: 0 },
        });
      }
    }
  }

  for (const row of inventoryRows) {
    const rowRelationships = row.relationshipFit === "both" ? relationships : [row.relationshipFit];
    const rowModes = row.modeFit === "both" ? modes : [row.modeFit];
    for (const relationship of rowRelationships) {
      for (const mode of rowModes) {
        const lane = laneMap.get(laneKey(row.category, relationship, mode));
        if (!lane) continue;
        lane.eligibleQuestions += row.eligibleQuestions;
        lane.intensityBreakdown[row.intensity] += row.eligibleQuestions;
      }
    }
  }

  return [...laneMap.values()].map((lane) => ({
    ...lane,
    level: inventoryLevel(lane.eligibleQuestions),
  }));
}

export async function getAdminQuestionCoverage(_admin: AdminSession) {
  return getInventoryCoverageLanes();
}

export async function getAdminOverview(_admin: AdminSession) {
  const currentRevision = alias(questionRevision, "admin_overview_current_revision");
  const affectedRevision = alias(questionRevision, "admin_overview_affected_revision");
  const [lanes, withdrawnCountRows, withdrawnQuestions, editorialRows] = await Promise.all([
    getInventoryCoverageLanes(),
    db
      .select({ total: count() })
      .from(question)
      .innerJoin(
        questionRevision,
        and(
          eq(question.id, questionRevision.questionId),
          eq(question.currentRevisionId, questionRevision.id),
        ),
      )
      .where(isNotNull(questionRevision.withdrawnAt)),
    db
      .select({
        questionId: question.id,
        text: questionRevision.text,
        category: questionRevision.category,
        revisionNumber: questionRevision.revisionNumber,
      })
      .from(question)
      .innerJoin(
        questionRevision,
        and(
          eq(question.id, questionRevision.questionId),
          eq(question.currentRevisionId, questionRevision.id),
        ),
      )
      .where(isNotNull(questionRevision.withdrawnAt))
      .orderBy(desc(questionRevision.withdrawnAt), desc(question.id))
      .limit(WITHDRAWN_QUESTIONS_LIMIT),
    db
      .select({
        eventId: questionLifecycleEvent.id,
        questionId: question.id,
        action: questionLifecycleEvent.action,
        occurredAt: questionLifecycleEvent.occurredAt,
        revisionNumber: sql<number>`coalesce(${affectedRevision.revisionNumber}, ${currentRevision.revisionNumber})`,
        questionText: sql<string>`coalesce(${affectedRevision.text}, ${currentRevision.text})`,
        actorName: user.name,
      })
      .from(questionLifecycleEvent)
      .innerJoin(question, eq(questionLifecycleEvent.questionId, question.id))
      .innerJoin(currentRevision, eq(question.currentRevisionId, currentRevision.id))
      .leftJoin(
        affectedRevision,
        and(
          eq(questionLifecycleEvent.questionId, affectedRevision.questionId),
          eq(questionLifecycleEvent.revisionId, affectedRevision.id),
        ),
      )
      .leftJoin(user, eq(questionLifecycleEvent.adminUserId, user.id))
      .orderBy(desc(questionLifecycleEvent.occurredAt), desc(questionLifecycleEvent.id))
      .limit(RECENT_EDITORIAL_ACTIVITY_LIMIT),
  ]);

  return {
    criticalInventoryLanes: lanes.filter((lane) => lane.level === "critical"),
    lowInventoryLanes: lanes.filter((lane) => lane.level === "low"),
    withdrawnQuestions,
    withdrawnQuestionsTotal: withdrawnCountRows[0]?.total ?? 0,
    recentEditorialActivity: editorialRows.map((item) => ({
      eventId: item.eventId,
      questionId: item.questionId,
      questionText: item.questionText,
      action: item.action,
      revisionNumber: item.revisionNumber,
      occurredAt: iso(item.occurredAt),
      actorLabel: actorLabel(item.actorName),
    })),
  };
}
