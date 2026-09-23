import { describe, expect, test } from "bun:test";
import { parityCases, requiredPrivateWaitingFields } from "./cases";
import {
  assertScenarioExpectations,
  compareObservations,
  normalizeObservation,
  type ParityObservation,
} from "./model";

describe("rewrite parity catalog", () => {
  test("has unique scenario IDs, cutover gates, and all required parity areas", () => {
    const ids = parityCases.map((scenario) => scenario.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(parityCases.map((scenario) => scenario.area))).toEqual(
      new Set(["auth", "pair-invite-era", "together", "private", "admin", "realtime"]),
    );
    expect(
      parityCases.filter((scenario) => scenario.gate === "must-pass-before-cutover").length,
    ).toBeGreaterThan(0);
    expect(
      parityCases.filter((scenario) => scenario.gate === "nice-to-have").length,
    ).toBeGreaterThan(0);
  });

  test("makes every requested concurrency seam an explicit case", () => {
    const ids = new Set(parityCases.map((scenario) => scenario.id));
    for (const id of [
      "pair.claim-race-one-slot-occupant",
      "pair.claim-vs-termination",
      "pair.replacement-vs-mutations",
      "private.start-race-stable-shared-candidate",
      "private.sticky-lane-progression",
      "private.ask-vs-skip-race",
      "private.skip-retry-logical-consumption",
      "private.like-before-ask-freezes",
      "private.ask-before-like-freezes",
      "private.like-vs-skip-freezes",
      "private.withdrawal-before-ask",
      "private.ask-before-withdrawal",
      "private.answer-vs-decline-race",
      "private.two-answers-race",
      "private.answer-vs-termination-history",
      "private.progression-requires-both-reveals",
      "admin.revision-conflict-and-restore",
    ]) {
      expect(ids.has(id)).toBe(true);
    }
  });

  test("lists every forbidden unresolved-candidate field in the waiting case", () => {
    const waiting = parityCases.find(
      (scenario) => scenario.id === "private.waiting-projection-confidentiality",
    );
    expect(waiting).toBeDefined();
    const omitted = waiting?.expected.projections?.find(
      (projection) => projection.actor === "non-creator",
    )?.mustOmit;
    expect(omitted).toEqual(expect.arrayContaining(requiredPrivateWaitingFields));
  });

  test("assigns ownership and privacy cases to the mandatory cutover gate", () => {
    const mandatoryIds = new Set(
      parityCases
        .filter((scenario) => scenario.gate === "must-pass-before-cutover")
        .map((scenario) => scenario.id),
    );
    for (const id of [
      "auth.upgrade-preserves-ownership",
      "auth.existing-account-does-not-merge-anonymous-data",
      "auth.admin-is-not-participant",
      "pair.replacement-era-history",
      "private.waiting-projection-confidentiality",
      "admin.analytics-suppression-and-formulas",
      "admin.inventory-thresholds",
    ]) {
      expect(mandatoryIds.has(id)).toBe(true);
    }
  });

  test("pins canonical Admin formulas and 5/6/12 inventory thresholds in executable expectations", () => {
    const analytics = parityCases.find(
      (scenario) => scenario.id === "admin.analytics-suppression-and-formulas",
    );
    const metrics = analytics?.expected.actions.find((item) => item.id === "analytics")?.result as {
      private: Record<string, number>;
      together: Record<string, number>;
    };
    expect(metrics.private).toEqual({
      validOffers: 6,
      decisions: 5,
      decisionRate: 5 / 6,
      asked: 3,
      askRate: 3 / 5,
      skipped: 2,
      skipRate: 2 / 5,
      likeRate: 3 / 5,
    });
    expect(metrics.together).toEqual({
      shown: 7,
      decisions: 6,
      continued: 4,
      skipped: 2,
      continueRate: 4 / 6,
      skipRate: 2 / 6,
      likeRate: 3 / 6,
    });
    const suppressedBucket = analytics?.expected.projections?.find(
      (projection) => projection.actor === "admin",
    );
    expect(suppressedBucket?.mustContain).toEqual({ suppressedBucket: "insufficient_data" });
    expect(suppressedBucket?.mustOmit).toEqual(
      expect.arrayContaining([
        "suppressedBucket.count",
        "suppressedBucket.numerator",
        "suppressedBucket.denominator",
        "suppressedBucket.rate",
      ]),
    );

    const inventory = parityCases.find((scenario) => scenario.id === "admin.inventory-thresholds");
    expect(inventory?.expected.actions[0]?.result).toMatchObject({
      lanes: [
        { eligibleQuestions: 5, health: "critical" },
        { eligibleQuestions: 6, health: "low" },
        { eligibleQuestions: 12, health: "healthy" },
      ],
      grouping: ["category", "relationship", "mode"],
      intensityIsDiagnosticOnly: true,
    });
  });
});

