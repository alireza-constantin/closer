import { db, listActivePairsForParticipant } from "@Closer/auth/closer";
import { redirect } from "next/navigation";

import { CloserPageShell, CloserTopbar } from "@/components/closer/page-shell";
import CreatePairForm from "@/components/create-pair-form";
import { getCurrentParticipant } from "@/lib/closer-server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function CreateSpacePage() {
  const currentParticipant = await getCurrentParticipant();
  if (!currentParticipant) redirect("/onboarding" as never);
  const spaces = await listActivePairsForParticipant(db, currentParticipant.id);

  return (
    <CloserPageShell className="flex flex-col">
      <CloserTopbar href="/" />
      <CreatePairForm isFirstSpace={spaces.length === 0} />
    </CloserPageShell>
  );
}
