import {
  adminQuestionDetailResponseSchema,
  adminUuidSchema,
} from "@/contracts/admin/question.schema";
import {
  adminErrorResponse,
  adminNoStoreHeaders,
  adminNotFoundResponse,
  authorizeAdminRequest,
} from "@/server/http/admin-http";
import { getAdminQuestionDetail } from "@/server/modules/admin-questions/admin-question.service";

export async function GET(request: Request, context: { params: Promise<{ questionId: string }> }) {
  const access = await authorizeAdminRequest(request);
  if (!access.ok) return access.response;

  try {
    const { questionId } = await context.params;
    if (!adminUuidSchema.safeParse(questionId).success) return adminNotFoundResponse();
    const projection = await getAdminQuestionDetail(questionId, access.admin);
    if (!projection) return adminNotFoundResponse();
    const response = adminQuestionDetailResponseSchema.parse(projection);
    return Response.json(response, { headers: adminNoStoreHeaders });
  } catch (error) {
    return adminErrorResponse(error);
  }
}
