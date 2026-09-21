import { adminQuestionAnalyticsQuerySchema } from "@/contracts/admin/question.schema";
import { getAdminQuestionCoverage } from "@/server/modules/admin-questions/admin-overview.service";
import { listAdminQuestionAnalytics } from "@/server/modules/admin-questions/admin-question-analytics.service";
import { listAdminQuestions } from "@/server/modules/admin-questions/admin-question.service";

import { AdminSectionHeading } from "../_components/admin-facets";
import { AdminShell } from "../_components/admin-shell";
import { QuestionCoverageWorkspace } from "../_components/admin-question-coverage";
import { AdminQuestionWorkspace } from "../_components/admin-question-workspace";
import type { AdminQuestionView } from "../_components/admin-workspace-tabs";
import { requireAdminPage } from "../_lib/admin-page";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function AdminQuestionsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const admin = await requireAdminPage();
  const params = await searchParams;
  if (params.coverage === "all") {
    const lanes = await getAdminQuestionCoverage(admin);

    return (
      <AdminShell activeSection="questions" userEmail={admin.user.email} userName={admin.user.name}>
        <AdminSectionHeading
          description="See eligible question counts and intensity for every conversation type."
          title="Question coverage"
        />
        <QuestionCoverageWorkspace lanes={lanes} />
      </AdminShell>
    );
  }

  const viewValue = typeof params.view === "string" ? params.view : "operations";
  const view: AdminQuestionView =
    viewValue === "private" || viewValue === "together" ? viewValue : "operations";
  const queryInput = Object.fromEntries(
    Object.entries(params).flatMap(([key, value]) =>
      typeof value === "string" ? [[key, value]] : [],
    ),
  );
  const query = adminQuestionAnalyticsQuerySchema.parse(queryInput);
  const data = await listAdminQuestions(query, admin);
  const analytics =
    view === "private" || view === "together"
      ? await listAdminQuestionAnalytics(
          { questions: data.items, revisionScope: query.revisionScope, mode: view },
          admin,
        )
      : undefined;

  return (
    <AdminShell activeSection="questions" userEmail={admin.user.email} userName={admin.user.name}>
      <AdminSectionHeading
        description="Manage the question catalog, create and revise wording, and keep question content healthy."
        title="Questions"
      />
      <AdminQuestionWorkspace
        analytics={analytics}
        data={data}
        filters={query}
        revisionScope={query.revisionScope}
        view={view}
      />
    </AdminShell>
  );
}
