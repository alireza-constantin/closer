import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, mock, test } from "bun:test";
import dotenv from "dotenv";
import { eq, inArray } from "drizzle-orm";

import {
  adminQuestionDetailResponseSchema,
  adminQuestionRevisionHistoryResponseSchema,
  adminQuestionListResponseSchema,
  adminDuplicateResponseSchema,
} from "@/contracts/admin/question.schema";

dotenv.config({ path: new URL("../../../../.env.local", import.meta.url) });
mock.module("server-only", () => ({}));

const { db } = await import("@Closer/db");
const { createAdminQuestion } = await import("@Closer/db/closer");
const { question, questionLifecycleEvent, questionRevision } =
  await import("@Closer/db/schema/closer");
const { user } = await import("@Closer/db/schema/auth");
const {
  findAdminQuestionDuplicates,
  getAdminQuestionDetail,
  listAdminQuestionRevisions,
  listAdminQuestions,
} = await import("./admin-question.service");

const adminUserId = randomUUID();
const questionIds: string[] = [];

async function createQuestionFixture(input: {
  text: string;
  category: "fun" | "deep";
  intensity: "light" | "deep";
  active: boolean;
}) {
  const created = await createAdminQuestion(db, {
    text: input.text,
    category: input.category,
    relationshipFit: "both",
    modeFit: "both",
    intensity: input.intensity,
    adminUserId,
  });
  questionIds.push(created.question.id);
  if (input.active) {
    const { activateQuestion } = await import("@Closer/db/closer");
    await activateQuestion(db, { questionId: created.question.id, adminUserId });
  }
  return created.question.id;
}

describe("Admin question read projections", () => {
  test("filters current catalog rows and paginates without returning consumer identities", async () => {
    await db.insert(user).values({
      id: adminUserId,
      name: "Catalog projection test Admin",
      email: `${adminUserId}@admin-projection.closer.invalid`,
      isAnonymous: false,
    });

    const marker = `Admin filter ${randomUUID()}`;
    const activeFunId = await createQuestionFixture({
      text: `${marker} active fun`,
      category: "fun",
      intensity: "light",
      active: true,
    });
    const inactiveDeepId = await createQuestionFixture({
      text: `${marker} inactive deep`,
      category: "deep",
      intensity: "deep",
      active: false,
    });

    const adminSession = { user: { id: adminUserId } } as Parameters<typeof listAdminQuestions>[1];
    const filtered = await listAdminQuestions(
      {
        page: 1,
        pageSize: 10,
        search: marker,
        category: "deep",
        intensity: "deep",
        activity: "inactive",
        revisionHealth: "safe",
      },
      adminSession,
    );
    expect(filtered.total).toBe(1);
    expect(filtered.items.map((item) => item.questionId)).toEqual([inactiveDeepId]);
    expect(filtered.items[0]?.currentRevision.text).toContain("inactive deep");
    expect(filtered.items[0]?.blockedFromActivation).toBe(false);
    expect(JSON.stringify(filtered)).not.toContain("participant");
    expect(JSON.stringify(filtered)).not.toContain("pairId");
    expect(adminQuestionListResponseSchema.parse(filtered).items).toHaveLength(1);

    const detail = await getAdminQuestionDetail(inactiveDeepId, adminSession);
    expect(detail).not.toBeNull();
    const checkedDetail = adminQuestionDetailResponseSchema.parse(detail);
    expect(checkedDetail.currentRevision.text).toContain("inactive deep");
    expect(checkedDetail.recentEditorialActivity).toEqual([]);

    const history = await listAdminQuestionRevisions(
      { questionId: inactiveDeepId, page: 1, pageSize: 10 },
      adminSession,
    );
    expect(adminQuestionRevisionHistoryResponseSchema.parse(history).items).toHaveLength(1);

    const duplicates = await findAdminQuestionDuplicates(
      { text: `${marker} inactive deep` },
      adminSession,
    );
    expect(adminDuplicateResponseSchema.parse(duplicates).matches).toMatchObject([
      { questionId: inactiveDeepId, revisionNumber: 1, isActive: false },
    ]);

    const pageOne = await listAdminQuestions(
      { page: 1, pageSize: 1, search: marker },
      adminSession,
    );
    const pageTwo = await listAdminQuestions(
      { page: 2, pageSize: 1, search: marker },
      adminSession,
    );
    expect(pageOne.total).toBe(2);
    expect(pageOne.items).toHaveLength(1);
    expect(pageTwo.items).toHaveLength(1);
    expect(pageOne.items[0]?.questionId).not.toBe(pageTwo.items[0]?.questionId);
    expect([activeFunId, inactiveDeepId]).toContain(pageOne.items[0]?.questionId);
  });
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
  await db.$client.end();
});
