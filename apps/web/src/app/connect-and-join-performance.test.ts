import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const appDirectory = import.meta.dir;
const source = (path: string) => Bun.file(join(appDirectory, path)).text();

describe("Connect and invitation-join streaming boundaries", () => {
  test("keeps the unclaimed Private route read-only and directs Pair Home to the current-state-safe Connect entry", async () => {
    const privatePage = await source("pair/[pairId]/private/page.tsx");
    const pairHome = await source("../components/pair-home.tsx");

    expect(privatePage).toContain('redirect(`/pair/${pairId}/invite?reason=private` as never)');
    expect(privatePage).not.toContain("startOrResumePrivateConversation");
    expect(privatePage).not.toContain("createPrivateQuestionCandidate");
    expect(pairHome).toContain('isCurrentlyComplete ? `/pair/${pairId}/private` : `/pair/${pairId}/invite?reason=private`');
  });

  test("streams only authorized invitation controls beneath the immediate Connect frame", async () => {
    const invitePage = await source("pair/[pairId]/invite/page.tsx");
    const frame = await source("../components/connect-page-frame.tsx");

    expect(invitePage).toContain("<ConnectPageFrame pairId={pairId}>");
    expect(invitePage).toContain("<Suspense fallback={<InviteControlsSkeleton />}>");
    expect(invitePage).toContain("async function AuthorizedInviteControls");
    expect(invitePage.split("export default", 2)[1]).not.toContain("getPairForParticipant");
    expect(frame).toContain("Connect your person");
    expect(frame).toContain("Private questions work when you can each answer");
  });

  test("uses a Connect-shaped fallback instead of Private category copy", async () => {
    const privateLoading = await source("pair/[pairId]/private/loading.tsx");
    const connectLoading = await source("../components/connect-route-loading.tsx");
    const inviteSkeleton = await source("../components/invite-controls.tsx");

    expect(privateLoading).toContain("ConnectRouteLoading");
    expect(privateLoading).not.toContain("private-picker");
    expect(connectLoading).toContain("ConnectPageFrame");
    expect(inviteSkeleton).toContain("InviteControlsSkeleton");
    expect(inviteSkeleton).toContain("size-[min(224px,62vw)]");
    expect(inviteSkeleton).toContain("grid-cols-2");
    expect(inviteSkeleton).toContain("h-10 w-full");
  });

  test("keeps the invite lookup inert and limits issue/reuse to mounted Connect interaction", async () => {
    const controls = await source("../components/invite-controls.tsx");
    const inviteRoute = await source("api/pairs/[pairId]/invite/route.ts");

    expect(controls).toContain("if (autoGenerate) void reuseOrGenerateInvite()");
    expect(inviteRoute.split("export async function GET", 2)[1].split("export async function POST", 1)[0]).not.toContain("issueOrReuseInitialInvite");
  });

  test("turns a legitimate stale claimed invite URL into the appropriate active Pair entry before controls mount", async () => {
    const invitePage = await source("pair/[pairId]/invite/page.tsx");

    expect(invitePage).toContain('if (pairView.members.length === 2) redirect(issueOnEntry ? `/pair/${pairId}/private` : `/pair/${pairId}`);');
    expect(invitePage).toContain('return <InviteControls autoGenerate={issueOnEntry} kind="initial" pairId={pairId} />;');
    expect(invitePage).not.toContain("issueOrReuseInitialInvite");
    expect(invitePage).not.toContain("startOrResumePrivateConversation");
  });

  test("uses the minimal Pair-status projection to transition Pair Home and stops that polling after claim", async () => {
    const pairHome = await source("../components/pair-home.tsx");
    const statusRoute = await source("api/pairs/[pairId]/status/route.ts");

    expect(pairHome).toContain('PAIR_HOME_CLAIM_STATUS_POLL_INTERVAL_MS = 4_000');
    expect(pairHome).toContain('enabled: !isCurrentlyComplete');
    expect(pairHome).toContain("forceOnForeground: true");
    expect(pairHome).toContain('`/api/pairs/${encodeURIComponent(pairId)}/status`');
    expect(pairHome).toContain("setClaimedParticipantDisplayName(status.otherParticipantDisplayName)");
    const claimPoll = pairHome.slice(pairHome.indexOf("enabled: !isCurrentlyComplete"), pairHome.indexOf("enabled: hasWaitingConversation"));
    expect(claimPoll).not.toContain("private-conversations");
    expect(statusRoute).toContain("getPairStatusForParticipant");
    expect(statusRoute).not.toContain("listActivePrivateConversations");
    expect(statusRoute).not.toContain("listEligibleTogetherQuestions");
  });

  test("renders a cohesive initial-claim card and makes intended context a fresh-user prefill only", async () => {
    const joinPage = await source("join/[token]/page.tsx");
    const form = await source("../components/join-pair-form.tsx");
    const redeemRoute = await source("api/invites/[token]/redeem/route.ts");

    expect(joinPage).toContain("<JoinInvitationFrame>");
    expect(joinPage).toContain("<Suspense fallback={<JoinInvitationDetailsSkeleton />}>");
    expect(form).toContain("initialInvite?.intendedPersonName ?? \"\"");
    expect(form).toContain("claimantDisplayName ??");
    expect(form).toContain("readOnly={kind === \"initial\" && isExistingParticipant}");
    expect(form).not.toContain("Choose your name before joining");
    expect(form).not.toContain("<strong>For:</strong>");
    expect(redeemRoute).toContain("export async function POST");
    expect(redeemRoute).toContain("joinPairSchema.safeParse(body)");
    expect(redeemRoute).toContain("resolveOrCreateParticipant");
    expect(redeemRoute).toContain("redeemInitialInvite");
    expect(redeemRoute).toContain("if (!claimant)");
  });
});
