import {
  adminUuidSchema,
  adminQuestionWithdrawalResponseSchema,
  withdrawQuestionRevisionSchema,
} from "@/contracts/admin/question.schema";
import {
  adminErrorResponse,
  adminNoStoreHeaders,
  adminNotFoundResponse,
  authorizeAdminRequest,
  parseAdminJson,
} from "@/server/http/admin-http";
import { withdrawCatalogRevision } from "@/server/modules/admin-questions/admin-question.service";

export async function POST(
  request: Request,
  context: { params: Promise<{ questionId: string; revisionId: string }> },
) {
  const access = await authorizeAdminRequest(request);
  if (!access.ok) return access.response;

  const parsed = await parseAdminJson(request, withdrawQuestionRevisionSchema);
  if (parsed.response) return parsed.response;

  try {
    const { questionId, revisionId } = await context.params;
    if (
      !adminUuidSchema.safeParse(questionId).success ||
      !adminUuidSchema.safeParse(revisionId).success
    ) {
      return adminNotFoundResponse();
    }
    const withdrawn = await withdrawCatalogRevision({
      questionId,
      revisionId,
      adminUserId: access.adminUserId,
      ...parsed.data,
    });
    if (!withdrawn) return adminNotFoundResponse();
    const response = adminQuestionWithdrawalResponseSchema.parse({
      questionId: withdrawn.questionId,
      revisionId: withdrawn.id,
      withdrawnAt: withdrawn.withdrawnAt?.toISOString(),
    });
    return Response.json(response, { headers: adminNoStoreHeaders });
  } catch (error) {
    return adminErrorResponse(error);
  }
}
