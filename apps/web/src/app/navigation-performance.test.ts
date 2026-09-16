import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const appDirectory = import.meta.dir;

describe("App Router navigation feedback", () => {
  test.each([
    "loading.tsx",
    "onboarding/loading.tsx",
    "join/[token]/loading.tsx",
    "rejoin/[token]/loading.tsx",
    "pair/[pairId]/loading.tsx",
    "pair/[pairId]/invite/loading.tsx",
    "pair/[pairId]/rejoin/loading.tsx",
    "pair/[pairId]/together/loading.tsx",
    "pair/[pairId]/private/loading.tsx",
    "pair/[pairId]/history/loading.tsx",
  ])("provides an immediate loading boundary for %s", async (routeFile) => {
    expect(await Bun.file(join(appDirectory, routeFile)).exists()).toBe(true);
  });

  test.each([
    "pair/[pairId]/private/page.tsx",
    "pair/[pairId]/private/conversation/[conversationId]/page.tsx",
    "pair/[pairId]/private/round/[roundId]/page.tsx",
    "pair/[pairId]/history/page.tsx",
  ])("keeps participant-relative projections uncached in %s", async (routeFile) => {
    const source = await Bun.file(join(appDirectory, routeFile)).text();

    expect(source).not.toContain('"use cache"');
    expect(source).not.toContain("'use cache'");
  });

  test.each([
    "components/connect-person.tsx",
    "components/rejoin-controls.tsx",
    "components/together-picker.tsx",
    "components/private-picker.tsx",
    "components/private-conversation-screen.tsx",
    "components/private-round-screen.tsx",
    "components/together-session-screen.tsx",
  ])("uses the shared Next Link-backed back control in %s", async (componentFile) => {
    const source = await Bun.file(join(appDirectory, "..", componentFile)).text();

    expect(source).toContain("CloserBackLink");
    expect(source).not.toContain("CloserBackButton");
  });
});
