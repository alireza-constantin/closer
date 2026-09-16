import { describe, expect, test } from "bun:test";

import { categoriesForRelationship } from "@/components/closer/category";

describe("categoriesForRelationship", () => {
  test("reuses the canonical immutable list for each relationship type", () => {
    expect(categoriesForRelationship("partner")).toBe(categoriesForRelationship("partner"));
    expect(categoriesForRelationship("friend")).toBe(categoriesForRelationship("friend"));
  });
});
