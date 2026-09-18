import { describe, expect, test } from "bun:test";

import { categoryLabel, categoriesForRelationship } from "@/components/closer/category";

describe("categoriesForRelationship", () => {
  test("reuses the canonical immutable list for each relationship type", () => {
    expect(categoriesForRelationship("partner")).toBe(categoriesForRelationship("partner"));
    expect(categoriesForRelationship("friend")).toBe(categoriesForRelationship("friend"));
  });

  test("keeps relationship-specific labels out of the other Pair type", () => {
    expect(categoriesForRelationship("partner").map(categoryLabel)).toEqual([
      "Fun",
      "Deep",
      "Memories",
      "Relationship",
    ]);
    expect(categoriesForRelationship("friend").map(categoryLabel)).toEqual([
      "Fun",
      "Deep",
      "Memories",
      "Friendship",
    ]);
  });
});
