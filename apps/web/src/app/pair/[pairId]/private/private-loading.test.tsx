import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

import {
  PrivateConversationSkeleton,
  PrivatePickerSkeleton,
  PrivateRoundSkeleton,
} from "@/features/private-conversation/components/private-route-skeletons";

const privateDirectory = import.meta.dir;

async function source(path: string) {
  return Bun.file(join(privateDirectory, path)).text();
}

describe("Private route loading ownership", () => {
  test("keeps the picker fallback local to the picker page rather than a broad Private segment", async () => {
    const pickerPage = await source("page.tsx");
    const broadLoading = Bun.file(join(privateDirectory, "loading.tsx"));

    expect(await broadLoading.exists()).toBe(false);
    expect(pickerPage).toContain("<Suspense fallback={<PrivatePickerSkeleton />}>");
    expect(pickerPage).toContain("<PrivatePickerPageContent params={params} />");
  });

  test("assigns each leaf route its own destination-specific fallback", async () => {
    const conversationLoading = await source("conversation/[conversationId]/loading.tsx");
    const roundLoading = await source("round/[roundId]/loading.tsx");
    const sharedRouteLoading = await source("../../../../components/closer/route-loading.tsx");

    expect(conversationLoading).toContain("PrivateConversationSkeleton");
    expect(roundLoading).toContain("PrivateRoundSkeleton");
    expect(sharedRouteLoading).not.toContain('"private-picker"');
    expect(sharedRouteLoading).not.toContain('"private-conversation"');
    expect(sharedRouteLoading).not.toContain('"private-round"');
  });

  test("renders geometry and accessible labels for the matching Private destination", () => {
    const picker = renderToStaticMarkup(<PrivatePickerSkeleton />);
    const conversation = renderToStaticMarkup(<PrivateConversationSkeleton />);
    const round = renderToStaticMarkup(<PrivateRoundSkeleton />);

    expect(picker).toContain('aria-label="Private picker loading"');
    expect(picker).toContain("min-h-[78px]");
    expect(conversation).toContain('aria-label="Private conversation loading"');
    expect(conversation).toContain("grid-cols-2");
    expect(round).toContain('aria-label="Private answer loading"');
    expect(round).toContain("min-h-[calc(100svh-100px)]");
    expect(round).toContain("min-h-[132px]");
  });
});
