import type { Category } from "@/features/admin/api";

const categoryLabels: Record<Category, string> = {
  fun: "Fun",
  deep: "Deep",
  memories: "Memories",
  relationship: "Relationship",
  friendship: "Friendship",
};

export function adminCategoryLabel(value: string): string {
  return value in categoryLabels ? categoryLabels[value as Category] : "Friendship";
}

export const adminCategoryTone: Record<Category, string> = {
  fun: "bg-closer-yellow/30",
  deep: "bg-closer-blue/20",
  memories: "bg-closer-mint/30",
  relationship: "bg-closer-coral/15",
  friendship: "bg-closer-peach/60",
};
