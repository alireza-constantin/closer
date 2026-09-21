import { notFound } from "next/navigation";

import { adminPaginationQuerySchema, adminUuidSchema } from "@/contracts/admin/question.schema";
import { getAdminQuestionAnalyticsDetail } from "@/server/modules/admin-questions/admin-question-analytics.service";
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
  searchParams: Promise<{ view?: string; page?: string; analyticsRevision?: string }>;
}) {
  const admin = await requireAdminPage();
  const [{ questionId }, search] = await Promise.all([params, searchParams]);
  if (!adminUuidSchema.safeParse(questionId).success) notFound();

  const detail = await getAdminQuestionDetail(questionId, admin);
  if (!detail) notFound();
  const view = search.view === "history" || search.view === "analytics" ? search.view : "overview";
  const pagination = adminPaginationQuerySchema.parse({ page: search.page, pageSize: 100 });
  const revisionHistory =
    view === "history" || view === "analytics"
      ? await listAdminQuestionRevisions({ questionId, ...pagination }, admin)
      : null;
  if ((view === "history" || view === "analytics") && !revisionHistory) notFound();

  let analytics: Awaited<ReturnType<typeof getAdminQuestionAnalyticsDetail>> = null;
  let analyticsRevision = "current";
  if (view === "analytics") {
    const requestedRevision = search.analyticsRevision;
    if (
      requestedRevision &&
      requestedRevision !== "current" &&
      requestedRevision !== "all" &&
      !adminUuidSchema.safeParse(requestedRevision).success
    ) {
      notFound();
    }
    const revisionScope =
      requestedRevision === "all"
        ? "all"
        : requestedRevision && requestedRevision !== "current"
          ? "revision"
          : "current";
    analyticsRevision = requestedRevision ?? "current";
    analytics = await getAdminQuestionAnalyticsDetail(
      {
        questionId,
        revisionScope,
        ...(revisionScope === "revision" ? { revisionId: requestedRevision } : {}),
      },
      admin,
    );
    if (!analytics) notFound();
  }

  return (
    <AdminShell activeSection="questions" userEmail={admin.user.email} userName={admin.user.name}>
      <AdminQuestionDetail
        detail={detail}
        analytics={analytics}
        analyticsRevision={analyticsRevision}
        page={revisionHistory?.page ?? 1}
        revisions={revisionHistory?.items ?? []}
        total={revisionHistory?.total ?? 0}
        view={view}
      />
    </AdminShell>
  );
}
