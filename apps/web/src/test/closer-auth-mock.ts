/**
 * Complete runtime replacement for @Closer/auth/closer in web tests.
 *
 * Bun's module mocks are process-wide. Every test that replaces this module
 * must therefore retain its public runtime surface, even when that test only
 * exercises one route. Defaults deliberately fail if an unconfigured domain
 * call is reached, keeping tests explicit rather than silently permissive.
 */
type CloserAuthMock = Record<string, unknown>;

function unexpectedCloserAuthCall(name: string) {
  return async () => {
    throw new Error(`Unexpected @Closer/auth/closer call: ${name}`);
  };
}

class TestCloserDomainError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "CloserDomainError";
  }
}

export function createCloserAuthMock(overrides: CloserAuthMock = {}): CloserAuthMock {
  return {
    db: {},
    getRealtimeBus: unexpectedCloserAuthCall("getRealtimeBus"),
    publishRealtimeEvent: unexpectedCloserAuthCall("publishRealtimeEvent"),
    CloserDomainError: TestCloserDomainError,
    declinePrivateRound: unexpectedCloserAuthCall("declinePrivateRound"),
    advanceTogetherSession: unexpectedCloserAuthCall("advanceTogetherSession"),
    askPrivateQuestionCandidate: unexpectedCloserAuthCall("askPrivateQuestionCandidate"),
    createPairForParticipant: unexpectedCloserAuthCall("createPairForParticipant"),
    getPairEntryForParticipant: unexpectedCloserAuthCall("getPairEntryForParticipant"),
    getPairForParticipant: unexpectedCloserAuthCall("getPairForParticipant"),
    getPairStatusForParticipant: unexpectedCloserAuthCall("getPairStatusForParticipant"),
    getInitialInviteStatus: unexpectedCloserAuthCall("getInitialInviteStatus"),
    getInitialInviteLanding: unexpectedCloserAuthCall("getInitialInviteLanding"),
    isInitialInviteUsable: unexpectedCloserAuthCall("isInitialInviteUsable"),
    getRejoinInviteLanding: unexpectedCloserAuthCall("getRejoinInviteLanding"),
    getParticipantByAuthUserId: unexpectedCloserAuthCall("getParticipantByAuthUserId"),
    getPrivateRoundForParticipant: unexpectedCloserAuthCall("getPrivateRoundForParticipant"),
    getFormerEraHistoryForParticipant: unexpectedCloserAuthCall(
      "getFormerEraHistoryForParticipant",
    ),
    getPrivateConversationForParticipant: unexpectedCloserAuthCall(
      "getPrivateConversationForParticipant",
    ),
    getPrivateRoundStatusForParticipant: unexpectedCloserAuthCall(
      "getPrivateRoundStatusForParticipant",
    ),
    getTogetherQuestionPageForParticipant: unexpectedCloserAuthCall(
      "getTogetherQuestionPageForParticipant",
    ),
    getTogetherSessionForParticipant: unexpectedCloserAuthCall("getTogetherSessionForParticipant"),
    getTogetherSessionPlaybackForParticipant: unexpectedCloserAuthCall(
      "getTogetherSessionPlaybackForParticipant",
    ),
    issueOrReuseInitialInvite: unexpectedCloserAuthCall("issueOrReuseInitialInvite"),
    issueRejoinInvite: unexpectedCloserAuthCall("issueRejoinInvite"),
    updateIntendedPersonName: unexpectedCloserAuthCall("updateIntendedPersonName"),
    listActivePrivateConversations: unexpectedCloserAuthCall("listActivePrivateConversations"),
    listActivePairsForParticipant: unexpectedCloserAuthCall("listActivePairsForParticipant"),
    listEligiblePrivateQuestions: unexpectedCloserAuthCall("listEligiblePrivateQuestions"),
    listEligibleTogetherQuestions: unexpectedCloserAuthCall("listEligibleTogetherQuestions"),
    markPrivateRevealViewed: unexpectedCloserAuthCall("markPrivateRevealViewed"),
    redeemInitialInvite: unexpectedCloserAuthCall("redeemInitialInvite"),
    redeemRejoinInvite: unexpectedCloserAuthCall("redeemRejoinInvite"),
    removePrivateReaction: unexpectedCloserAuthCall("removePrivateReaction"),
    removePrivateReply: unexpectedCloserAuthCall("removePrivateReply"),
    resolveOrCreateParticipant: unexpectedCloserAuthCall("resolveOrCreateParticipant"),
    revokeInitialInvites: unexpectedCloserAuthCall("revokeInitialInvites"),
    replaceInitialInvite: unexpectedCloserAuthCall("replaceInitialInvite"),
    revokeRejoinInvites: unexpectedCloserAuthCall("revokeRejoinInvites"),
    setPrivateReaction: unexpectedCloserAuthCall("setPrivateReaction"),
    setPrivateQuestionCandidateLike: unexpectedCloserAuthCall("setPrivateQuestionCandidateLike"),
    setPrivateReply: unexpectedCloserAuthCall("setPrivateReply"),
    skipPrivateQuestionCandidate: unexpectedCloserAuthCall("skipPrivateQuestionCandidate"),
    setTogetherSessionLike: unexpectedCloserAuthCall("setTogetherSessionLike"),
    terminatePair: unexpectedCloserAuthCall("terminatePair"),
    startOrResumePrivateConversation: unexpectedCloserAuthCall("startOrResumePrivateConversation"),
    startTogetherSession: unexpectedCloserAuthCall("startTogetherSession"),
    endTogetherSession: unexpectedCloserAuthCall("endTogetherSession"),
    submitPrivateAnswer: unexpectedCloserAuthCall("submitPrivateAnswer"),
    ...overrides,
  };
}