describe("parity observation normalization", () => {
  test("normalizes only declared IDs and volatile paths, preserving semantic differences", () => {
    const oldObservation: ParityObservation = {
      actions: [
        {
          id: "create",
          status: 201,
          result: {
            pairId: "old-pair-id",
            createdAt: "2026-09-20T10:00:00.000Z",
            requestId: "old-request-id",
            token: "old-token",
            seed: "old-seed",
            order: ["first", "second"],
            state: "active",
          },
        },
      ],
    };
    const newObservation: ParityObservation = {
      actions: [
        {
          id: "create",
          status: 201,
          result: {
            pairId: "new-pair-id",
            createdAt: "2026-09-21T10:00:00.000Z",
            requestId: "new-request-id",
            token: "new-token",
            seed: "new-seed",
            order: ["second", "first"],
            state: "active",
          },
        },
      ],
    };
    const oldRules = {
      identityAliases: { "old-pair-id": "$pair" },
      timestamps: ["/actions/0/result/createdAt"],
      requestIds: ["/actions/0/result/requestId"],
      generatedTokens: ["/actions/0/result/token"],
      randomSeeds: ["/actions/0/result/seed"],
      unorderedArrays: ["/actions/0/result/order"],
    } as const;
    const newRules = {
      identityAliases: { "new-pair-id": "$pair" },
      timestamps: ["/actions/0/result/createdAt"],
      requestIds: ["/actions/0/result/requestId"],
      generatedTokens: ["/actions/0/result/token"],
      randomSeeds: ["/actions/0/result/seed"],
      unorderedArrays: ["/actions/0/result/order"],
    } as const;

    compareObservations(oldObservation, newObservation, oldRules, newRules);

    expect(normalizeObservation(oldObservation, oldRules).actions[0]?.result).toMatchObject({
      pairId: "$pair",
      createdAt: "<timestamp>",
      requestId: "<request-id>",
      token: "<generated-token>",
      seed: "<random-seed>",
    });
  });

  test("does not erase unlisted UUIDs, values, or ordering", () => {
    const oldObservation: ParityObservation = {
      actions: [
        {
          id: "read",
          status: 200,
          result: { pairId: "old-pair", roundId: "round-a", order: ["a", "b"] },
        },
      ],
    };
    const newObservation: ParityObservation = {
      actions: [
        {
          id: "read",
          status: 200,
          result: { pairId: "new-pair", roundId: "round-b", order: ["b", "a"] },
        },
      ],
    };
    const oldRules = { identityAliases: { "old-pair": "$pair" } };
    const newRules = { identityAliases: { "new-pair": "$pair" } };

    expect(() => compareObservations(oldObservation, newObservation, oldRules, newRules)).toThrow(
      "normalized OLD/NEW observations differ",
    );
  });

  test("checks forbidden fields against actor-relative projections", () => {
    const scenario = parityCases.find(
      (item) => item.id === "private.waiting-projection-confidentiality",
    );
    expect(scenario).toBeDefined();
    const safe: ParityObservation = {
      actions: [{ id: "read", status: 200 }],
      persistedState: { candidateState: "unresolved", roundsCreated: 0 },
      projections: [
        { actor: "non-creator", body: { state: "WAITING_FOR_CREATOR", category: "deep" } },
      ],
    };
    assertScenarioExpectations(scenario!, safe);

    const leaked: ParityObservation = {
      ...safe,
      projections: [
        { actor: "non-creator", body: { state: "WAITING_FOR_CREATOR", candidateId: "secret" } },
      ],
    };
    expect(() => assertScenarioExpectations(scenario!, leaked)).toThrow(
      "exposed forbidden field candidateId",
    );
  });
});
