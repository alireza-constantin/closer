import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, mock, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";
import dotenv from "dotenv";

import type { AdminSession } from "@/server/http/admin-http";

dotenv.config({ path: new URL("../../../../../../apps/web/.env.local", import.meta.url) });

const { db } = await import("@Closer/db");
const { createAdminQuestion } = await import("@Closer/db/closer");
const { question, questionLifecycleEvent, questionRevision } =
  await import("@Closer/db/schema/closer");
const { user } = await import("@Closer/db/schema/auth");

mock.module("server-only", () => ({}));
const { getAdminOverview } = await import("./admin-overview.service");

const adminUserId = `admin-overview-${randomUUID()}`;
const questionIds: string[] = [];
const admin = { user: { id: adminUserId } } as AdminSession;

await db.insert(user).values({
  id: adminUserId,
  name: "Admin overview test actor",
  email: `${adminUserId}@closer.invalid`,
  isAnonymous: false,
});

async function createQuestion(
  fields: {
    text: string;
    category: "fun" | "deep" | "memories" | "relationship" | "friendship";
    relationshipFit: "both" | "partner" | "friend";
    modeFit: "both" | "private" | "together";
    intensity: "light" | "medium" | "deep";
  },
  isActive: boolean,
) {
  const created = await createAdminQuestion(db, { ...fields, adminUserId });
  questionIds.push(created.question.id);
  if (isActive) {
    await db.update(question).set({ isActive: true }).where(eq(question.id, created.question.id));
  }
  return created;
}

const laneQuestions = await Promise.all(
  Array.from({ length: 6 }, (_, index) =>
    createQuestion(
      {
        text: `Overview lane question ${index + 1}`,
        category: "friendship",
        relationshipFit: "friend",
        modeFit: "together",
        intensity: index < 5 ? "light" : "medium",
      },
      true,
    ),
  ),
);
const bothFitsQuestion = await createQuestion(
  {
    text: "Overview question for both fits",
    category: "memories",
    relationshipFit: "both",
    modeFit: "both",
    intensity: "deep",
  },
  true,
);
const inactiveQuestion = await createQuestion(
  {
    text: "Inactive overview question",
    category: "friendship",
    relationshipFit: "friend",
    modeFit: "together",
    intensity: "deep",
  },
  false,
);
const earlierWithdrawalAt = new Date(Date.now() - 60_000);
await db
  .update(questionRevision)
  .set({ withdrawnAt: earlierWithdrawalAt })
  .where(eq(questionRevision.id, inactiveQuestion.revision.id));
await db.insert(questionLifecycleEvent).values({
  questionId: inactiveQuestion.question.id,
  revisionId: inactiveQuestion.revision.id,
  action: "revision_withdrawn",
  adminUserId,
  occurredAt: earlierWithdrawalAt,
  reason: "Test inactive withdrawal",
});
const withdrawnQuestion = await createQuestion(
  {
    text: "Withdrawn overview question",
    category: "friendship",
    relationshipFit: "friend",
    modeFit: "together",
    intensity: "deep",
  },
  true,
);
await db
  .update(questionRevision)
  .set({ withdrawnAt: new Date() })
  .where(eq(questionRevision.id, withdrawnQuestion.revision.id));
await db.insert(questionLifecycleEvent).values({
  questionId: withdrawnQuestion.question.id,
  revisionId: withdrawnQuestion.revision.id,
  action: "revision_withdrawn",
  adminUserId,
  reason: "Test withdrawal event",
});

afterAll(async () => {
  if (questionIds.length) {
    await db
      .delete(questionLifecycleEvent)
      .where(inArray(questionLifecycleEvent.questionId, questionIds));
    await db
      .update(question)
      .set({ currentRevisionId: null })
      .where(inArray(question.id, questionIds));
    await db.delete(questionRevision).where(inArray(questionRevision.questionId, questionIds));
    await db.delete(question).where(inArray(question.id, questionIds));
  }
  await db.delete(user).where(eq(user.id, adminUserId));
});

describe("Admin operational overview", () => {
  test("counts eligible current inventory lanes and shows only current withdrawals and editorial activity", async () => {
    const overview = await getAdminOverview(admin);
    const findLane = (
      lanes: typeof overview.criticalInventoryLanes,
      category: string,
      relationship: string,
      mode: string,
    ) =>
      lanes.find(
        (lane) =>
          lane.category === category && lane.relationship === relationship && lane.mode === mode,
      );

    const lowLane = findLane(overview.lowInventoryLanes, "friendship", "friend", "together");
    expect(lowLane).toEqual({
      category: "friendship",
      relationship: "friend",
      mode: "together",
      eligibleQuestions: 6,
      intensityBreakdown: { light: 5, medium: 1, deep: 0 },
      level: "low",
    });
    expect(
      findLane(overview.criticalInventoryLanes, "memories", "friend", "together"),
    ).toMatchObject({
      eligibleQuestions: 1,
      intensityBreakdown: { light: 0, medium: 0, deep: 1 },
      level: "critical",
    });
    for (const relationship of ["partner", "friend"] as const) {
      for (const mode of ["private", "together"] as const) {
        expect(
          findLane(overview.criticalInventoryLanes, "memories", relationship, mode)
            ?.eligibleQuestions,
        ).toBe(1);
      }
    }
    expect(
      overview.criticalInventoryLanes.some(
        (lane) => lane.category === "relationship" && lane.relationship === "friend",
      ),
    ).toBe(false);
    expect(
      overview.criticalInventoryLanes.some(
        (lane) => lane.category === "friendship" && lane.relationship === "partner",
      ),
    ).toBe(false);

    expect(overview.withdrawnQuestionsTotal).toBeGreaterThanOrEqual(2);
    expect(overview.withdrawnQuestions).toContainEqual(
      expect.objectContaining({
        questionId: withdrawnQuestion.question.id,
        text: "Withdrawn overview question",
        revisionNumber: 1,
      }),
    );
    expect(overview.withdrawnQuestions).toContainEqual(
      expect.objectContaining({ questionId: inactiveQuestion.question.id }),
    );
    expect(overview.recentEditorialActivity[0]).toMatchObject({
      questionId: withdrawnQuestion.question.id,
      action: "revision_withdrawn",
      revisionNumber: 1,
      actorLabel: "Admin overview test actor",
    });
    expect(overview.recentEditorialActivity[0]?.questionText).toBe("Withdrawn overview question");
    expect(overview.recentEditorialActivity.map((item) => item.questionId)).toContain(
      inactiveQuestion.question.id,
    );

    expect(laneQuestions).toHaveLength(6);
    expect(bothFitsQuestion.question.id).toBeTruthy();
  });
});
