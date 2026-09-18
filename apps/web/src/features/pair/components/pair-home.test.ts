import { describe, expect, test } from "bun:test";
import { join } from "node:path";

describe("Pair Home member-name projection", () => {
  test("keeps the canonical second-slot name separate from viewer-relative status", async () => {
    const source = await Bun.file(join(import.meta.dir, "pair-home.tsx")).text();

    expect(source).toContain(
      "const secondMemberDisplayName = memberNames[1] ?? claimedParticipantDisplayName",
    );
    expect(source).toContain("`${memberNames[0]} + ${secondMemberDisplayName}`");
  });
});
