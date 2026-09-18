import { describe, expect, test } from "bun:test";
import { join } from "node:path";

describe("Pair layout lifecycle ownership", () => {
  test("mounts realtime only for an active Pair entry", async () => {
    const source = await Bun.file(join(import.meta.dir, "layout.tsx")).text();

    expect(source).toContain('if (entry.state === "terminated") return children');
    expect(source).toContain(
      "<PairRealtimeProvider pairId={pairId}>{children}</PairRealtimeProvider>",
    );
  });
});
