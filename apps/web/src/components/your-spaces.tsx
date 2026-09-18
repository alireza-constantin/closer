import { ChevronRight, Plus, Sparkles } from "lucide-react";
import Link from "next/link";

import { buttonVariants } from "@Closer/ui/components/button";
import { cn } from "@Closer/ui/lib/utils";

import { CloserPageShell, CloserTopbar } from "@/components/closer/page-shell";
import { CloserPageTitle, CloserSubtitle } from "@/components/closer/typography";

type SpaceSummary = {
  pairId: string;
  relationshipType: "partner" | "friend";
  state: "connected" | "waiting";
  otherParticipantDisplayName: string | null;
  intendedPersonName: string | null;
};

function relationshipLabel(relationshipType: SpaceSummary["relationshipType"]) {
  return relationshipType === "partner" ? "Partner" : "Friend";
}

function SpaceCard({ space }: { space: SpaceSummary }) {
  const relationship = relationshipLabel(space.relationshipType);
  const isWaiting = space.state === "waiting";

  return (
    <Link
      aria-label={
        isWaiting
          ? `Open not connected ${relationship} space`
          : `Open ${space.otherParticipantDisplayName} ${relationship} space`
      }
      className="group text-closer-navy shadow-closer-soft focus-visible:ring-closer-navy focus-visible:ring-offset-closer-cream grid min-h-[92px] grid-cols-[48px_1fr_auto] items-center gap-3 rounded-[1.35rem] bg-white/85 px-4 py-3.5 no-underline transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-[0_16px_29px_rgba(27,33,78,0.11)] focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
      href={`/pair/${space.pairId}` as never}
      prefetch
    >
      <span
        aria-hidden="true"
        className={cn(
          "text-closer-navy grid size-12 place-items-center rounded-[1.15rem]",
          isWaiting ? "bg-closer-peach" : "bg-closer-lavender-soft",
        )}
      >
        <Sparkles className="size-5" />
      </span>
      <span className="min-w-0">
        <strong className="block truncate text-[1.05rem] font-extrabold tracking-[-.025em]">
          {isWaiting ? "Not connected yet" : space.otherParticipantDisplayName}
        </strong>
        <span className="text-closer-muted mt-1 block text-sm">
          {isWaiting
            ? `${relationship} space · for ${space.intendedPersonName ?? "your person"}`
            : relationship}
        </span>
      </span>
      <ChevronRight
        aria-hidden="true"
        className="size-5 transition-transform duration-200 group-hover:translate-x-0.5"
      />
    </Link>
  );
}

export default function YourSpaces({ spaces }: { spaces: SpaceSummary[] }) {
  return (
    <CloserPageShell className="flex flex-col">
      <CloserTopbar />
      <section className="pt-12 pb-7">
        <CloserPageTitle>Your spaces</CloserPageTitle>
        <CloserSubtitle>Every connection has its own little place.</CloserSubtitle>
      </section>
      <section aria-label="Your Closer spaces" className="grid gap-2.5">
        {spaces.map((space) => (
          <SpaceCard key={space.pairId} space={space} />
        ))}
      </section>
      <Link
        className={cn(buttonVariants({ size: "lg", variant: "default" }), "mt-5 w-full")}
        href={"/create" as never}
        prefetch
      >
        <Plus aria-hidden="true" data-icon="inline-start" />
        Create another space
      </Link>
    </CloserPageShell>
  );
}
