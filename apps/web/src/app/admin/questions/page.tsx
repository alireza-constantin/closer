import { adminQuestionListQuerySchema } from "@/contracts/admin/question.schema";
import { listAdminQuestions } from "@/server/modules/admin-questions/admin-question.service";

import { AdminSectionHeading } from "../_components/admin-facets";
import { AdminShell } from "../_components/admin-shell";
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
  const viewValue = typeof params.view === "string" ? params.view : "operations";
  const view: AdminQuestionView =
    viewValue === "private" || viewValue === "together" ? viewValue : "operations";
  const queryInput = Object.fromEntries(
    Object.entries(params).flatMap(([key, value]) =>
      typeof value === "string" ? [[key, value]] : [],
    ),
  );
  const query = adminQuestionListQuerySchema.parse(queryInput);
  const data = await listAdminQuestions(query, admin);

  return (
    <AdminShell activeSection="questions" userEmail={admin.user.email} userName={admin.user.name}>
      <AdminSectionHeading
        description="Manage the question catalog, create and revise wording, and keep question content healthy."
        title="Questions"
      />
      <AdminQuestionWorkspace data={data} filters={query} view={view} />
    </AdminShell>
  );
}
