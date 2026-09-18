import { describe, expect, test } from "bun:test";

import { togetherPickerPath } from "@/features/together-session/utils/together-picker-path";

describe("togetherPickerPath", () => {
  test("uses the Pair relationship type as the picker route segment", () => {
    expect(togetherPickerPath("pair-1", "partner")).toBe("/pair/pair-1/together/partner");
    expect(togetherPickerPath("pair-1", "friend")).toBe("/pair/pair-1/together/friend");
  });
});
