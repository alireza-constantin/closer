import { notFound } from "next/navigation";

import { adminPaginationQuerySchema, adminUuidSchema } from "@/contracts/admin/question.schema";
import {
  getAdminQuestionDetail,
  listAdminQuestionRevisions,
} from "@/server/modules/admin-questions/admin-question.service";

import { AdminQuestionDetail } from "../../_components/admin-question-detail";
import { AdminShell } from "../../_components/admin-shell";
import { requireAdminPage } from "../../_lib/admin-page";

export default async function AdminQuestionDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ questionId: string }>;
  searchParams: Promise<{ view?: string; page?: string }>;
}) {
  const admin = await requireAdminPage();
  const [{ questionId }, search] = await Promise.all([params, searchParams]);
  if (!adminUuidSchema.safeParse(questionId).success) notFound();

  const detail = await getAdminQuestionDetail(questionId, admin);
  if (!detail) notFound();
  const pagination = adminPaginationQuerySchema.parse({ page: search.page, pageSize: 100 });
  const revisionHistory = await listAdminQuestionRevisions({ questionId, ...pagination }, admin);
  if (!revisionHistory) notFound();
  const view = search.view === "history" || search.view === "analytics" ? search.view : "overview";

  return (
    <AdminShell activeSection="questions" userEmail={admin.user.email} userName={admin.user.name}>
      <AdminQuestionDetail
        detail={detail}
        page={revisionHistory.page}
        revisions={revisionHistory.items}
        total={revisionHistory.total}
        view={view}
      />
    </AdminShell>
  );
}
