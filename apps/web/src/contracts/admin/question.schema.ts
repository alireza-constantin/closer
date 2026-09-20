import { z } from "zod";

export const adminUuidSchema = z.string().uuid();

const questionRevisionFieldsBaseSchema = z.object({
  text: z.string().trim().min(1),
  category: z.enum(["fun", "deep", "memories", "relationship", "friendship"]),
  relationshipFit: z.enum(["both", "partner", "friend"]),
  modeFit: z.enum(["both", "together", "private"]),
  intensity: z.enum(["light", "medium", "deep"]),
});

function hasCompatibleRelationshipFit(value: z.infer<typeof questionRevisionFieldsBaseSchema>) {
  return (
    (value.category !== "relationship" || value.relationshipFit === "partner") &&
    (value.category !== "friendship" || value.relationshipFit === "friend")
  );
}

export const questionRevisionFieldsSchema = questionRevisionFieldsBaseSchema.refine(
  hasCompatibleRelationshipFit,
  { message: "Relationship categories must use their matching relationship fit." },
);

export const createQuestionSchema = questionRevisionFieldsSchema;

export const createQuestionRevisionSchema = questionRevisionFieldsBaseSchema
  .extend({ expectedCurrentRevisionId: z.string().uuid() })
  .refine(hasCompatibleRelationshipFit, {
    message: "Relationship categories must use their matching relationship fit.",
  });

export const restoreQuestionRevisionSchema = z.object({
  expectedCurrentRevisionId: z.string().uuid(),
});

export const lifecycleReasonSchema = z.object({
  reason: z.string().trim().optional(),
});

export const withdrawQuestionRevisionSchema = z.object({
  reason: z.string().trim().min(1),
});

export const adminQuestionListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().max(200).optional(),
  category: z.enum(["fun", "deep", "memories", "relationship", "friendship"]).optional(),
  intensity: z.enum(["light", "medium", "deep"]).optional(),
  relationshipFit: z.enum(["both", "partner", "friend"]).optional(),
  modeFit: z.enum(["both", "together", "private"]).optional(),
  activity: z.enum(["active", "inactive"]).optional(),
  revisionHealth: z.enum(["safe", "withdrawn"]).optional(),
});

export const adminPaginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const adminDuplicateQuerySchema = z.object({
  text: z.string().trim().min(1),
  excludeQuestionId: z.string().uuid().optional(),
});

export const adminQuestionRevisionSchema = z.object({
  revisionId: z.string().uuid(),
  revisionNumber: z.number().int().positive(),
  text: z.string(),
  category: z.enum(["fun", "deep", "memories", "relationship", "friendship"]),
  relationshipFit: z.enum(["both", "partner", "friend"]),
  modeFit: z.enum(["both", "together", "private"]),
  intensity: z.enum(["light", "medium", "deep"]),
  createdAt: z.string().datetime(),
  withdrawnAt: z.string().datetime().nullable(),
  actorLabel: z.string(),
  isCurrent: z.boolean(),
});

export const adminQuestionListItemSchema = z.object({
  questionId: z.string().uuid(),
  currentRevisionId: z.string().uuid(),
  isActive: z.boolean(),
  activity: z.enum(["active", "inactive"]),
  revisionHealth: z.enum(["safe", "withdrawn"]),
  blockedFromActivation: z.boolean(),
  createdAt: z.string().datetime(),
  lastChangedAt: z.string().datetime(),
  currentRevision: adminQuestionRevisionSchema.omit({ revisionId: true, isCurrent: true }),
});

export const adminQuestionListResponseSchema = z.object({
  items: z.array(adminQuestionListItemSchema),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  total: z.number().int().nonnegative(),
});

export const adminQuestionRevisionHistoryResponseSchema = z.object({
  items: z.array(adminQuestionRevisionSchema),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  total: z.number().int().nonnegative(),
});

export const adminQuestionLifecycleEventSchema = z.object({
  eventId: z.string().uuid(),
  action: z.enum(["activated", "reactivated", "deactivated", "revision_withdrawn"]),
  revisionId: z.string().uuid().nullable(),
  occurredAt: z.string().datetime(),
  reason: z.string().nullable(),
  actorLabel: z.string(),
});

export const adminQuestionDetailResponseSchema = z.object({
  questionId: z.string().uuid(),
  currentRevisionId: z.string().uuid(),
  isActive: z.boolean(),
  activity: z.enum(["active", "inactive"]),
  revisionHealth: z.enum(["safe", "withdrawn"]),
  blockedFromActivation: z.boolean(),
  createdAt: z.string().datetime(),
  currentRevision: adminQuestionListItemSchema.shape.currentRevision.extend({
    revisionId: z.string().uuid(),
    isCurrent: z.literal(true),
  }),
  recentEditorialActivity: z.array(adminQuestionLifecycleEventSchema),
});

export const adminDuplicateMatchSchema = z.object({
  questionId: z.string().uuid(),
  text: z.string(),
  revisionNumber: z.number().int().positive(),
  isActive: z.boolean(),
});

export const adminDuplicateResponseSchema = z.object({
  matches: z.array(adminDuplicateMatchSchema),
});

export const adminQuestionMutationResponseSchema = z.object({
  questionId: z.string().uuid(),
  revisionId: z.string().uuid(),
  revisionNumber: z.number().int().positive(),
  currentRevisionId: z.string().uuid(),
  isActive: z.boolean(),
});

export const adminQuestionActivityResponseSchema = z.object({
  questionId: z.string().uuid(),
  isActive: z.boolean(),
});

export const adminQuestionWithdrawalResponseSchema = z.object({
  questionId: z.string().uuid(),
  revisionId: z.string().uuid(),
  withdrawnAt: z.string().datetime(),
});

export type QuestionRevisionFields = z.infer<typeof questionRevisionFieldsSchema>;
export type AdminQuestionListQuery = z.infer<typeof adminQuestionListQuerySchema>;
export type AdminQuestionListItem = z.infer<typeof adminQuestionListItemSchema>;
