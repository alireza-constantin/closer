import { redirect } from "next/navigation";

import ZeroSpaceHome from "@/features/pair/components/zero-space-home";
import YourSpaces from "@/features/pair/components/your-spaces";
import { getCurrentParticipant } from "@/server/auth/current-participant";
import { listParticipantSpaces } from "@/server/modules/pairs/pair.service";

// Membership can be completed in another browser while this route is cached.
// Resolve it on every request so an active participant never sees onboarding.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function Home() {
  const currentParticipant = await getCurrentParticipant();
  if (!currentParticipant) redirect("/onboarding" as never);

  const spaces = await listParticipantSpaces(currentParticipant.id);
  if (spaces.length === 1) redirect(("/pair/" + spaces[0].pairId) as never);
  if (spaces.length > 1) return <YourSpaces spaces={spaces} />;
  return <ZeroSpaceHome displayName={currentParticipant.displayName} />;
}
