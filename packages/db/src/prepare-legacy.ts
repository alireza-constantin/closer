import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { user } from "./schema/auth";
import { question, questionLifecycleEvent, questionRevision } from "./schema/closer";

const databaseUrl = process.env.CLOSER_LEGACY_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("CLOSER_LEGACY_TEST_DATABASE_URL is required.");

const pool = new Pool({ connectionString: databaseUrl });
const db = drizzle(pool);
const adminUserId = "00000000-0000-4000-8000-000000009000";
const fixtures = [
  {
    questionId: "00000000-0000-4000-8000-000000000101",
    revisionId: "00000000-0000-4000-8000-000000001101",
    category: "fun" as const,
    relationshipFit: "both" as const,
    text: "What made you laugh recently?",
  },
  {
    questionId: "00000000-0000-4000-8000-000000000201",
    revisionId: "00000000-0000-4000-8000-000000002101",
    category: "deep" as const,
    relationshipFit: "both" as const,
    text: "What matters most to you right now?",
  },
  {
    questionId: "00000000-0000-4000-8000-000000000401",
    revisionId: "00000000-0000-4000-8000-000000004101",
    category: "relationship" as const,
    relationshipFit: "partner" as const,
    text: "What helps you feel close?",
  },
  {
    questionId: "00000000-0000-4000-8000-000000000501",
    revisionId: "00000000-0000-4000-8000-000000005101",
    category: "friendship" as const,
    relationshipFit: "friend" as const,
    text: "What do you value in a friendship?",
  },
] as const;

try {
  if (process.env.CLOSER_LEGACY_RESET === "1") {
    await pool.query("DROP SCHEMA public CASCADE");
    await pool.query("CREATE SCHEMA public");
  }
  await pool.query("CREATE EXTENSION IF NOT EXISTS pgcrypto");
  if (process.env.CLOSER_LEGACY_RESET === "1") process.exit(0);

  await db
    .insert(user)
    .values({
      id: adminUserId,
      name: "Legacy integration fixture Admin",
      email: "legacy-fixture-admin@closer.invalid",
      isAnonymous: false,
    })
    .onConflictDoNothing();

  for (const fixture of fixtures) {
    await db
      .insert(question)
      .values({ id: fixture.questionId, currentRevisionId: null, isActive: true })
      .onConflictDoNothing();

    await db
      .insert(questionRevision)
      .values({
        id: fixture.revisionId,
        questionId: fixture.questionId,
        text: fixture.text,
        category: fixture.category,
        relationshipFit: fixture.relationshipFit,
        modeFit: "private",
        intensity: "medium",
        revisionNumber: 1,
        createdByAdminUserId: adminUserId,
      })
      .onConflictDoNothing();

    await db
      .update(question)
      .set({ currentRevisionId: fixture.revisionId, isActive: true })
      .where(eq(question.id, fixture.questionId));

    const [activation] = await db
      .select({ id: questionLifecycleEvent.id })
      .from(questionLifecycleEvent)
      .where(
        and(
          eq(questionLifecycleEvent.questionId, fixture.questionId),
          eq(questionLifecycleEvent.revisionId, fixture.revisionId),
          eq(questionLifecycleEvent.action, "activated"),
        ),
      )
      .limit(1);
    if (!activation) {
      await db.insert(questionLifecycleEvent).values({
        id: randomUUID(),
        questionId: fixture.questionId,
        revisionId: fixture.revisionId,
        action: "activated",
        adminUserId,
      });
    }
  }

  for (const category of ["fun", "deep", "memories"] as const) {
    for (const intensity of ["light", "medium", "deep"] as const) {
      const questionId = randomUUID();
      const revisionId = randomUUID();
      await db.insert(question).values({ id: questionId, currentRevisionId: null, isActive: true });
      await db.insert(questionRevision).values({
        id: revisionId,
        questionId,
        text: `Legacy Together ${category} ${intensity} fixture`,
        category,
        relationshipFit: "both",
        modeFit: "together",
        intensity,
        revisionNumber: 1,
        createdByAdminUserId: adminUserId,
      });
      await db
        .update(question)
        .set({ currentRevisionId: revisionId })
        .where(eq(question.id, questionId));
      await db.insert(questionLifecycleEvent).values({
        id: randomUUID(),
        questionId,
        revisionId,
        action: "activated",
        adminUserId,
      });
    }
  }

  for (const [category, relationshipFit] of [
    ["relationship", "partner"],
    ["friendship", "friend"],
  ] as const) {
    for (const intensity of ["light", "medium", "deep"] as const) {
      const questionId = randomUUID();
      const revisionId = randomUUID();
      await db.insert(question).values({ id: questionId, currentRevisionId: null, isActive: true });
      await db.insert(questionRevision).values({
        id: revisionId,
        questionId,
        text: `Legacy Together ${category} ${intensity} fixture`,
        category,
        relationshipFit,
        modeFit: "together",
        intensity,
        revisionNumber: 1,
        createdByAdminUserId: adminUserId,
      });
      await db
        .update(question)
        .set({ currentRevisionId: revisionId })
        .where(eq(question.id, questionId));
      await db.insert(questionLifecycleEvent).values({
        id: randomUUID(),
        questionId,
        revisionId,
        action: "activated",
        adminUserId,
      });
    }
  }
} finally {
  await pool.end();
}
