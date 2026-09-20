import {
  adminPaginationQuerySchema,
  adminUuidSchema,
  adminQuestionMutationResponseSchema,
  adminQuestionRevisionHistoryResponseSchema,
  createQuestionRevisionSchema,
} from "@/contracts/admin/question.schema";
import {
  adminErrorResponse,
  adminNoStoreHeaders,
  adminNotFoundResponse,
  authorizeAdminRequest,
  parseAdminJson,
} from "@/server/http/admin-http";
import {
  createCatalogRevision,
  listAdminQuestionRevisions,
} from "@/server/modules/admin-questions/admin-question.service";

export async function GET(request: Request, context: { params: Promise<{ questionId: string }> }) {
  const access = await authorizeAdminRequest(request);
  if (!access.ok) return access.response;

  const query = adminPaginationQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!query.success) {
    return Response.json(
      { error: "Invalid query." },
      { status: 400, headers: adminNoStoreHeaders },
    );
  }

  try {
    const { questionId } = await context.params;
    if (!adminUuidSchema.safeParse(questionId).success) return adminNotFoundResponse();
    const projection = await listAdminQuestionRevisions(
      { questionId, ...query.data },
      access.admin,
    );
    if (!projection) return adminNotFoundResponse();
    const response = adminQuestionRevisionHistoryResponseSchema.parse(projection);
    return Response.json(response, { headers: adminNoStoreHeaders });
  } catch (error) {
    return adminErrorResponse(error);
  }
}

export async function POST(request: Request, context: { params: Promise<{ questionId: string }> }) {
  const access = await authorizeAdminRequest(request);
  if (!access.ok) return access.response;

  const parsed = await parseAdminJson(request, createQuestionRevisionSchema);
  if (parsed.response) return parsed.response;

  try {
    const { questionId } = await context.params;
    if (!adminUuidSchema.safeParse(questionId).success) return adminNotFoundResponse();
    const created = await createCatalogRevision({ ...parsed.data, questionId }, access.adminUserId);
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
