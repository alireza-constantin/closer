import type { ParityAction, ParityScenario } from "./model";

const action = (
  id: string,
  actor: string,
  operation: string,
  concurrentGroup?: string,
): ParityAction => ({ id, actor, operation, ...(concurrentGroup ? { concurrentGroup } : {}) });

const cases = [
  {
    id: "auth.explicit-anonymous-session",
    area: "auth",
    gate: "must-pass-before-cutover",
    title: "Anonymous identity is created only by the explicit start command",
    preconditions: ["The browser has no session and has not completed onboarding."],
    actions: [
      action("create", "browser-a", "POST /api/v1/auth/anonymous"),
      action("me", "browser-a", "GET /api/v1/me"),
    ],
    expected: {
      actions: [{ id: "create" }, { id: "me", status: 200 }],
      persistedState: { authUsersCreated: 1, sessionsCreated: 1, participantsCreated: 0 },
      projections: [{ actor: "browser-a", mustContain: { authenticated: true, onboarded: false } }],
    },
    sources: [
      "docs/rewrite/API-CONTRACTS.md — Frozen custom-auth parity",
      "docs/rewrite/PARITY-CHECKLIST.md — section 10",
      "apps/web/src/app/page.test.tsx — session without a Participant goes to onboarding",
    ],
  },
  {
    id: "auth.reads-do-not-create-identity",
    area: "auth",
    gate: "must-pass-before-cutover",
    title: "Root and public invitation reads do not create auth or Participant rows",
    preconditions: [
      "The browser has no session.",
      "A valid invite and rejoin token exist in the fixture.",
    ],
    actions: [
      action("root", "browser-a", "GET /"),
      action("me", "browser-a", "GET /api/v1/me"),
      action("invite", "browser-a", "GET /api/v1/invites/:token"),
      action("rejoin", "browser-a", "GET /api/v1/rejoin/:token"),
    ],
    expected: {
      actions: [{ id: "root" }, { id: "me" }, { id: "invite" }, { id: "rejoin" }],
      persistedState: { authUsersCreated: 0, sessionsCreated: 0, participantsCreated: 0 },
      projections: [
        { actor: "browser-a", mustOmit: ["participantId", "authUserId", "sessionToken"] },
      ],
    },
    sources: [
      "docs/rewrite/GO-VITE-ARCHITECTURE.md — 0.3 Auth model and lifecycle",
      "docs/rewrite/API-CONTRACTS.md — Frozen custom-auth parity",
      "apps/web/src/app/prefetch-safety.test.ts — credential previews and redemption are read-only",
      "apps/web/src/app/connect-and-join-performance.test.ts — invite lookup is inert",
    ],
  },
  {
    id: "auth.onboarding-idempotent",
    area: "auth",
    gate: "must-pass-before-cutover",
    title: "Explicit onboarding creates one stable Participant",
    preconditions: ["One authenticated auth user has no Participant."],
    actions: [
      action("first", "browser-a", "POST /api/v1/onboarding"),
      action("retry", "browser-a", "POST /api/v1/onboarding"),
    ],
    expected: {
      actions: [{ id: "first" }, { id: "retry" }],
      persistedState: { participantsForAuthUser: 1 },
      projections: [{ actor: "browser-a", mustContain: { participantId: "$participant-a" } }],
    },
    sources: [
      "docs/rewrite/API-CONTRACTS.md — Participant, Pair, invite, rejoin, termination",
      "packages/db/src/closer.integration.test.ts — onboarding validates names, permits duplicates, and leaves the participant without a space",
      "apps/web/src/app/api/onboarding/route.test.ts — resolves identity-safe idempotency through the domain layer",
    ],
    normalize: { requestIds: ["/actions/0/result/requestId", "/actions/1/result/requestId"] },
  },
  {
    id: "auth.direct-registration-does-not-onboard",
    area: "auth",
    gate: "must-pass-before-cutover",
    title: "Direct registration creates an account and session without a Participant",
    preconditions: ["Email is unused and browser has no prior anonymous session."],
    actions: [
      action("register", "browser-a", "POST /api/v1/auth/register"),
      action("me", "browser-a", "GET /api/v1/me"),
    ],
    expected: {
      actions: [{ id: "register" }, { id: "me", status: 200 }],
      persistedState: { authUsersCreated: 1, sessionsCreated: 1, participantsCreated: 0 },
      projections: [{ actor: "browser-a", mustContain: { authenticated: true, onboarded: false } }],
    },
    sources: [
      "docs/rewrite/GO-VITE-ARCHITECTURE.md — direct consumer registration",
      "docs/rewrite/PARITY-CHECKLIST.md — section 10",
    ],
  },
  {
    id: "auth.upgrade-preserves-ownership",
    area: "auth",
    gate: "must-pass-before-cutover",
    title: "Guest credential upgrade preserves the same Participant and owned history",
    preconditions: [
      "An anonymous auth user already owns a Participant, memberships, and Pair history.",
    ],
    actions: [action("upgrade", "browser-a", "POST /api/v1/auth/upgrade")],
    expected: {
      actions: [{ id: "upgrade" }],
      persistedState: {
        participantId: "$participant-a",
        membershipCountUnchanged: true,
        historyCountUnchanged: true,
      },
      projections: [{ actor: "browser-a", mustContain: { participantId: "$participant-a" } }],
    },
    sources: [
      "docs/adr/001-domain-participant-identity.md — stable Participant identity",
      "docs/rewrite/GO-VITE-ARCHITECTURE.md — 0.3 Auth model and lifecycle",
      "docs/rewrite/PARITY-CHECKLIST.md — section 10",
    ],
  },
  {
    id: "auth.existing-account-does-not-merge-anonymous-data",
    area: "auth",
    gate: "must-pass-before-cutover",
    title: "Logging into an existing account in another guest browser does not merge identities",
    preconditions: [
      "Browser A has anonymous Participant A and a valid session.",
      "Account B already owns Participant B and separate Pair history.",
    ],
    actions: [
      action("login", "browser-a", "POST /api/v1/auth/login as account-b"),
      action("read-account-b", "browser-a", "GET /api/v1/me"),
      action("read-browser-b", "browser-b", "GET /api/v1/me"),
    ],
    expected: {
      actions: [{ id: "login" }, { id: "read-account-b" }, { id: "read-browser-b" }],
      persistedState: {
        participantCount: 2,
        participantAHistoryOwnedBy: "$participant-a",
        participantBHistoryOwnedBy: "$participant-b",
      },
      projections: [
        { actor: "browser-a", mustContain: { participantId: "$participant-b" } },
        { actor: "browser-b", mustContain: { participantId: "$participant-b" } },
      ],
    },
    sources: [
      "docs/rewrite/GO-VITE-ARCHITECTURE.md — 0.3 Auth model and lifecycle",
      "docs/rewrite/PARITY-CHECKLIST.md — section 10",
      "docs/adr/001-domain-participant-identity.md — domain ownership is distinct from auth identity",
    ],
  },
  {
    id: "auth.logout-session-separation",
    area: "auth",
    gate: "must-pass-before-cutover",
    title: "Logout revokes the current session without logging out a separate device",
    preconditions: ["Two browsers have independent sessions for one auth user."],
    actions: [
      action("logout-a", "browser-a", "POST /api/v1/auth/logout"),
      action("check-a", "browser-a", "GET /api/v1/me"),
      action("check-b", "browser-b", "GET /api/v1/me"),
    ],
    expected: {
      actions: [{ id: "logout-a" }, { id: "check-a", status: 401 }, { id: "check-b", status: 200 }],
      persistedState: { browserASessionRevoked: true, browserBSessionRevoked: false },
    },
    sources: [
      "docs/rewrite/GO-VITE-ARCHITECTURE.md — session lifecycle",
      "docs/rewrite/PARITY-CHECKLIST.md — section 10",
    ],
  },
  {
    id: "auth.admin-is-not-participant",
    area: "auth",
    gate: "must-pass-before-cutover",
    title: "Admin authorization is independent of consumer onboarding",
    preconditions: ["A dedicated Admin session exists and has no Participant."],
    actions: [
      action("read-admin", "admin", "GET /api/v1/admin/overview"),
      action("read-consumer", "admin", "GET /api/v1/me"),
    ],
    expected: {
      actions: [
        { id: "read-admin", status: 200 },
        { id: "read-consumer", status: 200 },
      ],
      persistedState: { participantsCreated: 0 },
      projections: [{ actor: "admin", mustOmit: ["participantId", "pairId"] }],
    },
    sources: [
      "docs/admin/ADMIN-SPEC.md — Admin identity and access",
      "docs/rewrite/GO-VITE-ARCHITECTURE.md — Admin auth model",
      "packages/auth/src/admin-auth.integration.test.ts — Admin authorization requires a session and an exact configured user ID",
    ],
  },
  {
    id: "pair.create-two-slots-no-invite",
    area: "pair-invite-era",
    gate: "must-pass-before-cutover",
    title: "Pair creation occupies slot one and does not issue an invitation",
    preconditions: ["Participant A is onboarded."],
    actions: [
      action("create", "participant-a", "POST /api/v1/pairs with intended name and relationship"),
    ],
    expected: {
      actions: [{ id: "create", status: 200 }],
      persistedState: {
        occupiedSlots: 1,
        slot2Participant: null,
        usableInitialInvites: 0,
        eraCount: 0,
      },
      projections: [
        { actor: "participant-a", mustContain: { pairId: "$pair", intendedPersonName: "Rae" } },
      ],
    },
    sources: [
      "docs/adr/002-invite-and-rejoin-security.md — Pair creation and initial invitation issuance",
      "packages/db/src/closer.integration.test.ts — creates partner and friend pairs with their creator in the first logical slot",
      "packages/db/src/closer.integration.test.ts — requires and preserves a pair-local intended name without issuing an invitation",
    ],
  },
  {
    id: "pair.create-retry-converges",
    area: "pair-invite-era",
    gate: "must-pass-before-cutover",
    title: "Pair creation request retry returns one Pair",
    preconditions: ["Participant A sends the same creationRequestId twice."],
    actions: [
      action("first", "participant-a", "POST /api/v1/pairs with clientRequestId"),
      action("retry", "participant-a", "POST /api/v1/pairs with same clientRequestId"),
    ],
    expected: {
      actions: [{ id: "first" }, { id: "retry" }],
      persistedState: { pairCount: 1 },
      projections: [
        { actor: "participant-a", mustContain: { pairId: "$pair" } },
        { actor: "participant-a", mustContain: { pairId: "$pair" } },
      ],
    },
    sources: [
      "packages/db/src/closer.integration.test.ts — retries the same pair-creation request without creating a duplicate pair",
    ],
  },
  {
    id: "pair.invite-read-does-not-consume",
    area: "pair-invite-era",
    gate: "must-pass-before-cutover",
    title: "Opening invite landing is read-only; issuance is explicit",
    preconditions: ["Pair slot two is empty and no invite has been issued."],
    actions: [
      action("landing", "browser-a", "GET /api/v1/invites/:token"),
      action("status", "participant-a", "GET /api/v1/pairs/:pairId/invite"),
    ],
    expected: {
      actions: [{ id: "landing" }, { id: "status" }],
      persistedState: { usableInvitesBefore: 0, usableInvitesAfter: 0, redeemedAt: null },
    },
    sources: [
      "docs/adr/002-invite-and-rejoin-security.md — initial invitation issuance and claim",
      "packages/db/src/closer.integration.test.ts — issues only on explicit connection, reuses it safely, and stores only its hash",
      "apps/web/src/app/prefetch-safety.test.ts — credential previews and redemption are read-only",
    ],
  },
  {
    id: "pair.invite-raw-token-browser-boundary",
    area: "pair-invite-era",
    gate: "must-pass-before-cutover",
    title: "Only the issuing browser can redisplay the raw initial invite URL",
    preconditions: ["One valid invite is held in the issuer browser's local credential cookie."],
    actions: [
      action("issuer", "browser-a", "GET /api/v1/pairs/:pairId/invite"),
      action("other-device", "browser-b", "GET /api/v1/pairs/:pairId/invite"),
    ],
    expected: {
      actions: [{ id: "issuer" }, { id: "other-device" }],
      persistedState: { rawTokenStoredInDatabase: false, usableInvites: 1 },
      projections: [
        { actor: "browser-a", mustContain: { state: "local", token: "$token" } },
        { actor: "browser-b", mustContain: { state: "active" }, mustOmit: ["token", "url"] },
      ],
    },
    sources: [
      "docs/adr/002-invite-and-rejoin-security.md — initial invitation issuance and storage",
      "packages/db/src/closer.integration.test.ts — projects active invitation expiry without exposing a raw credential to another device",
      "apps/web/src/app/api/pairs/[pairId]/invite/route.test.ts — second browser sees active expiry without rotation",
    ],
    normalize: { generatedTokens: ["/projections/0/body/token"] },
  },
  {
    id: "pair.claim-self-rejection-does-not-consume",
    area: "pair-invite-era",
    gate: "must-pass-before-cutover",
    title: "Slot-one Participant cannot claim their own invitation",
    preconditions: ["Pair is active, slot two is empty, and the initial invite is valid."],
    actions: [action("claim", "participant-a", "POST /api/v1/invites/:token/redeem")],
    expected: {
      actions: [{ id: "claim", status: 404, errorCode: "INVITE_INVALID" }],
      persistedState: { occupiedSlots: 1, invitationRedeemed: false },
    },
    sources: [
      "packages/db/src/closer.integration.test.ts — does not let the creator redeem their own invite, while preserving it for a second participant",
    ],
  },
  {
    id: "pair.occupied-and-duplicate-claimed-pair",
    area: "pair-invite-era",
    gate: "must-pass-before-cutover",
    title: "Occupied slots and an already-shared active Pair reject a second claim safely",
    preconditions: [
      "First run with slot two already occupied.",
      "Then run with an unclaimed Pair whose claimants already share another active Pair.",
    ],
    actions: [action("claim", "participant-b", "POST initial invite redemption")],
    expected: {
      actions: [{ id: "claim", status: 409 }],
      persistedState: { invitationConsumedOnRejection: false, membershipCountsUnchanged: true },
    },
    sources: [
      "docs/adr/002-invite-and-rejoin-security.md — initial claim rejection conditions",
      "packages/db/src/closer.integration.test.ts — rejects duplicate active Pair without consuming the invitation",
      "packages/db/src/closer.integration.test.ts — does not redeem an initial invitation twice",
    ],
  },
  {
    id: "pair.claim-race-one-slot-occupant",
    area: "pair-invite-era",
    gate: "must-pass-before-cutover",
    title: "Concurrent valid claims serialize to one slot-two membership",
    preconditions: [
      "Two distinct Participants race to redeem the same still-valid initial invite.",
    ],
    actions: [
      action("claim-a", "participant-b", "redeem initial invite", "claim"),
      action("claim-c", "participant-c", "redeem initial invite", "claim"),
    ],
    expected: {
      actions: [{ id: "claim-a" }, { id: "claim-c" }],
      actionGroups: [
        {
          ids: ["claim-a", "claim-c"],
          exactlyOneStatusIn: [200],
          remainingStatusIn: [404, 409],
        },
      ],
      persistedState: { occupiedSlots: 2, activeSlot2Memberships: 1, activeEras: 1 },
    },
    sources: [
      "docs/adr/002-invite-and-rejoin-security.md — initial claim",
      "packages/db/src/closer.integration.test.ts — serializes concurrent redemption so one slot has one active occupant",
    ],
  },
  {
    id: "pair.claim-vs-termination",
    area: "pair-invite-era",
    gate: "must-pass-before-cutover",
    title: "Initial claim and termination follow Pair-lock commit order",
    preconditions: [
      "The invite is valid and slot two is empty.",
      "Run once with claim ordered first and once with termination ordered first.",
    ],
    actions: [
      action("claim", "participant-b", "redeem initial invite", "claim-terminate"),
      action("terminate", "participant-a", "terminate Pair", "claim-terminate"),
    ],
    expected: {
      actions: [{ id: "claim" }, { id: "terminate" }],
      persistedState: { pairTerminalOrClaimedConsistently: true, noMembershipAfterTerminal: true },
    },
    sources: [
      "docs/adr/002-invite-and-rejoin-security.md — initial claim",
      "docs/adr/005-pair-membership-era-termination-and-history.md — transaction ordering",
      "packages/db/src/pair-termination.integration.test.ts — termination serializes initial claim in both commit orders",
    ],
  },
  {
    id: "pair.claim-vs-invite-revoke",
    area: "pair-invite-era",
    gate: "must-pass-before-cutover",
    title: "Claim and explicit invite revocation commit in one terminal order",
    preconditions: ["An initial invite is usable and the Pair is unclaimed."],
    actions: [
      action("claim", "participant-b", "redeem initial invite", "claim-revoke"),
      action("revoke", "participant-a", "DELETE /api/v1/pairs/:pairId/invite", "claim-revoke"),
    ],
    expected: {
      actions: [{ id: "claim" }, { id: "revoke" }],
      persistedState: {
        inviteRedeemedXorRevoked: true,
        claimHasBothMembershipsAndEra: true,
        rejectedClaimLeavesPairUnclaimed: true,
      },
    },
    sources: [
      "docs/adr/002-invite-and-rejoin-security.md — invite revocation and atomic claim",
      "docs/adr/005-pair-membership-era-termination-and-history.md — Pair lifecycle lock boundary",
    ],
  },
  {
    id: "pair.expiry-is-rechecked-at-claim",
    area: "pair-invite-era",
    gate: "must-pass-before-cutover",
    title: "A stale valid preview cannot authorize Join after the seven-day expiry",
    preconditions: [
      "Preview succeeds immediately before expiry, then time reaches the expiry boundary before Join.",
    ],
    actions: [
      action("preview", "browser-b", "GET /api/v1/invites/:token"),
      action("join", "participant-b", "POST /api/v1/invites/:token/redeem"),
    ],
    expected: {
      actions: [
        { id: "preview", status: 200 },
        { id: "join", status: 409, errorCode: "INVITE_INVALID" },
      ],
      persistedState: { occupiedSlots: 1, membershipEraCount: 0, invitationRedeemed: false },
    },
    sources: [
      "docs/adr/002-invite-and-rejoin-security.md — seven-day expiry and explicit claim",
      "docs/adr/005-pair-membership-era-termination-and-history.md — transactional lifecycle boundary",
    ],
  },
  {
    id: "pair.replacement-era-history",
    area: "pair-invite-era",
    gate: "must-pass-before-cutover",
    title: "Guest replacement closes the old era and does not transfer its history",
    preconditions: [
      "Pair has two members, one is an eligible guest, and the old era has Together and Private activity.",
    ],
    actions: [
      action(
        "replace",
        "participant-a",
        "run authorized guest replacement for participant-b's slot",
      ),
    ],
    expected: {
      actions: [{ id: "replace" }],
      persistedState: {
        activeEras: 1,
        oldEraClosed: true,
        oldMembershipNameFrozen: true,
        unresolvedCandidateInvalidated: true,
        togetherSessionEnded: true,
      },
      projections: [
        {
          actor: "replacement",
          mustOmit: ["oldPrivateRounds", "oldTogetherHistory", "oldCandidate"],
        },
        { actor: "continuing-member", mustContain: { formerMemberDisplayName: "$frozen-name" } },
      ],
      realtime: [{ type: "pair.changed", pair: "$pair", afterCommit: true }],
    },
    sources: [
      "docs/adr/002-invite-and-rejoin-security.md — guest rejoin and replacement",
      "docs/adr/005-pair-membership-era-termination-and-history.md — era boundaries",
      "packages/db/src/rejoin-replacement.integration.test.ts — guest replacement atomically closes the old exact era and isolates its activity",
      "packages/db/src/rejoin-replacement.integration.test.ts — former-era history is participant-relative, revision-pinned, and immutable",
    ],
  },
  {
    id: "pair.rejoin-preserves-identity",
    area: "pair-invite-era",
    gate: "must-pass-before-cutover",
    title: "Guest rejoin recovers access without creating a new domain identity or era",
    preconditions: [
      "Pair has two members in one current era; the target is an anonymous guest whose session has been lost.",
    ],
    actions: [
      action("issue", "continuing-member", "issue a fresh rejoin credential"),
      action(
        "redeem",
        "fresh-anonymous-auth",
        "redeem the rejoin credential for the lost guest slot",
      ),
    ],
    expected: {
      actions: [
        { id: "issue", status: 201 },
        { id: "redeem", status: 200 },
      ],
      persistedState: {
        participantIdUnchanged: true,
        membershipIdUnchanged: true,
        logicalSlotUnchanged: true,
        membershipEraIdUnchanged: true,
        pairIdUnchanged: true,
        participantCountUnchanged: true,
        membershipCountUnchanged: true,
        eraCountUnchanged: true,
        oldAuthSessionsRevoked: true,
      },
      projections: [{ actor: "fresh-anonymous-auth", mustResolveParticipant: "$existing-target" }],
    },
    sources: [
      "apps/api/internal/httpapi/rejoin_integration_test.go — rejoin rebinds existing Participant and preserves membership/era",
      "docs/rewrite/PARITY-CHECKLIST.md — rejoin identity and membership preservation gate",
    ],
  },
  {
    id: "pair.claim-creates-first-era",
    area: "pair-invite-era",
    gate: "must-pass-before-cutover",
    title: "Explicit Join creates slot two and the first membership era atomically",
    preconditions: ["Pair slot two is empty and the invite is valid, unrevoked, and unexpired."],
    actions: [action("join", "participant-b", "POST initial invite redemption")],
    expected: {
      actions: [{ id: "join" }],
      persistedState: {
        occupiedSlots: 2,
        activeEras: 1,
        invitationRedeemed: true,
        intendedPersonName: null,
        preclaimTogetherEnded: true,
      },
      projections: [{ actor: "participant-b", mustOmit: ["preclaimTogetherHistory"] }],
      realtime: [{ type: "pair.changed", pair: "$pair", afterCommit: true }],
    },
    sources: [
      "docs/adr/002-invite-and-rejoin-security.md — initial claim",
      "packages/db/src/closer.integration.test.ts — redeems an opaque initial invite into the empty second slot",
      "packages/db/src/together.integration.test.ts — initial claim closes the pre-claim session",
    ],
  },
  {
    id: "pair.claim-race-unordered-duplicate-active-pair",
    area: "pair-invite-era",
    gate: "must-pass-before-cutover",
    title: "Concurrent claims cannot create the same active participant pair in reverse slot order",
    preconditions: [
      "Participant A owns unclaimed Pair X and Participant B owns unclaimed Pair Y.",
      "Both invite claims begin concurrently, with A claiming Y and B claiming X.",
    ],
    actions: [
      action("claim-y", "participant-a", "redeem Pair Y invite", "unordered-duplicate-claim"),
      action("claim-x", "participant-b", "redeem Pair X invite", "unordered-duplicate-claim"),
    ],
    expected: {
      actions: [{ id: "claim-y" }, { id: "claim-x" }],
      actionGroups: [
        {
          ids: ["claim-y", "claim-x"],
          exactlyOneStatusIn: [200],
          remainingStatusIn: [409],
        },
      ],
      persistedState: {
        activeFullyClaimedPairsForParticipantsAAndB: 1,
        rejectedClaimInvitationRemainsUsable: true,
        noPartialMembershipEra: true,
      },
    },
    sources: [
      "docs/adr/002-invite-and-rejoin-security.md — unordered active fully claimed Pair uniqueness",
      "docs/rewrite/PARITY-CHECKLIST.md — section 11 claim lock and race matrix",
    ],
  },
  {
    id: "pair.replacement-vs-mutations",
    area: "pair-invite-era",
    gate: "must-pass-before-cutover",
    title: "Replacement serializes with Private, Together, and termination mutations",
    preconditions: [
      "Replacement and one Pair-scoped mutation begin against the same active era.",
      "Run both commit orders.",
    ],
    actions: [
      action("replace", "participant-a", "redeem guest rejoin", "replacement-race"),
      action("mutate", "participant-b", "submit active-era command", "replacement-race"),
    ],
    expected: {
      actions: [{ id: "replace" }, { id: "mutate" }],
      persistedState: {
        noPartialEra: true,
        mutationVisibleOnlyIfCommittedBeforeBoundary: true,
        replacementHasNoOldHistory: true,
      },
    },
    sources: [
      "docs/adr/005-pair-membership-era-termination-and-history.md — transaction ordering",
      "packages/db/src/rejoin-replacement.integration.test.ts — replacement serializes concurrent redemption and Pair-scoped Together and Private mutations",
      "packages/db/src/pair-termination.integration.test.ts — termination serializes guest replacement in both commit orders",
    ],
  },
  {
    id: "pair.termination-idempotent",
    area: "pair-invite-era",
    gate: "must-pass-before-cutover",
    title: "Termination is irreversible, idempotent, and preserves authorized former history",
    preconditions: ["A complete active Pair has committed Together and Private history."],
    actions: [
      action("first", "participant-a", "POST /api/v1/pairs/:pairId/terminate"),
      action("repeat", "participant-b", "POST /api/v1/pairs/:pairId/terminate"),
    ],
    expected: {
      actions: [{ id: "first" }, { id: "repeat" }],
      persistedState: {
        terminal: true,
        activeMemberships: 0,
        credentialsRevoked: true,
        historicalRowsPreserved: true,
      },
      realtime: [{ type: "pair.terminated", pair: "$pair", afterCommit: true }],
    },
    sources: [
      "docs/adr/005-pair-membership-era-termination-and-history.md — Pair termination",
      "packages/db/src/pair-termination.integration.test.ts — either claimed member can Unpair atomically and repeated termination is stable",
    ],
  },
  {
    id: "together.category-authorization",
    area: "together",
    gate: "must-pass-before-cutover",
    title: "Manually opened picker routes cannot bypass relationship category access",
    preconditions: ["A Partner Pair requests a Friendship-only category by URL."],
    actions: [action("start", "participant-a", "POST Together start for incompatible category")],
    expected: {
      actions: [{ id: "start", status: 400 }],
      persistedState: { sessionsCreated: 0 },
    },
    sources: [
      "packages/db/src/together.integration.test.ts — a Partner Pair cannot start Friendship from a manually opened Friend picker",
      "packages/db/src/together.integration.test.ts — a Friend Pair cannot start Relationship from a manually opened Partner picker",
    ],
  },
  {
    id: "together.preclaim-start-and-claim-boundary",
    area: "together",
    gate: "must-pass-before-cutover",
    title: "One member may use Together before claim; claim closes that pre-claim session",
    preconditions: ["Pair slot two is unclaimed and a compatible Question is eligible."],
    actions: [
      action("start", "participant-a", "POST Together start"),
      action("claim", "participant-b", "redeem initial invite"),
    ],
    expected: {
      actions: [{ id: "start", status: 201 }, { id: "claim" }],
      persistedState: { preclaimSessionEnded: true, claimantCanReadPreclaimTogether: false },
      projections: [{ actor: "participant-b", mustOmit: ["preclaimTogetherHistory"] }],
      realtime: [{ type: "together.changed", pair: "$pair", afterCommit: true }],
    },
    sources: [
      "docs/adr/002-invite-and-rejoin-security.md — successful initial claim",
      "packages/db/src/together.integration.test.ts — initial claim closes the pre-claim session, starts the first era, and does not grant its history to the claimant",
    ],
  },
  {
    id: "together.revision-pinning-and-no-repeat",
    area: "together",
    gate: "must-pass-before-cutover",
    title: "Shown Together cards pin exact revisions and consume logical Questions",
    preconditions: [
      "One Session has shown Question Q at revision 1; revision 2 is later published.",
    ],
    actions: [
      action("advance", "participant-a", "POST Together Next"),
      action("page", "participant-a", "GET Together selection page"),
    ],
    expected: {
      actions: [{ id: "advance" }, { id: "page" }],
      persistedState: { firstOccurrenceRevision: "$revision-1", questionQNotRepeated: true },
      projections: [
        { actor: "participant-a", mustContain: { shownQuestionRevisionId: "$revision-1" } },
      ],
    },
    sources: [
      "docs/adr/006-question-identity-revisions-and-selection.md — identity and revision pinning",
      "packages/db/src/together.integration.test.ts — later revision cannot repeat a consumed logical Question",
      "packages/db/src/question-revisions.integration.test.ts — Together shown-question records keep their exact revision",
    ],
  },
  {
    id: "together.ramp-fallback-actions",
    area: "together",
    gate: "must-pass-before-cutover",
    title: "Only Next advances the intensity ramp; Skip and Like do not",
    preconditions: ["A Session has one completed Next and mixed eligible intensity bands."],
    actions: [
      action("skip", "participant-a", "POST Together Skip"),
      action("like", "participant-a", "PUT Together Like"),
      action("next", "participant-a", "POST Together Next"),
    ],
    expected: {
      actions: [{ id: "skip" }, { id: "like" }, { id: "next" }],
      persistedState: {
        nextCount: 2,
        skipAdvancesRamp: false,
        likeAdvancesRamp: false,
        fallback: ["medium", "light", "deep"],
      },
    },
    sources: [
      "docs/adr/006-question-identity-revisions-and-selection.md — Together intensity ramp and fallback",
      "packages/db/src/together.integration.test.ts — Next alone drives the two-light, two-medium, then deep-preferred ramp",
      "packages/db/src/together.integration.test.ts — each intensity target uses its documented fallback order",
    ],
  },
  {
    id: "together.advance-race-idempotency",
    area: "together",
    gate: "must-pass-before-cutover",
    title: "Concurrent Next/Skip or duplicate request IDs create one transition",
    preconditions: [
      "Two clients act on the same current shown card with the same advance request ID.",
    ],
    actions: [
      action("next", "participant-a", "POST Together Next", "advance"),
      action("skip", "participant-b", "POST Together Skip", "advance"),
    ],
    expected: {
      actions: [{ id: "next" }, { id: "skip" }],
      persistedState: { transitionsForRequest: 1, currentCardAdvancedOnce: true },
      realtime: [{ type: "together.changed", pair: "$pair", afterCommit: true }],
    },
    sources: [
      "packages/db/src/together.integration.test.ts — retrying Next with the same request ID advances only once",
      "packages/db/src/together.integration.test.ts — concurrent Next and Skip for one shown card commit only one transition",
    ],
  },
  {
    id: "together.end-and-undecided-card",
    area: "together",
    gate: "must-pass-before-cutover",
    title: "End is idempotent and a manually ended undecided card stays outside decision analytics",
    preconditions: ["A shown card has not been advanced or skipped."],
    actions: [
      action("end", "participant-a", "POST Together End"),
      action("repeat", "participant-a", "POST Together End"),
      action("late-like", "participant-a", "PUT Together Like"),
    ],
    expected: {
      actions: [
        { id: "end" },
        { id: "repeat" },
        { id: "late-like", status: 409, errorCode: "TOGETHER_SESSION_ENDED" },
      ],
      persistedState: {
        ended: true,
        shownCount: 1,
        decidedCount: 0,
        advancedAt: null,
        skippedAt: null,
      },
    },
    sources: [
      "docs/adr/006-question-identity-revisions-and-selection.md — Together intensity ramp and bounded Session",
      "packages/db/src/together.integration.test.ts — End session persists endedAt and rejects later mutations while repeated end is safe",
      "docs/admin/ADMIN-ANALYTICS.md — Together Shown and Decisions definitions",
    ],
  },
  {
    id: "together.liked-undecided-card-analytics",
    area: "together",
    gate: "must-pass-before-cutover",
    title: "A manually ended, liked but undecided card counts as shown only",
    preconditions: ["A card is shown and liked, then the Session ends without Next or Skip."],
    actions: [
      action("end", "participant-a", "POST Together End"),
      action("metrics", "admin", "read Together metrics for the fixture"),
    ],
    expected: {
      actions: [{ id: "end" }, { id: "metrics" }],
      persistedState: {
        shown: 1,
        decisions: 0,
        likedDecidedOccurrences: 0,
        advancedAt: null,
        skippedAt: null,
      },
    },
    sources: [
      "docs/admin/ADMIN-ANALYTICS.md — Together Shown, Decisions, and Like Rate definitions",
      "docs/admin/ADMIN-SPEC.md — analytics does not infer decisions from Session end",
    ],
  },
  {
    id: "private.waiting-projection-confidentiality",
    area: "private",
    gate: "must-pass-before-cutover",
    title: "Non-creator waiting projection contains no unresolved candidate fields",
    preconditions: ["A complete Pair has an unresolved creator-owned candidate."],
    actions: [action("read", "non-creator", "GET active Private conversation projection")],
    expected: {
      actions: [{ id: "read", status: 200 }],
      persistedState: { candidateState: "unresolved", roundsCreated: 0 },
      projections: [
        {
          actor: "non-creator",
          state: "WAITING_FOR_CREATOR",
          mustOmit: [
            "candidate",
            "candidateId",
            "candidate.id",
            "questionId",
            "question.id",
            "questionRevisionId",
            "questionRevision.id",
            "text",
            "questionText",
            "intensity",
            "likedAt",
            "isLiked",
            "selectedAt",
            "selectionRank",
            "seed",
            "selectionMetadata",
          ],
        },
      ],
    },
    sources: [
      "docs/adr/003-private-answer-reveal.md — 2026-09-20 Creator-owned candidate-control amendment",
      "docs/rewrite/GO-VITE-ARCHITECTURE.md — 0.5 Private projection confidentiality",
      "packages/db/src/private.integration.test.ts — candidate actions are creator-only and candidate Like never appears in the non-creator projection",
    ],
  },
  {
    id: "private.start-race-stable-creator-candidate",
    area: "private",
    gate: "must-pass-before-cutover",
    title: "Concurrent category starts converge on one Conversation, creator, and candidate",
    preconditions: ["Both active members concurrently start the same Pair/era/category."],
    actions: [
      action("start-a", "participant-a", "POST Private conversation start", "start"),
      action("start-b", "participant-b", "POST Private conversation start", "start"),
    ],
    expected: {
      actions: [{ id: "start-a" }, { id: "start-b" }],
      persistedState: {
        conversationsForCategory: 1,
        candidatesForConversation: 1,
        immutableCreator: true,
      },
      projections: [
        { actor: "participant-a", mustContain: { conversationId: "$conversation" } },
        { actor: "participant-b", mustContain: { conversationId: "$conversation" } },
      ],
    },
    sources: [
      "docs/adr/003-private-answer-reveal.md — Conversation identity and creator",
      "packages/db/src/private.integration.test.ts — category start persists one creator-owned candidate and concurrent starters converge",
    ],
  },
  {
    id: "private.creator-only-ask-and-like",
    area: "private",
    gate: "must-pass-before-cutover",
    title: "Only creator can control an unresolved candidate; Ask pins the shown revision",
    preconditions: [
      "Candidate is unresolved and Question revision 1 is pinned; revision 2 may now be current.",
    ],
    actions: [
      action("outsider-ask", "non-creator", "POST Ask candidate"),
      action("creator-ask", "creator", "POST Ask candidate"),
    ],
    expected: {
      actions: [{ id: "outsider-ask", status: 404 }, { id: "creator-ask" }],
      persistedState: {
        candidateState: "asked",
        roundNumber: 1,
        roundRevisionId: "$revision-1",
        likeFrozen: true,
      },
      projections: [
        {
          actor: "non-creator",
          mustOmit: [
            "candidateId",
            "questionId",
            "questionRevisionId",
            "text",
            "intensity",
            "likedAt",
          ],
        },
      ],
      realtime: [{ type: "private.changed", pair: "$pair", afterCommit: true }],
    },
    sources: [
      "docs/admin/ADMIN-SPEC.md — PRIVATE-01",
      "docs/adr/003-private-answer-reveal.md — candidate actions and Round lifecycle",
      "packages/db/src/private.integration.test.ts — creator can Like and Ask one current candidate, pinning its previewed revision into Round 1",
      "packages/db/src/private.integration.test.ts — candidate actions are creator-only",
    ],
  },
  {
    id: "private.ask-vs-skip-race",
    area: "private",
    gate: "must-pass-before-cutover",
    title: "Ask and Skip race to one terminal candidate result",
    preconditions: ["Creator submits Ask and Skip concurrently for the same unresolved candidate."],
    actions: [
      action("ask", "creator", "POST Ask candidate", "ask-skip"),
      action("skip", "creator", "POST Skip candidate with UUID request", "ask-skip"),
    ],
    expected: {
      actions: [{ id: "ask" }, { id: "skip" }],
      actionGroups: [
        { ids: ["ask", "skip"], exactlyOneStatusIn: [200, 201], remainingStatusIn: [404, 409] },
      ],
      persistedState: {
        terminalCandidateOutcomes: 1,
        roundCreatedExactlyWhenAsked: true,
      },
    },
    sources: [
      "docs/adr/003-private-answer-reveal.md — Ask/Skip idempotency and mutual exclusion",
      "docs/admin/ADMIN-SPEC.md — PRIVATE-01 candidate invariants",
      "packages/db/src/private.integration.test.ts — Ask and Skip serialize on a candidate, retries create one Round, and resolved Likes freeze",
    ],
  },
  {
    id: "private.skip-retry-logical-consumption",
    area: "private",
    gate: "must-pass-before-cutover",
    title: "Duplicate Skip request replays its result and consumes one logical Question",
    preconditions: [
      "Creator's unresolved candidate pins logical Question Q; Skip request ID S is reused.",
    ],
    actions: [
      action("first", "creator", "POST Skip candidate with request S"),
      action("retry", "creator", "POST Skip candidate with request S"),
    ],
    expected: {
      actions: [{ id: "first" }, { id: "retry" }],
      persistedState: {
        skippedQuestionIds: ["$question-q"],
        skipRowsForRequest: 1,
        roundsCreated: 0,
        nextCandidateStable: true,
      },
      projections: [{ actor: "creator", mustContain: { candidateId: "$next-candidate" } }],
      realtime: [{ type: "private.changed", pair: "$pair", afterCommit: true }],
    },
    sources: [
      "docs/admin/ADMIN-SPEC.md — PRIVATE-01 Skip retry",
      "packages/db/src/private.integration.test.ts — Skip consumes its logical Question without creating a Round, preserves Like, and persists the next candidate",
      "packages/db/src/private.integration.test.ts — skipped logical Question stays consumed after revision",
    ],
  },
  {
    id: "private.like-before-ask-freezes",
    area: "private",
    gate: "must-pass-before-cutover",
    title: "A Like committed before Ask is preserved and frozen on the Asked candidate",
    preconditions: ["Like commits before Ask while the candidate is unresolved."],
    actions: [
      action("like", "creator", "PUT candidate Like true"),
      action("ask", "creator", "POST Ask candidate"),
    ],
    expected: {
      actions: [{ id: "like" }, { id: "ask" }],
      persistedState: { candidateState: "asked", likedAt: "$non-null", likeMutable: false },
    },
    sources: [
      "docs/admin/ADMIN-SPEC.md — PRIVATE-01 Like freeze",
      "packages/db/src/private.integration.test.ts — resolved Likes freeze",
    ],
  },
  {
    id: "private.ask-before-like-freezes",
    area: "private",
    gate: "must-pass-before-cutover",
    title: "A Like after Ask is rejected and cannot change the frozen candidate",
    preconditions: ["Ask commits before a concurrent candidate Like."],
    actions: [
      action("ask", "creator", "POST Ask candidate"),
      action("like", "creator", "PUT candidate Like true"),
    ],
    expected: {
      actions: [
        { id: "ask" },
        { id: "like", status: 409, errorCode: "CANDIDATE_ALREADY_RESOLVED" },
      ],
      persistedState: { candidateState: "asked", likeMutable: false },
    },
    sources: [
      "docs/admin/ADMIN-SPEC.md — PRIVATE-01 Like freeze",
      "docs/rewrite/API-CONTRACTS.md — stable conflict codes",
    ],
  },
  {
    id: "private.like-vs-skip-freezes",
    area: "private",
    gate: "must-pass-before-cutover",
    title: "Like/Skip commit order determines final Like; resolution freezes it",
    preconditions: ["Run once with Like first and once with Skip first."],
    actions: [
      action("like", "creator", "PUT candidate Like true", "like-skip"),
      action("skip", "creator", "POST Skip candidate", "like-skip"),
    ],
    expected: {
      actions: [{ id: "like" }, { id: "skip" }],
      persistedState: {
        candidateState: "skipped",
        logicalQuestionConsumed: true,
        likeFrozenAfterResolution: true,
      },
    },
    sources: [
      "docs/admin/ADMIN-SPEC.md — PRIVATE-01",
      "packages/db/src/private.integration.test.ts — withdrawal invalidates a liked candidate and freezes its final Like",
    ],
  },
  {
    id: "private.withdrawal-before-ask",
    area: "private",
    gate: "must-pass-before-cutover",
    title: "Withdrawal committed before Ask invalidates the unresolved candidate",
    preconditions: [
      "The current candidate pins a Question revision that Admin withdraws before Ask.",
    ],
    actions: [
      action("withdraw", "admin", "POST Question revision withdrawal"),
      action("ask", "creator", "POST Ask candidate"),
    ],
    expected: {
      actions: [{ id: "withdraw" }, { id: "ask", status: 400, errorCode: "QUESTION_UNAVAILABLE" }],
      persistedState: {
        candidateState: "invalidated",
        roundsCreated: 0,
        logicalQuestionConsumed: false,
      },
      realtime: [{ type: "private.changed", pair: "$pair", afterCommit: true }],
    },
    sources: [
      "docs/admin/ADMIN-SPEC.md — withdrawal invalidates unresolved candidates",
      "packages/db/src/private.integration.test.ts — candidate pins its revision and withdrawal invalidates it without consuming the question",
      "packages/db/src/question-revisions.integration.test.ts — withdrawal removes content from new occurrence selection",
    ],
  },
  {
    id: "private.ask-before-withdrawal",
    area: "private",
    gate: "must-pass-before-cutover",
    title: "Ask committed before withdrawal preserves the already-Asked Round",
    preconditions: ["Ask commits before Admin withdraws the pinned Question revision."],
    actions: [
      action("ask", "creator", "POST Ask candidate"),
      action("withdraw", "admin", "POST Question revision withdrawal"),
    ],
    expected: {
      actions: [{ id: "ask" }, { id: "withdraw" }],
      persistedState: { candidateState: "asked", roundCount: 1, roundRevisionPinned: true },
    },
    sources: [
      "docs/admin/ADMIN-SPEC.md — already-Asked content keeps existing visibility rules",
      "docs/adr/006-question-identity-revisions-and-selection.md — emergency withdrawal scope",
    ],
  },
  {
    id: "private.answer-visibility-and-immutability",
    area: "private",
    gate: "must-pass-before-cutover",
    title: "Answers are immutable and each viewer sees only their own before both answers exist",
    preconditions: ["An Asked Round has one answer by Participant A."],
    actions: [
      action("read-b", "participant-b", "GET Private Round projection"),
      action("answer-b", "participant-b", "POST Private answer"),
    ],
    expected: {
      actions: [{ id: "read-b" }, { id: "answer-b" }],
      persistedState: { answersPerParticipant: 1, roundRevealReady: true },
      projections: [
        {
          actor: "participant-a",
          mustContain: { ownAnswer: "$answer-a" },
          mustOmit: ["otherAnswer", "answers.participant-b", "reactions", "replies"],
        },
        {
          actor: "participant-b",
          mustContain: { ownAnswer: "$answer-b" },
          mustOmit: ["otherAnswer", "answers.participant-a", "reactions", "replies"],
        },
      ],
    },
    sources: [
      "docs/adr/003-private-answer-reveal.md — Round, answer, and Decline lifecycle",
      "packages/db/src/private.integration.test.ts — pre-reveal projections contain only the viewer's answer",
      "packages/db/src/private.integration.test.ts — answers are trimmed, bounded, immutable, and deterministic for repeated concurrent submission",
    ],
  },
  {
    id: "private.two-answers-race",
    area: "private",
    gate: "must-pass-before-cutover",
    title: "Two members may submit their first answer concurrently exactly once each",
    preconditions: [
      "Asked Round has no answers; both current-era members submit distinct answers concurrently.",
    ],
    actions: [
      action("answer-a", "participant-a", "POST Private answer", "first-answers"),
      action("answer-b", "participant-b", "POST Private answer", "first-answers"),
    ],
    expected: {
      actions: [{ id: "answer-a" }, { id: "answer-b" }],
      persistedState: { answersPerParticipant: 1, answerCount: 2, roundRevealReady: true },
      projections: [
        {
          actor: "participant-a",
          mustContain: { ownAnswer: "$answer-a" },
          mustOmit: ["otherAnswer"],
        },
        {
          actor: "participant-b",
          mustContain: { ownAnswer: "$answer-b" },
          mustOmit: ["otherAnswer"],
        },
      ],
    },
    sources: [
      "docs/adr/003-private-answer-reveal.md — one immutable answer per Participant",
      "packages/db/src/private.integration.test.ts — only the second committed answer makes that Round reveal-ready",
    ],
  },
  {
    id: "private.answer-vs-decline-race",
    area: "private",
    gate: "must-pass-before-cutover",
    title: "One Participant's Answer and Decline race to the single terminal outcome",
    preconditions: [
      "Round has no answers; the same Participant submits Answer and Decline concurrently.",
    ],
    actions: [
      action("answer", "participant-a", "POST Private answer", "answer-decline"),
      action("decline", "participant-a", "POST Private Decline", "answer-decline"),
    ],
    expected: {
      actions: [{ id: "answer" }, { id: "decline" }],
      actionGroups: [
        {
          ids: ["answer", "decline"],
          exactlyOneStatusIn: [200, 201],
          remainingStatusIn: [404, 409],
        },
      ],
      persistedState: { terminalOutcomes: 1, declinedOrAnswered: true },
    },
    sources: [
      "docs/adr/003-private-answer-reveal.md — Decline and answer submission serialize",
      "packages/db/src/private.integration.test.ts — pass and answer serialize, repeated pass is idempotent, and declined Rounds reject later actions",
    ],
  },
  {
    id: "private.decline-eligibility",
    area: "private",
    gate: "must-pass-before-cutover",
    title: "Only a participant without their own answer may Decline before two answers exist",
    preconditions: ["Round has one answer from Participant A."],
    actions: [
      action("author-decline", "participant-a", "POST Private Decline"),
      action("unanswered-decline", "participant-b", "POST Private Decline"),
    ],
    expected: {
      actions: [{ id: "author-decline", status: 404 }, { id: "unanswered-decline" }],
      persistedState: { status: "declined", answerAVisibleToA: true, answerAVisibleToB: false },
    },
    sources: [
      "docs/adr/003-private-answer-reveal.md — Decline eligibility",
      "packages/db/src/private.integration.test.ts — passing is unavailable to an answerer or once two answers exist",
    ],
  },
  {
    id: "private.reveal-viewer-relative",
    area: "private",
    gate: "must-pass-before-cutover",
    title: "Each viewer must record their own Reveal View before seeing both answers",
    preconditions: ["Both participants have answered; neither has opened Reveal."],
    actions: [
      action("reveal-a", "participant-a", "POST Reveal"),
      action("read-b", "participant-b", "GET Private Round projection"),
    ],
    expected: {
      actions: [{ id: "reveal-a" }, { id: "read-b" }],
      persistedState: { revealViews: ["$participant-a"], roundStatus: "reveal-ready" },
      projections: [
        { actor: "participant-a", mustContain: { ownRevealView: true, otherAnswer: "$answer-b" } },
        {
          actor: "participant-b",
          mustContain: { ownRevealView: false },
          mustOmit: ["answers.participant-a", "reactions", "replies"],
        },
      ],
    },
    sources: [
      "docs/adr/003-private-answer-reveal.md — mutual reveal and progression",
      "packages/db/src/private.integration.test.ts — Reveal Views are independent and only both views permit creator candidate progression",
      "apps/web/src/features/private-conversation/components/private-interaction-performance.test.ts — uses authorized Reveal response and query recovery",
    ],
  },
  {
    id: "private.post-reveal-reaction-reply",
    area: "private",
    gate: "must-pass-before-cutover",
    title: "Reaction and reply writes require the viewer's Reveal View and remain viewer-owned",
    preconditions: ["Both answers exist; Participant A has revealed, Participant B has not."],
    actions: [
      action("reaction-before-reveal", "participant-b", "PUT Private reaction before own Reveal"),
      action("reply-before-reveal", "participant-b", "PUT Private reply before own Reveal"),
      action("reveal-b", "participant-b", "POST Reveal"),
      action("reaction", "participant-b", "PUT Private reaction after own Reveal"),
      action("reply", "participant-b", "PUT Private reply after own Reveal"),
    ],
    expected: {
      actions: [
        { id: "reaction-before-reveal", status: 404 },
        { id: "reply-before-reveal", status: 404 },
        { id: "reveal-b" },
        { id: "reaction" },
        { id: "reply" },
      ],
      persistedState: {
        revealViews: 2,
        reactionsOwnedBy: ["$participant-b"],
        repliesOwnedBy: ["$participant-b"],
      },
      projections: [
        {
          actor: "participant-a",
          mustContain: { otherAnswerReaction: "$reaction-b", otherAnswerReply: "$reply-b" },
        },
      ],
      realtime: [{ type: "private.changed", pair: "$pair", afterCommit: true }],
    },
    sources: [
      "docs/adr/003-private-answer-reveal.md — reactions and optional replies after a Reveal View",
      "packages/db/src/private.integration.test.ts — revealed participant owns one changeable reaction and one editable removable reply",
      "packages/db/src/private.integration.test.ts — reactions are shared post-reveal and deterministically belong on the other answer",
      "apps/web/src/features/private-conversation/components/private-interaction-performance.test.ts — authorized mutation responses reconcile reactions and replies",
    ],
  },
  {
    id: "private.progression-requires-both-reveals",
    area: "private",
    gate: "must-pass-before-cutover",
    title: "Creator cannot start the next candidate until both Reveal Views persist",
    preconditions: ["Both answers exist and only the creator has recorded Reveal."],
    actions: [
      action("continue-early", "creator", "start next candidate"),
      action("reveal-other", "non-creator", "POST Reveal"),
      action("continue", "creator", "start next candidate"),
    ],
    expected: {
      actions: [{ id: "continue-early" }, { id: "reveal-other" }, { id: "continue" }],
      persistedState: { revealViews: 2, nextCandidateCreatedAfterBothViews: true },
      projections: [
        {
          actor: "non-creator",
          state: "WAITING_FOR_CREATOR",
          mustOmit: ["candidateId", "questionId", "questionRevisionId", "text"],
        },
      ],
    },
    sources: [
      "docs/adr/003-private-answer-reveal.md — mutual reveal and progression",
      "packages/db/src/private.integration.test.ts — only both views permit creator candidate progression",
    ],
  },
  {
    id: "private.ramp-and-exhaustion",
    area: "private",
    gate: "must-pass-before-cutover",
    title: "Only mutually completed Rounds advance intensity; consumed Questions never cycle",
    preconditions: [
      "Conversation has one mutually completed Round, one skipped Question, and one asked-but-unrevealed Round.",
    ],
    actions: [
      action("select", "creator", "select next candidate"),
      action("skip-last", "creator", "skip last eligible candidate"),
      action("retry", "creator", "request another candidate"),
    ],
    expected: {
      actions: [{ id: "select" }, { id: "skip-last" }, { id: "retry" }],
      persistedState: {
        preferredIntensity: "light",
        skippedLogicalQuestionsRemainConsumed: true,
        exhaustionStable: true,
      },
      projections: [{ actor: "creator", state: "EXHAUSTED" }],
    },
    sources: [
      "docs/adr/006-question-identity-revisions-and-selection.md — Private intensity ramp and exhaustion",
      "packages/db/src/private.integration.test.ts — selection follows mutually completed Private Rounds",
      "packages/db/src/private.integration.test.ts — Skip exhausts rather than cycles and a skipped logical Question stays consumed after revision",
    ],
  },
  {
    id: "private.answer-vs-termination-history",
    area: "private",
    gate: "must-pass-before-cutover",
    title: "Termination commit order preserves only answers committed before the boundary",
    preconditions: [
      "One Asked Round has no answers; race Answer against Pair termination in both commit orders.",
    ],
    actions: [
      action("answer", "participant-a", "POST Private answer", "answer-terminate"),
      action("terminate", "participant-b", "POST Pair termination", "answer-terminate"),
    ],
    expected: {
      actions: [{ id: "answer" }, { id: "terminate" }],
      persistedState: {
        noPostTerminalMutation: true,
        formerHistoryFollowsCommittedAnswerState: true,
      },
      projections: [{ actor: "participant-a", mustOmit: ["otherAnswer"] }],
    },
    sources: [
      "docs/adr/005-pair-membership-era-termination-and-history.md — transaction ordering and former history",
      "packages/db/src/pair-termination.integration.test.ts — termination and answer serialization retain only the transaction that commits first",
      "packages/db/src/pair-termination.integration.test.ts — answer committed before/after termination history visibility",
    ],
  },
  {
    id: "private.replacement-history-boundary",
    area: "private",
    gate: "must-pass-before-cutover",
    title: "Replacement cannot read the former member's candidate or old Conversation",
    preconditions: [
      "A creator-owned unresolved candidate and prior Rounds exist in the ending era.",
    ],
    actions: [
      action("replace", "participant-a", "replace eligible guest membership"),
      action("read-old", "replacement", "GET old era Private history"),
    ],
    expected: {
      actions: [{ id: "replace" }, { id: "read-old", status: 404, errorCode: "NOT_FOUND" }],
      persistedState: { oldCandidateState: "invalidated", oldConversationReadOnly: true },
      projections: [
        {
          actor: "replacement",
          mustOmit: ["oldCandidate", "oldConversationContent", "oldAnswers"],
        },
      ],
    },
    sources: [
      "docs/adr/005-pair-membership-era-termination-and-history.md — former-era history",
      "packages/db/src/private.integration.test.ts — replacement starts a distinct era Conversation and cannot read the old candidate",
      "packages/db/src/rejoin-replacement.integration.test.ts — former-era history is participant-relative",
    ],
  },
  {
    id: "admin.inactive-create-and-activity-preserving-revision",
    area: "admin",
    gate: "must-pass-before-cutover",
    title: "Question creation starts inactive and later revisions preserve activity",
    preconditions: ["Admin creates Question Q, activates it, then adds a new immutable revision."],
    actions: [
      action("create", "admin", "POST create Question"),
      action("activate", "admin", "POST activate Question"),
      action("revise", "admin", "POST new Question revision"),
    ],
    expected: {
      actions: [{ id: "create" }, { id: "activate" }, { id: "revise" }],
      persistedState: {
        createdInactive: true,
        activeAfterRevision: true,
        revisionOrdinals: [1, 2],
        oldRevisionImmutable: true,
      },
    },
    sources: [
      "docs/admin/ADMIN-SPEC.md — creation, activation, and revision order",
      "packages/db/src/question-revisions.integration.test.ts — Admin creation starts Inactive and lifecycle history distinguishes publish from reactivate",
    ],
  },
  {
    id: "admin.duplicate-warning-nonblocking",
    area: "admin",
    gate: "must-pass-before-cutover",
    title: "Normalized exact duplicate wording warns but does not prevent an Admin save",
    preconditions: [
      "A Question exists with text matching after trim, whitespace collapse, and case-folding.",
    ],
    actions: [
      action("duplicates", "admin", "GET normalized exact wording matches"),
      action("create", "admin", "POST create matching Question after warning"),
    ],
    expected: {
      actions: [{ id: "duplicates", result: { warningOnly: true } }, { id: "create" }],
      persistedState: { bothQuestionsExist: true, duplicateConstraintCreated: false },
    },
    sources: [
      "docs/admin/ADMIN-SPEC.md — normalized exact wording warning",
      "packages/db/src/question-revisions.integration.test.ts — duplicate wording detection trims, collapses whitespace, and ignores case only",
      "apps/web/src/app/admin/_components/admin-question-editor.test.tsx — shows a duplicate warning without blocking intentional creation",
    ],
  },
  {
    id: "admin.withdrawn-current-blocks-activation",
    area: "admin",
    gate: "must-pass-before-cutover",
    title: "A withdrawn current revision blocks activation until a safe later revision exists",
    preconditions: ["Question is inactive and its current revision has been withdrawn."],
    actions: [
      action("activate-blocked", "admin", "POST activate Question with withdrawn current revision"),
      action("create-safe-revision", "admin", "POST new safe revision"),
      action("activate", "admin", "POST activate Question"),
    ],
    expected: {
      actions: [
        { id: "activate-blocked", status: 409 },
        { id: "create-safe-revision" },
        { id: "activate" },
      ],
      persistedState: { activeAfterBlockedAttempt: false, activeAfterSafeRevision: true },
    },
    sources: [
      "docs/admin/ADMIN-SPEC.md — blocked from activation",
      "packages/db/src/question-revisions.integration.test.ts — activation waits for a safe current revision after withdrawal",
    ],
  },
  {
    id: "admin.revision-conflict-and-restore",
    area: "admin",
    gate: "must-pass-before-cutover",
    title: "Stale revision writes conflict and restore creates a later immutable revision",
    preconditions: ["Two Admin editors loaded the same current revision; one editor saves first."],
    actions: [
      action("first-edit", "admin-a", "POST new Question revision with expectedCurrentRevisionId"),
      action("stale-edit", "admin-b", "POST stale Question revision"),
      action("restore", "admin-a", "POST restore-as-new-revision"),
    ],
    expected: {
      actions: [
        { id: "first-edit" },
        { id: "stale-edit", status: 409, errorCode: "STALE_REVISION" },
        { id: "restore" },
      ],
      persistedState: {
        revisionOrdinalsMonotonic: true,
        oldRevisionImmutable: true,
        restoreMovesPointerForward: true,
      },
    },
    sources: [
      "docs/admin/ADMIN-SPEC.md — edit, restore, and conflict handling",
      "packages/db/src/question-revisions.integration.test.ts — serializes concurrent revisions and rejects the stale writer",
      "packages/db/src/question-revisions.integration.test.ts — Admin revisions use stale-write protection and restore as a new later revision",
      "apps/web/src/app/api/admin/questions/admin-routes.test.ts — maps a stale revision write to HTTP 409",
    ],
  },
  {
    id: "admin.withdrawal-vs-unresolved-candidate",
    area: "admin",
    gate: "must-pass-before-cutover",
    title: "Withdrawal invalidates unresolved candidates without rewriting Asked history",
    preconditions: ["One unresolved candidate and one already-Asked Round pin the same revision."],
    actions: [
      action("withdraw", "admin", "POST revision withdrawal"),
      action("candidate", "creator", "GET candidate after withdrawal"),
      action("round", "participant-a", "GET already-Asked Round"),
    ],
    expected: {
      actions: [{ id: "withdraw" }, { id: "candidate" }, { id: "round" }],
      persistedState: {
        unresolvedCandidate: "invalidated",
        askedRoundPreserved: true,
        firstWithdrawalFactsPreserved: true,
      },
      realtime: [{ type: "private.changed", pair: "$pair", afterCommit: true }],
    },
    sources: [
      "docs/admin/ADMIN-SPEC.md — withdrawal and already-Asked content",
      "docs/adr/006-question-identity-revisions-and-selection.md — deactivation and withdrawal",
      "packages/db/src/question-revisions.integration.test.ts — withdrawal is idempotent and preserves the first actor, time, and reason",
      "packages/db/src/private.integration.test.ts — candidate pins its revision and withdrawal invalidates it",
    ],
    normalize: { timestamps: ["/persistedState.withdrawalAt"] },
  },
  {
    id: "admin.analytics-suppression-and-formulas",
    area: "admin",
    gate: "must-pass-before-cutover",
    title: "Admin analytics use canonical denominators and suppress every value below five Pairs",
    preconditions: [
      "The selected current-revision Private bucket has five distinct contributing Pairs: 6 valid offers (3 Asked, 2 Skipped, 1 unresolved), with 3 final Likes across its 5 decisions.",
      "The selected current-revision Together bucket has five distinct contributing Pairs: 7 shown cards (6 decided: 4 Continue, 2 Skip, and 1 undecided final card), with 3 Likes across the 6 decisions; the undecided card is liked but excluded from Like Rate.",
      "A separate otherwise-identical analytics bucket has exactly four distinct contributing Pairs and must suppress all count and rate values.",
    ],
    actions: [action("analytics", "admin", "GET current-revision Private and Together analytics")],
    expected: {
      actions: [
        {
          id: "analytics",
          status: 200,
          result: {
            private: {
              validOffers: 6,
              decisions: 5,
              decisionRate: 5 / 6,
              asked: 3,
              askRate: 3 / 5,
              skipped: 2,
              skipRate: 2 / 5,
              likeRate: 3 / 5,
            },
            together: {
              shown: 7,
              decisions: 6,
              continued: 4,
              skipped: 2,
              continueRate: 4 / 6,
              skipRate: 2 / 6,
              likeRate: 3 / 6,
            },
            defaultRevisionScope: "current",
            aggregateLabel: "All revisions — historical aggregate",
          },
        },
      ],
      persistedState: { pairIdsExposed: false, participantIdsExposed: false },
      projections: [
        {
          actor: "admin",
          mustContain: { suppressedBucket: "insufficient_data" },
          mustOmit: [
            "suppressedBucket.count",
            "suppressedBucket.numerator",
            "suppressedBucket.denominator",
            "suppressedBucket.rate",
            "pairIds",
            "participantIds",
            "answerBodies",
            "replyBodies",
          ],
        },
      ],
    },
    sources: [
      "docs/admin/ADMIN-ANALYTICS.md — grouping, formulas, and privacy rules",
      "docs/admin/ADMIN-SPEC.md — analytics privacy suppression",
      "apps/web/src/server/modules/admin-questions/admin-question-analytics.integration.test.ts — canonical current-revision formulas and five-Pair suppression",
      "apps/web/src/server/modules/admin-questions/admin-question-analytics.integration.test.ts — historical revision and all-revisions scopes",
    ],
  },
  {
    id: "admin.inventory-thresholds",
    area: "admin",
    gate: "must-pass-before-cutover",
    title: "Inventory health follows exact eligible-Question thresholds per lane",
    preconditions: ["Current eligible inventory has lanes with 5, 6, and 12 Questions."],
    actions: [action("coverage", "admin", "GET Question coverage inventory")],
    expected: {
      actions: [
        {
          id: "coverage",
          result: {
            lanes: [
              { eligibleQuestions: 5, health: "critical" },
              { eligibleQuestions: 6, health: "low" },
              { eligibleQuestions: 12, health: "healthy" },
            ],
            grouping: ["category", "relationship", "mode"],
            intensityIsDiagnosticOnly: true,
          },
        },
      ],
    },
    sources: [
      "docs/admin/ADMIN-ANALYTICS.md — derived inventory health",
      "docs/admin/ADMIN-SPEC.md — analytics, privacy, and inventory",
      "apps/web/src/server/modules/admin-questions/admin-overview.integration.test.ts — coverage thresholds and eligible lanes",
    ],
  },
  {
    id: "realtime.metadata-only-pair-scope",
    area: "realtime",
    gate: "must-pass-before-cutover",
    title: "Realtime carries only post-commit Pair-scoped invalidation metadata",
    preconditions: [
      "Two Pair event subscribers are connected; the tested command commits for Pair A.",
    ],
    actions: [
      action("mutate", "participant-a", "commit a Private command"),
      action("observe", "subscriber-a", "read Pair A event stream"),
      action("other-pair", "subscriber-b", "read Pair B event stream"),
    ],
    expected: {
      actions: [{ id: "mutate" }, { id: "observe" }, { id: "other-pair" }],
      projections: [{ actor: "subscriber-b", mustOmit: ["pairAEvent"] }],
      realtime: [
        {
          type: "private.changed",
          pair: "$pair-a",
          afterCommit: true,
          mustOmit: ["questionText", "answer", "candidateId", "token", "reply"],
        },
      ],
    },
    sources: [
      "docs/rewrite/API-CONTRACTS.md — Realtime",
      "packages/db/src/realtime.test.ts — accepts allowed metadata-only events and rejects invalid payloads",
      "apps/web/src/app/api/pairs/[pairId]/events/route.test.ts — frames authorized metadata-only named events",
      "apps/web/src/features/pair/components/pair-realtime-provider.test.ts — Pair-scoped invalidation and termination behavior",
    ],
  },
  {
    id: "together.buffering-order",
    area: "together",
    gate: "nice-to-have",
    title: "Exact local page-buffer and prefetch timing may differ while persisted choices match",
    preconditions: [
      "The implementation has multiple deterministic pages buffered for one Session.",
    ],
    actions: [action("play", "participant-a", "advance through buffered Together questions")],
    expected: {
      actions: [{ id: "play" }],
      persistedState: { persistedOccurrenceOrderMatches: true, logicalNoRepeat: true },
    },
    sources: [
      "docs/adr/006-question-identity-revisions-and-selection.md — deterministic selection boundary",
      "packages/db/src/together.integration.test.ts — deterministic page and cursor order",
      "apps/web/src/features/together-session/components/together-playback.test.ts — buffer and prefetch behavior",
    ],
  },
] satisfies ParityScenario[];

export const parityCases: readonly ParityScenario[] = cases;

export const requiredPrivateWaitingFields = [
  "candidate",
  "candidateId",
  "candidate.id",
  "questionId",
  "question.id",
  "questionRevisionId",
  "questionRevision.id",
  "text",
  "questionText",
  "intensity",
  "likedAt",
  "isLiked",
  "selectedAt",
  "selectionRank",
  "seed",
  "selectionMetadata",
] as const;
