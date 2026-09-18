import { describe, expect, test } from "bun:test";
import { join } from "node:path";

describe("CreatePairForm relationship selector", () => {
  test("uses one controlled, visible radio group with named option descriptions", async () => {
    const source = await Bun.file(join(import.meta.dir, "create-pair-form.tsx")).text();

    expect(source).toContain('name="relationshipType"');
    expect(source).toContain("value={field.value}");
    expect(source).toContain("onValueChange={(value) =>");
    expect(source).toContain("<RadioGroupItem");
    expect(source).not.toContain('className="sr-only"');
    expect(source).toContain("aria-describedby={`${value}-relationship-description`}");
    expect(source).toContain("data-checked:bg-closer-coral");
    expect(source).toContain("field.value === value");
    expect(source).toContain("For the two of you");
    expect(source).toContain("For close friends");
  });
});
