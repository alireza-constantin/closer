import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const appDirectory = import.meta.dir;

const renderTimeMutationCommands = [
  "startOrResumePrivateConversation",
  "startTogetherSession",
  "issueOrReuseInitialInvite",
  "replaceInitialInvite",
  "issueRejoinInvite",
  "redeemInitialInvite",
  "redeemRejoinInvite",
  "markPrivateRevealViewed",
  "terminatePair",
  "endTogetherSession",
];

async function routeSource(routeFile: string) {
  return Bun.file(join(appDirectory, routeFile)).text();
}

describe("prefetch-safe route entry", () => {
  test.each([
    "page.tsx",
    "create/page.tsx",
    "onboarding/page.tsx",
    "pair/[pairId]/page.tsx",
    "pair/[pairId]/together/page.tsx",
    "pair/[pairId]/together/partner/page.tsx",
    "pair/[pairId]/together/friend/page.tsx",
    "pair/[pairId]/together/[sessionId]/page.tsx",
    "pair/[pairId]/private/page.tsx",
    "pair/[pairId]/private/conversation/[conversationId]/page.tsx",
    "pair/[pairId]/private/round/[roundId]/page.tsx",
    "pair/[pairId]/history/page.tsx",
    "pair/[pairId]/invite/page.tsx",
    "join/[token]/page.tsx",
    "pair/[pairId]/rejoin/page.tsx",
    "rejoin/[token]/page.tsx",
  ])("keeps %s read-only when React renders or prefetches it", async (routeFile) => {
    const source = await routeSource(routeFile);

    for (const command of renderTimeMutationCommands) {
      expect(source).not.toContain(command);
    }
  });

  test("keeps category pickers inert until an explicit POST", async () => {
    const privatePicker = await Bun.file(join(appDirectory, "..", "components/private-picker.tsx")).text();
    const togetherPicker = await Bun.file(join(appDirectory, "..", "components/together-picker.tsx")).text();
    const privateRoute = await routeSource("api/pairs/[pairId]/private-conversations/route.ts");
    const togetherRoute = await routeSource("api/pairs/[pairId]/together/sessions/route.ts");

    expect(privatePicker).toContain('method: "POST"');
    expect(togetherPicker).toContain('method: "POST"');
    expect(privateRoute).toContain("export async function GET");
    expect(privateRoute).toContain("listActivePrivateConversations");
    expect(privateRoute.split("export async function GET", 2)[1].split("export async function POST", 1)[0]).not.toContain("startOrResumePrivateConversation");
    expect(togetherRoute).not.toContain("export async function GET");
    expect(togetherRoute).toContain("export async function POST");
    expect(togetherRoute).toContain("startTogetherSession");
  });

  test("keeps credential previews read-only and redemption explicit", async () => {
    const inviteRoute = await routeSource("api/pairs/[pairId]/invite/route.ts");
    const initialRedeemRoute = await routeSource("api/invites/[token]/redeem/route.ts");
    const rejoinRedeemRoute = await routeSource("api/rejoin/[token]/redeem/route.ts");
    const rejoinRoute = await routeSource("api/pairs/[pairId]/rejoin/route.ts");

    expect(inviteRoute).toContain("export async function GET");
    expect(inviteRoute).toContain("getInitialInviteStatus");
    expect(inviteRoute.split("export async function GET", 2)[1].split("export async function POST", 1)[0]).not.toContain("issueOrReuseInitialInvite");
    expect(initialRedeemRoute).toContain("export async function POST");
    expect(initialRedeemRoute).toContain("redeemInitialInvite");
    expect(rejoinRedeemRoute).toContain("export async function POST");
    expect(rejoinRedeemRoute).toContain("redeemRejoinInvite");
    expect(rejoinRoute).not.toContain("export async function GET");
    expect(rejoinRoute).toContain("export async function POST");
    expect(rejoinRoute).toContain("issueRejoinInvite");
  });

  test("keeps Round reads, history, and termination rendering inert", async () => {
    const roundRoute = await routeSource("api/pairs/[pairId]/private-rounds/[roundId]/route.ts");
    const revealRoute = await routeSource("api/pairs/[pairId]/private-rounds/[roundId]/reveal/route.ts");
    const terminationControl = await Bun.file(join(appDirectory, "..", "components/pair-termination-control.tsx")).text();

    expect(roundRoute).toContain("export async function GET");
    expect(roundRoute).not.toContain("markPrivateRevealViewed");
    expect(revealRoute).not.toContain("export async function GET");
    expect(revealRoute).toContain("export async function POST");
    expect(revealRoute).toContain("markPrivateRevealViewed");
    expect(terminationControl).toContain('method: "POST"');
    expect(terminationControl).not.toContain("useEffect");
  });

  test("keeps the Together question-buffer prefetch read-only", async () => {
    const sessionScreen = await Bun.file(join(appDirectory, "..", "components/together-session-screen.tsx")).text();
    const questionPageRoute = await routeSource("api/pairs/[pairId]/together/sessions/[sessionId]/questions/route.ts");

    expect(sessionScreen).toContain("shouldPrefetchTogetherQuestionPage");
    expect(sessionScreen).toContain('fetch(`${baseUrl}/questions?band=${encodeURIComponent(band)}&cursor=${encodeURIComponent(cursor)}`, { cache: "no-store" })');
    expect(questionPageRoute).toContain("export async function GET");
    expect(questionPageRoute).toContain("getTogetherQuestionPageForParticipant");
    for (const command of ["startTogetherSession", "advanceTogetherSession", "endTogetherSession", "toggleTogetherQuestionLike"]) {
      expect(questionPageRoute).not.toContain(command);
    }
  });
});
