import type { Route } from "next";
import { BookOpenText, House } from "lucide-react";

export type AdminSection = "overview" | "questions";
export type AdminNavIcon = "overview" | "questions";

export const adminNavItems = [
  {
    href: "/admin" as Route,
    label: "Overview",
    section: "overview" as const,
    icon: "overview" as const,
  },
  {
    href: "/admin/questions" as Route,
    label: "Questions",
    section: "questions" as const,
    icon: "questions" as const,
  },
] as const;

export function AdminNavIcon({ icon }: { icon: AdminNavIcon }) {
  const Icon = icon === "overview" ? House : BookOpenText;
  return <Icon aria-hidden="true" className="size-[18px]" />;
}
