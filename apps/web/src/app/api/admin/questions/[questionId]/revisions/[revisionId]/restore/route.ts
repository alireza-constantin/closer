import {
  adminUuidSchema,
  adminQuestionMutationResponseSchema,
  restoreQuestionRevisionSchema,
} from "@/contracts/admin/question.schema";
import {
  adminErrorResponse,
  adminNoStoreHeaders,
  authorizeAdminRequest,
  parseAdminJson,
} from "@/server/http/admin-http";
import { restoreCatalogRevision } from "@/server/modules/admin-questions/admin-question.service";

export async function POST(
  request: Request,
  context: { params: Promise<{ questionId: string; revisionId: string }> },
) {
  const access = await authorizeAdminRequest(request);
  if (!access.ok) return access.response;

  const parsed = await parseAdminJson(request, restoreQuestionRevisionSchema);
  if (parsed.response) return parsed.response;

  try {
    const { questionId, revisionId } = await context.params;
    if (
      !adminUuidSchema.safeParse(questionId).success ||
      !adminUuidSchema.safeParse(revisionId).success
    ) {
      return Response.json(
        { error: "Question not found." },
        { status: 404, headers: adminNoStoreHeaders },
      );
    }
    const restored = await restoreCatalogRevision({
      questionId,
      sourceRevisionId: revisionId,
      adminUserId: access.adminUserId,
      ...parsed.data,
    });
    const response = adminQuestionMutationResponseSchema.parse({
      questionId: restored.question.id,
      revisionId: restored.revision.id,
      revisionNumber: restored.revision.revisionNumber,
      currentRevisionId: restored.question.currentRevisionId,
      isActive: restored.question.isActive,
    });
    return Response.json(response, { status: 201, headers: adminNoStoreHeaders });
  } catch (error) {
    return adminErrorResponse(error);
  }
}
