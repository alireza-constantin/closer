import {
  adminUuidSchema,
  adminQuestionActivityResponseSchema,
  lifecycleReasonSchema,
} from "@/contracts/admin/question.schema";
import {
  adminErrorResponse,
  adminNoStoreHeaders,
  authorizeAdminRequest,
  parseAdminJson,
} from "@/server/http/admin-http";
import { changeCatalogQuestionActivity } from "@/server/modules/admin-questions/admin-question.service";

const lifecycleActions = ["activate", "deactivate", "reactivate"] as const;

export async function POST(
  request: Request,
  context: { params: Promise<{ questionId: string; action: string }> },
) {
  const access = await authorizeAdminRequest(request);
  if (!access.ok) return access.response;

  const parsed = await parseAdminJson(request, lifecycleReasonSchema);
  if (parsed.response) return parsed.response;

  const { questionId, action } = await context.params;
  if (!adminUuidSchema.safeParse(questionId).success) {
    return Response.json(
      { error: "Question not found." },
      { status: 404, headers: adminNoStoreHeaders },
    );
  }
  if (!lifecycleActions.includes(action as (typeof lifecycleActions)[number])) {
    return Response.json(
      { error: "Lifecycle action not found." },
      { status: 404, headers: adminNoStoreHeaders },
    );
  }

  try {
    const updated = await changeCatalogQuestionActivity(
      action as (typeof lifecycleActions)[number],
      {
        questionId,
        adminUserId: access.adminUserId,
        ...parsed.data,
      },
    );
    const response = adminQuestionActivityResponseSchema.parse({
      questionId: updated.id,
      isActive: updated.isActive,
    });
    return Response.json(response, { headers: adminNoStoreHeaders });
  } catch (error) {
    return adminErrorResponse(error);
  }
}
