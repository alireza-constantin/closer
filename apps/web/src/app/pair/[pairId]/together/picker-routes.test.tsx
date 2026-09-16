import { describe, expect, test } from "bun:test";
import { join } from "node:path";

describe("static Together picker routes", () => {
  test.each([
    ["partner", "partner/page.tsx"],
    ["friend", "friend/page.tsx"],
  ] as const)("renders the static %s category picker without a Pair projection", async (relationshipType, routeFile) => {
    const source = await Bun.file(join(import.meta.dir, routeFile)).text();

    expect(source).toContain("TogetherPickerFrame");
    expect(source).toContain("TogetherPicker");
    expect(source).toContain(`relationshipType=\"${relationshipType}\"`);
  });

  test.each(["partner/page.tsx", "friend/page.tsx"])("does not read Pair data in %s", async (routeFile) => {
    const source = await Bun.file(join(import.meta.dir, routeFile)).text();

    expect(source).not.toContain("@Closer/auth/closer");
    expect(source).not.toContain("getCurrentParticipant");
    expect(source).not.toContain("getPairForParticipant");
    expect(source).not.toContain("Suspense");
  });
});
