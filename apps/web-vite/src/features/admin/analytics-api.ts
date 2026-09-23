import { z } from "zod";

import { requestJson } from "@/lib/api-client";

const availableRateSchema = z
  .object({
    status: z.literal("available"),
    numerator: z.number().int().nonnegative(),
    denominator: z.number().int().positive(),
    rate: z.number().finite().min(0).max(1),
  })
  .strict();

const unavailableRateSchema = z.object({ status: z.literal("unavailable") }).strict();
export const analyticsRateSchema = z.discriminatedUnion("status", [
  availableRateSchema,
  unavailableRateSchema,
]);
export type AnalyticsRate = z.infer<typeof analyticsRateSchema>;

const insufficientPrivateSchema = z.object({ status: z.literal("insufficient_data") }).strict();
const availablePrivateSchema = z
  .object({
    status: z.literal("available"),
    validOffers: z.number().int().nonnegative(),
    decisions: z.number().int().nonnegative(),
    decisionRate: analyticsRateSchema,
    askRate: analyticsRateSchema,
    skipRate: analyticsRateSchema,
    likeRate: analyticsRateSchema,
  })
  .strict();
export const privateAnalyticsSchema = z.discriminatedUnion("status", [
  insufficientPrivateSchema,
  availablePrivateSchema,
]);

const insufficientTogetherSchema = z.object({ status: z.literal("insufficient_data") }).strict();
const availableTogetherSchema = z
  .object({
    status: z.literal("available"),
    shown: z.number().int().nonnegative(),
    decisions: z.number().int().nonnegative(),
    continueRate: analyticsRateSchema,
    skipRate: analyticsRateSchema,
    likeRate: analyticsRateSchema,
  })
  .strict();
export const togetherAnalyticsSchema = z.discriminatedUnion("status", [
  insufficientTogetherSchema,
  availableTogetherSchema,
]);

export const questionAnalyticsSchema = z
  .object({
    questionId: z.string().min(1),
    revisionScope: z.enum(["current", "revision", "all"]),
    selectedRevisionId: z.string().min(1).nullable(),
    selectedRevisionNumber: z.number().int().positive().nullable(),
    private: privateAnalyticsSchema,
    together: togetherAnalyticsSchema,
  })
  .strict();
export type QuestionAnalytics = z.infer<typeof questionAnalyticsSchema>;
export type AnalyticsScope = "current" | "revision" | "all";

const coverageItemSchema = z
  .object({
    category: z.enum(["fun", "deep", "memories", "relationship", "friendship"]),
    relationshipType: z.enum(["partner", "friend"]),
    mode: z.enum(["together", "private"]),
    eligible: z.number().int().nonnegative(),
    health: z.enum(["critical", "low", "healthy"]),
    intensity: z
      .object({
        light: z.number().int().nonnegative(),
        medium: z.number().int().nonnegative(),
        deep: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();

export const coverageSchema = z.object({ items: z.array(coverageItemSchema) }).strict();
export type CoverageItem = z.infer<typeof coverageItemSchema>;
export type AnalyticsSelection =
  { revisionScope: "current" | "all" } | { revisionScope: "revision"; revisionId: string };

export const adminCoverageKey = ["admin", "analytics", "coverage"] as const;
export const adminQuestionAnalyticsKey = (questionId: string, selection: AnalyticsSelection) =>
  [
    "admin",
    "analytics",
    "question",
    questionId,
    selection.revisionScope,
    selection.revisionScope === "revision" ? selection.revisionId : null,
  ] as const;

export async function getAdminCoverage() {
  return coverageSchema.parse(await requestJson("admin/analytics/coverage"));
}

export async function getAdminQuestionAnalytics(
  questionId: string,
  selection: AnalyticsSelection,
): Promise<QuestionAnalytics> {
  const query = new URLSearchParams({ revisionScope: selection.revisionScope });
  if (selection.revisionScope === "revision") query.set("revisionId", selection.revisionId);
  return questionAnalyticsSchema.parse(
    await requestJson(
      `admin/questions/${encodeURIComponent(questionId)}/analytics?${query.toString()}`,
    ),
  );
}
