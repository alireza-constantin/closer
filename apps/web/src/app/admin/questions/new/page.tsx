import type { Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { adminUuidSchema } from "@/contracts/admin/question.schema";
import { getAdminQuestionDetail } from "@/server/modules/admin-questions/admin-question.service";

import { AdminSectionHeading } from "../../_components/admin-facets";
import { AdminShell } from "../../_components/admin-shell";
import { AdminQuestionEditor } from "../../_components/admin-question-editor";
import { requireAdminPage } from "../../_lib/admin-page";

export default async function NewQuestionPage({
  searchParams,
}: {
  searchParams: Promise<{ questionId?: string }>;
}) {
  const admin = await requireAdminPage();
  const { questionId } = await searchParams;
  let question: Awaited<ReturnType<typeof getAdminQuestionDetail>> = null;

  if (questionId) {
    if (!adminUuidSchema.safeParse(questionId).success) notFound();
    question = await getAdminQuestionDetail(questionId, admin);
    if (!question) notFound();
  }

  const current = question?.currentRevision;
  const title = question ? "Create New Revision" : "Create New Question";
  const description = question
    ? `Add a new version of Question ${questionId?.slice(0, 8)}. Review the latest revision before saving.`
    : "Add a new question to the catalog.";

  return (
    <AdminShell activeSection="questions" userEmail={admin.user.email} userName={admin.user.name}>
      <div className="mb-5">
        <Link
          className="text-closer-navy rounded-md text-sm font-bold underline-offset-4 hover:underline focus-visible:ring-2"
          href={(questionId ? `/admin/questions/${questionId}` : "/admin/questions") as Route}
        >
          ← Back to questions
        </Link>
      </div>
      <AdminSectionHeading description={description} title={title} />
      <AdminQuestionEditor
        currentActivity={question?.activity}
        currentRevisionId={question?.currentRevisionId}
        initialValues={
          current
            ? {
                text: current.text,
                category: current.category,
                intensity: current.intensity,
                relationshipFit: current.relationshipFit,
                modeFit: current.modeFit,
              }
            : undefined
        }
        questionId={question?.questionId}
      />
    </AdminShell>
  );
}
