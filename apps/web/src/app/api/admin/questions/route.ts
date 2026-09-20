import {
  adminQuestionListQuerySchema,
  adminQuestionMutationResponseSchema,
  adminQuestionListResponseSchema,
  createQuestionSchema,
} from "@/contracts/admin/question.schema";
import {
  adminErrorResponse,
  adminNoStoreHeaders,
  authorizeAdminRequest,
  parseAdminJson,
} from "@/server/http/admin-http";
import {
  createCatalogQuestion,
  listAdminQuestions,
} from "@/server/modules/admin-questions/admin-question.service";

export async function GET(request: Request) {
  const access = await authorizeAdminRequest(request);
  if (!access.ok) return access.response;

  const query = adminQuestionListQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!query.success) {
    return Response.json(
      { error: "Invalid query." },
      { status: 400, headers: adminNoStoreHeaders },
    );
  }

  try {
    const projection = await listAdminQuestions(query.data, access.admin);
    const response = adminQuestionListResponseSchema.parse(projection);
    return Response.json(response, { headers: adminNoStoreHeaders });
  } catch (error) {
    return adminErrorResponse(error);
  }
}

export async function POST(request: Request) {
  const access = await authorizeAdminRequest(request);
  if (!access.ok) return access.response;

  const parsed = await parseAdminJson(request, createQuestionSchema);
  if (parsed.response) return parsed.response;

  try {
    const created = await createCatalogQuestion(parsed.data, access.adminUserId);
    const response = adminQuestionMutationResponseSchema.parse({
      questionId: created.question.id,
      revisionId: created.revision.id,
      revisionNumber: created.revision.revisionNumber,
      currentRevisionId: created.question.currentRevisionId,
      isActive: created.question.isActive,
    });
    return Response.json(response, { status: 201, headers: adminNoStoreHeaders });
  } catch (error) {
    return adminErrorResponse(error);
  }
}
