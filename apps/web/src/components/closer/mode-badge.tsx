import { LockKeyhole, UsersRound } from "lucide-react";

import { cn } from "@Closer/ui/lib/utils";

const modeBadgeClasses = {
  private: "bg-closer-lavender-soft text-closer-navy",
  together: "bg-closer-coral-soft text-closer-coral",
} as const;

export function ModeBadge({ mode }: { mode: "private" | "together" }) {
  const Icon = mode === "private" ? LockKeyhole : UsersRound;
  return <span className={cn("inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-[.82rem] font-extrabold", modeBadgeClasses[mode])}><Icon aria-hidden="true" className="size-4" />{mode === "private" ? "Private" : "Together"}</span>;
}
