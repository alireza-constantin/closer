export const realtimeEvents = [
  "pair.changed",
  "private.changed",
  "together.changed",
  "pair.terminated",
] as const;

export type RealtimeEvent = (typeof realtimeEvents)[number];

export type ParityGate = "must-pass-before-cutover" | "nice-to-have";

export interface ParityAction {
  id: string;
  actor: string;
  operation: string;
  concurrentGroup?: string;
}

export interface ExpectedAction {
  id: string;
  status?: number;
  errorCode?: string;
  result?: unknown;
}

export interface ExpectedActionGroup {
  ids: readonly string[];
  exactlyOneStatusIn: readonly number[];
  remainingStatusIn: readonly number[];
}

export interface ExpectedProjection {
  actor: string;
  state?: string;
  mustContain?: Readonly<Record<string, unknown>>;
  mustOmit?: readonly string[];
}

export interface ExpectedEvent {
  type: RealtimeEvent;
  pair: string;
  afterCommit: true;
  mustOmit?: readonly string[];
}

export interface ParityScenario {
  id: string;
  area: "auth" | "pair-invite-era" | "together" | "private" | "admin" | "realtime";
  gate: ParityGate;
  title: string;
  preconditions: readonly string[];
  actions: readonly ParityAction[];
  expected: {
    actions: readonly ExpectedAction[];
    actionGroups?: readonly ExpectedActionGroup[];
    persistedState?: Readonly<Record<string, unknown>>;
    projections?: readonly ExpectedProjection[];
    realtime?: readonly ExpectedEvent[];
  };
  sources: readonly string[];
  normalize?: {
    timestamps?: readonly string[];
    requestIds?: readonly string[];
    generatedTokens?: readonly string[];
    randomSeeds?: readonly string[];
    unorderedArrays?: readonly string[];
  };
}

export interface ActionObservation {
  id: string;
  status: number;
  errorCode?: string;
  result?: unknown;
}

export interface ProjectionObservation {
  actor: string;
  body: unknown;
}

export interface RealtimeObservation {
  type: string;
  pair: string;
  afterCommit: boolean;
  payload?: unknown;
}

/** The adapter returns an authorized state snapshot, not a DB-specific dump. */
export interface ParityObservation {
  actions: readonly ActionObservation[];
  persistedState?: unknown;
  projections?: readonly ProjectionObservation[];
  realtime?: readonly RealtimeObservation[];
}

/**
 * Runtime-specific IDs must be mapped to stable scenario labels by each adapter.
 * Only explicitly listed volatile paths are normalized; all other differences
 * remain visible to the comparison.
 */
export interface NormalizationRules {
  identityAliases?: Readonly<Record<string, string>>;
  timestamps?: readonly string[];
  requestIds?: readonly string[];
  generatedTokens?: readonly string[];
  randomSeeds?: readonly string[];
  unorderedArrays?: readonly string[];
}

export interface ParityAdapter {
  readonly name: "old" | "new";
  run(scenario: ParityScenario): Promise<{
    observation: ParityObservation;
    identityAliases: Readonly<Record<string, string>>;
  }>;
}

type VolatilePathRule = "timestamps" | "requestIds" | "generatedTokens" | "randomSeeds";

const volatileMarkers: ReadonlyArray<readonly [VolatilePathRule, string]> = [
  ["timestamps", "<timestamp>"],
  ["requestIds", "<request-id>"],
  ["generatedTokens", "<generated-token>"],
  ["randomSeeds", "<random-seed>"],
];

function pointerFor(path: readonly (string | number)[]): string {
  return `/${path.map((part) => String(part).replaceAll("~", "~0").replaceAll("/", "~1")).join("/")}`;
}

function stableJson(value: unknown): string {
  return JSON.stringify(value);
}

function normalizeValue(
  value: unknown,
  path: readonly (string | number)[],
  rules: NormalizationRules,
): unknown {
  const pointer = pointerFor(path);

  if (Array.isArray(value)) {
    const normalized = value.map((item, index) => normalizeValue(item, [...path, index], rules));
    return rules.unorderedArrays?.includes(pointer)
      ? normalized.toSorted((left, right) => stableJson(left).localeCompare(stableJson(right)))
      : normalized;
  }

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, normalizeValue(child, [...path, key], rules)]),
    );
  }

  if (typeof value !== "string") return value;

  const alias = rules.identityAliases?.[value];
  if (alias !== undefined) return alias;

  for (const [ruleName, marker] of volatileMarkers) {
    if (rules[ruleName]?.includes(pointer)) return marker;
  }

  return value;
}

export function normalizeObservation(
  observation: ParityObservation,
  rules: NormalizationRules = {},
): ParityObservation {
  return normalizeValue(observation, [], rules) as ParityObservation;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function matchesSubset(actual: unknown, expected: unknown): boolean {
  if (isObject(expected)) {
    if (!isObject(actual)) return false;
    return Object.entries(expected).every(([key, value]) => matchesSubset(actual[key], value));
  }

  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length < expected.length) return false;
    return expected.every((value, index) => matchesSubset(actual[index], value));
  }

  return Object.is(actual, expected);
}

