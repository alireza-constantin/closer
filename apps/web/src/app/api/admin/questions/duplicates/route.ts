import {
  adminDuplicateQuerySchema,
  adminDuplicateResponseSchema,
} from "@/contracts/admin/question.schema";
import {
  adminErrorResponse,
  adminNoStoreHeaders,
  authorizeAdminRequest,
} from "@/server/http/admin-http";
import { findAdminQuestionDuplicates } from "@/server/modules/admin-questions/admin-question.service";

export async function GET(request: Request) {
  const access = await authorizeAdminRequest(request);
  if (!access.ok) return access.response;

  const query = adminDuplicateQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!query.success) {
    return Response.json(
      { error: "Invalid query." },
      { status: 400, headers: adminNoStoreHeaders },
    );
  }

  try {
    const response = adminDuplicateResponseSchema.parse(
      await findAdminQuestionDuplicates(query.data, access.admin),
    );
    return Response.json(response, { headers: adminNoStoreHeaders });
  } catch (error) {
    return adminErrorResponse(error);
  }
}
