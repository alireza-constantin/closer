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
    "pair/[pairId]/together/[sessionId]/loading.tsx",
    "pair/[pairId]/private/loading.tsx",
    "pair/[pairId]/private/conversation/[conversationId]/loading.tsx",
    "pair/[pairId]/private/round/[roundId]/loading.tsx",
    "pair/[pairId]/history/loading.tsx",
  ])("provides an immediate loading boundary for %s", async (routeFile) => {
    expect(await Bun.file(join(appDirectory, routeFile)).exists()).toBe(true);
  });

  test("renders static Together picker routes without an authorization or Pair projection", async () => {
    const partnerSource = await Bun.file(
      join(appDirectory, "pair/[pairId]/together/partner/page.tsx"),
    ).text();
    const friendSource = await Bun.file(
      join(appDirectory, "pair/[pairId]/together/friend/page.tsx"),
    ).text();
    const partnerLoadingSource = await Bun.file(
      join(appDirectory, "pair/[pairId]/together/partner/loading.tsx"),
    ).text();
    const friendLoadingSource = await Bun.file(
      join(appDirectory, "pair/[pairId]/together/friend/loading.tsx"),
    ).text();
    const frameSource = await Bun.file(
      join(appDirectory, "..", "features/together-session/components/together-picker-frame.tsx"),
    ).text();
    const modeCardSource = await Bun.file(
      join(appDirectory, "..", "components/closer/navigation.tsx"),
    ).text();
    const pairHomeSource = await Bun.file(
      join(appDirectory, "..", "features/pair/components/pair-home.tsx"),
    ).text();
    const createPairSource = await Bun.file(
      join(appDirectory, "..", "features/pair/components/create-pair-form.tsx"),
    ).text();

    expect(partnerSource).toContain('relationshipType="partner"');
    expect(friendSource).toContain('relationshipType="friend"');
    expect(partnerSource).not.toContain("getPairForParticipant");
    expect(friendSource).not.toContain("getPairForParticipant");
    expect(partnerSource).not.toContain("Suspense");
    expect(friendSource).not.toContain("Suspense");
    expect(partnerLoadingSource).toContain("return null;");
    expect(friendLoadingSource).toContain("return null;");
    expect(modeCardSource).toContain("prefetch={prefetch}");
    expect(pairHomeSource).toContain('title="Talk Together"');
    expect(pairHomeSource).toContain("prefetch");
    expect(createPairSource).toContain("prefetch");
    expect(createPairSource).toContain('title="Together"');
    expect(frameSource).toContain("CloserWordmark");
    expect(frameSource).toContain('<ModeBadge mode="together" />');
    expect(frameSource).toContain("CloserPageTitle");
    expect(frameSource).toContain("CloserSubtitle");
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
    "features/invite/components/connect-page-frame.tsx",
    "features/invite/components/rejoin-controls.tsx",
    "features/together-session/components/together-picker-frame.tsx",
    "features/private-conversation/components/private-picker.tsx",
    "features/private-conversation/components/private-conversation-screen.tsx",
    "features/private-conversation/components/private-round-screen.tsx",
    "app/pair/[pairId]/history/_components/history-screen.tsx",
    "features/together-session/components/together-session-screen.tsx",
  ])("uses the shared Next Link-backed back control in %s", async (componentFile) => {
    const source = await Bun.file(join(appDirectory, "..", componentFile)).text();

    expect(source).toContain("CloserBackLink");
    expect(source).not.toContain("CloserBackButton");
  });

  test("makes the shared Back control a deterministic, prefetched product route", async () => {
    const source = await Bun.file(
      join(appDirectory, "..", "components/closer/navigation.tsx"),
    ).text();

    expect(source).toContain("prefetch");
    expect(source).toContain("useLinkStatus");
    expect(source).not.toContain("router.back");
  });

  test.each([
    "features/pair/components/zero-space-home.tsx",
    "features/pair/components/your-spaces.tsx",
    "features/pair/components/pair-home.tsx",
    "features/private-conversation/components/private-conversation-screen.tsx",
    "features/private-conversation/components/private-round-screen.tsx",
    "features/pair/components/create-pair-form.tsx",
    "components/closer/page-shell.tsx",
  ])("explicitly prefetches known internal destinations in %s", async (componentFile) => {
    const source = await Bun.file(join(appDirectory, "..", componentFile)).text();

    expect(source).toContain("prefetch");
  });

  test("has no browser-history or full-page internal navigation in product code", async () => {
    const componentFiles = [
      "features/invite/components/connect-person.tsx",
      "features/private-conversation/components/private-picker.tsx",
      "features/private-conversation/components/private-conversation-screen.tsx",
      "features/private-conversation/components/private-round-screen.tsx",
      "features/together-session/components/together-picker.tsx",
      "features/together-session/components/together-session-screen.tsx",
      "features/pair/components/pair-termination-control.tsx",
    ];

    for (const componentFile of componentFiles) {
      const source = await Bun.file(join(appDirectory, "..", componentFile)).text();
      expect(source).not.toContain("router.back(");
      expect(source).not.toContain("window.location.href");
      expect(source).not.toContain("location.href");
    }
  });
});