function valueAtPath(value: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, segment) => {
    if (!isObject(current)) return undefined;
    return current[segment];
  }, value);
}

function pathExists(value: unknown, path: string): boolean {
  return valueAtPath(value, path) !== undefined;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function assertScenarioExpectations(
  scenario: ParityScenario,
  observation: ParityObservation,
): void {
  for (const expected of scenario.expected.actions) {
    const actual = observation.actions.find((action) => action.id === expected.id);
    assert(actual, `${scenario.id}: missing action observation ${expected.id}`);
    if (expected.status !== undefined) {
      assert(
        actual.status === expected.status,
        `${scenario.id}/${expected.id}: expected status ${expected.status}, got ${actual.status}`,
      );
    }
    if (expected.errorCode !== undefined) {
      assert(
        actual.errorCode === expected.errorCode,
        `${scenario.id}/${expected.id}: expected error code ${expected.errorCode}, got ${actual.errorCode ?? "<none>"}`,
      );
    }
    if (expected.result !== undefined) {
      assert(
        matchesSubset(actual.result, expected.result),
        `${scenario.id}/${expected.id}: result does not contain the expected fields`,
      );
    }
  }

  for (const group of scenario.expected.actionGroups ?? []) {
    const outcomes = group.ids.map((id) => observation.actions.find((action) => action.id === id));
    assert(
      outcomes.every(Boolean),
      `${scenario.id}: missing observation in concurrent action group`,
    );
    const statuses = outcomes.map((outcome) => outcome!.status);
    const successes = statuses.filter((status) => group.exactlyOneStatusIn.includes(status));
    const remaining = statuses.filter((status) => group.remainingStatusIn.includes(status));
    assert(
      successes.length === 1,
      `${scenario.id}: concurrent group expected exactly one winning action`,
    );
    assert(
      remaining.length === group.ids.length - 1,
      `${scenario.id}: concurrent group expected all other actions to reject safely`,
    );
  }

  if (scenario.expected.persistedState !== undefined) {
    assert(
      matchesSubset(observation.persistedState, scenario.expected.persistedState),
      `${scenario.id}: persisted state does not contain the expected fields`,
    );
  }

  for (const expected of scenario.expected.projections ?? []) {
    const projection = observation.projections?.find((item) => item.actor === expected.actor);
    assert(projection, `${scenario.id}: missing projection for ${expected.actor}`);
    if (expected.state !== undefined) {
      assert(
        valueAtPath(projection.body, "state") === expected.state,
        `${scenario.id}: ${expected.actor} projection state mismatch`,
      );
    }
    if (expected.mustContain !== undefined) {
      assert(
        matchesSubset(projection.body, expected.mustContain),
        `${scenario.id}: ${expected.actor} projection is missing expected fields`,
      );
    }
    for (const path of expected.mustOmit ?? []) {
      assert(
        !pathExists(projection.body, path),
        `${scenario.id}: ${expected.actor} projection exposed forbidden field ${path}`,
      );
    }
  }

  for (const expected of scenario.expected.realtime ?? []) {
    const event = observation.realtime?.find(
      (item) =>
        item.type === expected.type &&
        item.pair === expected.pair &&
        item.afterCommit === expected.afterCommit,
    );
    assert(
      event,
      `${scenario.id}: missing post-commit ${expected.type} event for ${expected.pair}`,
    );
    for (const path of expected.mustOmit ?? []) {
      assert(
        !pathExists(event.payload, path),
        `${scenario.id}: ${expected.type} event exposed forbidden field ${path}`,
      );
    }
  }
}

export function compareObservations(
  oldObservation: ParityObservation,
  newObservation: ParityObservation,
  oldRules: NormalizationRules = {},
  newRules: NormalizationRules = {},
): void {
  const oldNormalized = normalizeObservation(oldObservation, oldRules);
  const newNormalized = normalizeObservation(newObservation, newRules);
  assert(
    stableJson(oldNormalized) === stableJson(newNormalized),
    `normalized OLD/NEW observations differ:\nOLD ${stableJson(oldNormalized)}\nNEW ${stableJson(newNormalized)}`,
  );
}

export async function compareScenario(
  scenario: ParityScenario,
  oldAdapter: ParityAdapter,
  newAdapter: ParityAdapter,
): Promise<void> {
  assert(oldAdapter.name === "old", "first adapter must be named old");
  assert(newAdapter.name === "new", "second adapter must be named new");

  const [oldRun, newRun] = await Promise.all([oldAdapter.run(scenario), newAdapter.run(scenario)]);
  const rulesFor = (run: Awaited<ReturnType<ParityAdapter["run"]>>): NormalizationRules => ({
    ...scenario.normalize,
    identityAliases: run.identityAliases,
  });

  const oldRules = rulesFor(oldRun);
  const newRules = rulesFor(newRun);
  const oldObservation = normalizeObservation(oldRun.observation, oldRules);
  const newObservation = normalizeObservation(newRun.observation, newRules);

  assertScenarioExpectations(scenario, oldObservation);
  assertScenarioExpectations(scenario, newObservation);
  compareObservations(oldRun.observation, newRun.observation, oldRules, newRules);
}
