import { createHash, randomBytes } from "node:crypto";

import { and, asc, desc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";

import { createDb } from "./index";
import {
  TOGETHER_QUESTION_PAGE_SIZE,
  togetherIntensityFallback,
  togetherQuestionBands,
  type TogetherLoadedQuestion,
  type TogetherQuestionBand,
  type TogetherQuestionPage,
  type TogetherQuestionPools,
} from "./together-playback";
import {
  initialInvite,
  pair,
  pairMembershipEra,
  pairMembership,
  participant,
  privateAnswer,
  privateConversation,
  privateQuestionCandidate,
  privateReaction,
  privateReply,
  privateRevealView,
  privateRound,
  question,
  questionRevision,
  rejoinInvite,
  togetherSession,
  togetherSessionQuestion,
} from "./schema/closer";
import { session, user } from "./schema/auth";

type Database = ReturnType<typeof createDb>;
type RelationshipType = "partner" | "friend";
type QuestionCategory = "fun" | "deep" | "memories" | "relationship" | "friendship";
type QuestionModeFit = "both" | "together" | "private";
export type QuestionIntensity = "light" | "medium" | "deep";
type QuestionRelationshipFit = "both" | RelationshipType;
type ReactionValue = "heart" | "laugh" | "tender" | "surprised";

export type QuestionRevisionInput = {
  text: string;
  category: QuestionCategory;
  relationshipFit: QuestionRelationshipFit;
  modeFit: QuestionModeFit;
  intensity: QuestionIntensity;
};

const INITIAL_INVITE_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const REJOIN_INVITE_LIFETIME_MS = 24 * 60 * 60 * 1000;

export class CloserDomainError extends Error {
  constructor(
    readonly code:
      | "DISPLAY_NAME_INVALID"
      | "INTENDED_PERSON_NAME_INVALID"
      | "RELATIONSHIP_TYPE_INVALID"
      | "PAIR_CREATION_REQUEST_INVALID"
      | "PARTICIPANT_NOT_FOUND"
      | "PAIR_ALREADY_CLAIMED"
      | "UNAUTHENTICATED"
      | "PAIR_NOT_FOUND"
      | "INVITE_UNAVAILABLE"
      | "REJOIN_UNAVAILABLE"
      | "ROUND_NOT_FOUND"
      | "CONVERSATION_NOT_FOUND"
      | "PAIR_NOT_READY"
      | "QUESTION_UNAVAILABLE"
      | "PRIVATE_CONVERSATION_EXHAUSTED"
      | "ANSWER_INVALID"
      | "ANSWER_IMMUTABLE"
      | "REPLY_INVALID"
      | "REACTION_INVALID"
      | "REVEAL_NOT_READY"
      | "TOGETHER_SESSION_NOT_FOUND"
      | "TOGETHER_SESSION_ENDED"
      | "TOGETHER_SESSION_EXHAUSTED"
      | "TOGETHER_ACTION_INVALID",
  ) {
    super(code);
  }
}

function normalizeDisplayName(value: string) {
  const displayName = value.trim();
  if (displayName.length < 1 || displayName.length > 40) {
    throw new CloserDomainError("DISPLAY_NAME_INVALID");
  }
  return displayName;
}

function normalizeIntendedPersonName(value: unknown) {
  if (typeof value !== "string") throw new CloserDomainError("INTENDED_PERSON_NAME_INVALID");
  const intendedPersonName = value.trim();
  if (intendedPersonName.length < 1 || intendedPersonName.length > 40) {
    throw new CloserDomainError("INTENDED_PERSON_NAME_INVALID");
  }
  return intendedPersonName;
}

function assertRelationshipType(value: string): asserts value is RelationshipType {
  if (value !== "partner" && value !== "friend") {
    throw new CloserDomainError("RELATIONSHIP_TYPE_INVALID");
  }
}

function assertQuestionCategory(value: string): asserts value is QuestionCategory {
  if (!["fun", "deep", "memories", "relationship", "friendship"].includes(value)) {
    throw new CloserDomainError("QUESTION_UNAVAILABLE");
  }
}

function assertQuestionIntensity(value: string): asserts value is QuestionIntensity {
  if (!(["light", "medium", "deep"] as const).includes(value as QuestionIntensity)) {
    throw new CloserDomainError("QUESTION_UNAVAILABLE");
  }
}

function assertQuestionModeFit(value: string): asserts value is QuestionModeFit {
  if (!(["both", "together", "private"] as const).includes(value as QuestionModeFit)) {
    throw new CloserDomainError("QUESTION_UNAVAILABLE");
  }
}

function assertQuestionRelationshipFit(value: string): asserts value is QuestionRelationshipFit {
  if (!(["both", "partner", "friend"] as const).includes(value as QuestionRelationshipFit)) {
    throw new CloserDomainError("QUESTION_UNAVAILABLE");
  }
}

function normalizeTogetherSelectionSeed(value: string | undefined) {
  const seed = value ?? randomBytes(32).toString("hex");
  if (!seed.trim() || seed.length > 128) throw new CloserDomainError("TOGETHER_ACTION_INVALID");
  return seed;
}

function normalizeQuestionRevision(input: QuestionRevisionInput): QuestionRevisionInput {
  const text = input.text.trim();
  if (!text) throw new CloserDomainError("QUESTION_UNAVAILABLE");
  assertQuestionCategory(input.category);
  assertQuestionRelationshipFit(input.relationshipFit);
  assertQuestionModeFit(input.modeFit);
  assertQuestionIntensity(input.intensity);
  if (
    (input.category === "relationship" && input.relationshipFit !== "partner") ||
    (input.category === "friendship" && input.relationshipFit !== "friend")
  ) {
    throw new CloserDomainError("QUESTION_UNAVAILABLE");
  }
  return { ...input, text };
}

function assertReactionValue(value: string): asserts value is ReactionValue {
  if (!["heart", "laugh", "tender", "surprised"].includes(value)) {
    throw new CloserDomainError("REACTION_INVALID");
  }
}

function normalizePrivateText(
  value: string,
  maximumLength: number,
  errorCode: "ANSWER_INVALID" | "REPLY_INVALID",
) {
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > maximumLength) {
    throw new CloserDomainError(errorCode);
  }
  return normalized;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function hashInviteToken(token: string) {
  return createHash("sha256").update(token).digest("base64url");
}

function createInviteToken() {
  return randomBytes(32).toString("base64url");
}

export async function resolveOrCreateParticipant(
  database: Database,
  input: { authUserId: string; displayName: string },
) {
  const displayName = normalizeDisplayName(input.displayName);
  const existing = await database
    .select()
    .from(participant)
    .where(eq(participant.authUserId, input.authUserId))
    .limit(1);

  if (existing[0]) return existing[0];

  const inserted = await database
    .insert(participant)
    .values({ authUserId: input.authUserId, displayName })
    .onConflictDoNothing({ target: participant.authUserId })
    .returning();

  if (inserted[0]) return inserted[0];

  const resolved = await database
    .select()
    .from(participant)
    .where(eq(participant.authUserId, input.authUserId))
    .limit(1);

  if (!resolved[0]) throw new Error("Participant creation did not resolve.");
  return resolved[0];
}

export async function getParticipantByAuthUserId(database: Database, authUserId: string) {
  const rows = await database
    .select()
    .from(participant)
    .where(eq(participant.authUserId, authUserId))
    .limit(1);
  return rows[0] ?? null;
}

/** Create one stable logical Question and its first immutable revision. */
export async function createQuestion(database: Database, input: QuestionRevisionInput) {
  const revisionInput = normalizeQuestionRevision(input);
  return database.transaction(async (transaction) => {
    const tx = transaction as unknown as Database;
    const insertedQuestion = await tx.insert(question).values({ isActive: true }).returning();
    const logicalQuestion = insertedQuestion[0];
    if (!logicalQuestion) throw new Error("Question creation did not return a question.");

    const insertedRevision = await tx
      .insert(questionRevision)
      .values({ questionId: logicalQuestion.id, ...revisionInput })
      .returning();
    const revision = insertedRevision[0];
    if (!revision) throw new Error("Question creation did not return a revision.");

    const updatedQuestion = await tx
      .update(question)
      .set({ currentRevisionId: revision.id })
      .where(eq(question.id, logicalQuestion.id))
      .returning();
    if (!updatedQuestion[0]) throw new Error("Question creation did not set a current revision.");
    return { question: updatedQuestion[0], revision };
  });
}

/** Create a new immutable revision and make it current for future selection. */
export async function createQuestionRevision(
  database: Database,
  input: QuestionRevisionInput & { questionId: string },
) {
  const revisionInput = normalizeQuestionRevision(input);
  return database.transaction(async (transaction) => {
    const tx = transaction as unknown as Database;
    const logicalQuestion = await tx
      .select()
      .from(question)
      .where(eq(question.id, input.questionId))
      .for("update")
      .limit(1);
    if (!logicalQuestion[0]) throw new CloserDomainError("QUESTION_UNAVAILABLE");

    const insertedRevision = await tx
      .insert(questionRevision)
      .values({ questionId: input.questionId, ...revisionInput })
      .returning();
    const revision = insertedRevision[0];
    if (!revision) throw new Error("Question revision creation did not return a revision.");

    const updatedQuestion = await tx
      .update(question)
      .set({ currentRevisionId: revision.id })
      .where(eq(question.id, input.questionId))
      .returning();
    if (!updatedQuestion[0])
      throw new Error("Question revision creation did not set a current revision.");
    return { question: updatedQuestion[0], revision };
  });
}

export async function reviseQuestion(
  database: Database,
  input: QuestionRevisionInput & { questionId: string },
) {
  return createQuestionRevision(database, input);
}

export async function getQuestionWithCurrentRevision(database: Database, questionId: string) {
  const rows = await database
    .select({ question, revision: questionRevision })
    .from(question)
    .innerJoin(questionRevision, eq(question.currentRevisionId, questionRevision.id))
    .where(eq(question.id, questionId))
    .limit(1);
  return rows[0] ?? null;
}

/** Deactivation only affects future selection; pinned occurrences remain readable. */
export async function deactivateQuestion(database: Database, questionId: string) {
  const rows = await database
    .update(question)
    .set({ isActive: false })
    .where(eq(question.id, questionId))
    .returning();
  if (!rows[0]) throw new CloserDomainError("QUESTION_UNAVAILABLE");
  return rows[0];
}

/** Withdraw one revision for future safety enforcement without rewriting history. */
export async function withdrawQuestionRevision(database: Database, questionRevisionId: string) {
  return database.transaction(async (transaction) => {
    const tx = transaction as unknown as Database;
    const rows = await tx
      .update(questionRevision)
      .set({ withdrawnAt: new Date() })
      .where(eq(questionRevision.id, questionRevisionId))
      .returning();
    if (!rows[0]) throw new CloserDomainError("QUESTION_UNAVAILABLE");

    const affected = await tx
      .select({
        candidateId: privateQuestionCandidate.id,
        conversationId: privateQuestionCandidate.conversationId,
      })
      .from(privateQuestionCandidate)
      .where(
        and(
          eq(privateQuestionCandidate.questionRevisionId, questionRevisionId),
          eq(privateQuestionCandidate.state, "unresolved"),
        ),
      );
    for (const candidate of affected) {
      await tx
        .update(privateQuestionCandidate)
        .set({ state: "invalidated", resolvedAt: new Date() })
        .where(
          and(
            eq(privateQuestionCandidate.id, candidate.candidateId),
            eq(privateQuestionCandidate.state, "unresolved"),
          ),
        );
      const conversationRows = await tx
        .select({
          conversation: privateConversation,
          relationshipType: pair.relationshipType,
          eraEndedAt: pairMembershipEra.endedAt,
        })
        .from(privateConversation)
        .innerJoin(pair, eq(privateConversation.pairId, pair.id))
        .innerJoin(pairMembershipEra, eq(privateConversation.membershipEraId, pairMembershipEra.id))
        .where(eq(privateConversation.id, candidate.conversationId))
        .limit(1);
      const conversation = conversationRows[0];
      if (conversation && !conversation.eraEndedAt) {
        await selectPrivateQuestionCandidate(
          tx,
          conversation.conversation,
          conversation.relationshipType,
        );
      }
    }
    return rows[0];
  });
}

/**
 * List every active space the participant can access.
 *
 * Pair membership is the authority for this projection. The member lookup is
 * intentionally restricted to the returned pair IDs, so the display name is
 * always the other member of an authorized space and never a client-selected
 * participant lookup.
 */
export async function listActivePairsForParticipant(database: Database, participantId: string) {
  const memberships = await database
    .select({
      pairId: pairMembership.pairId,
      relationshipType: pair.relationshipType,
      intendedPersonName: pair.intendedPersonName,
    })
    .from(pairMembership)
    .innerJoin(pair, eq(pairMembership.pairId, pair.id))
    .where(and(eq(pairMembership.participantId, participantId), isNull(pairMembership.endedAt)))
    .orderBy(desc(pair.createdAt), desc(pair.id));

  if (!memberships.length) return [];

  const pairIds = memberships.map((membership) => membership.pairId);
  const members = await database
    .select({
      pairId: pairMembership.pairId,
      participantId: pairMembership.participantId,
      displayName: participant.displayName,
    })
    .from(pairMembership)
    .innerJoin(participant, eq(pairMembership.participantId, participant.id))
    .where(and(inArray(pairMembership.pairId, pairIds), isNull(pairMembership.endedAt)));

  const membersByPair = new Map<string, typeof members>();
  for (const member of members) {
    const pairMembers = membersByPair.get(member.pairId) ?? [];
    pairMembers.push(member);
    membersByPair.set(member.pairId, pairMembers);
  }

  return memberships.map((membership) => {
    const otherMember = membersByPair
      .get(membership.pairId)
      ?.find((member) => member.participantId !== participantId);

    return {
      pairId: membership.pairId,
      relationshipType: membership.relationshipType,
      state: otherMember ? ("connected" as const) : ("waiting" as const),
      otherParticipantDisplayName: otherMember?.displayName ?? null,
      intendedPersonName: otherMember ? null : membership.intendedPersonName,
    };
  });
}

async function requireActivePairAccess(database: Database, participantId: string, pairId: string) {
  const rows = await database
    .select({ membership: pairMembership, pair })
    .from(pairMembership)
    .innerJoin(pair, eq(pairMembership.pairId, pair.id))
    .where(
      and(
        eq(pairMembership.pairId, pairId),
        eq(pairMembership.participantId, participantId),
        isNull(pairMembership.endedAt),
        isNull(pair.terminatedAt),
      ),
    )
    .limit(1);

  if (!rows[0]) throw new CloserDomainError("PAIR_NOT_FOUND");
  return rows[0];
}

/** Locks the aggregate lifecycle boundary and rejects terminal Pairs. */
async function requireActivePairInTransaction(
  tx: Database | Parameters<Parameters<Database["transaction"]>[0]>[0],
  pairId: string,
) {
  const rows = await tx
    .select({ id: pair.id })
    .from(pair)
    .where(and(eq(pair.id, pairId), isNull(pair.terminatedAt)))
    .for("update")
    .limit(1);
  if (!rows[0]) throw new CloserDomainError("PAIR_NOT_FOUND");
  return rows[0];
}

async function requireSoleUnclaimedPairMemberInTransaction(
  tx: Parameters<Parameters<Database["transaction"]>[0]>[0],
  participantId: string,
  pairId: string,
) {
  await requireActivePairInTransaction(tx, pairId);
  const activeMemberships = await tx
    .select({ participantId: pairMembership.participantId, slot: pairMembership.slot })
    .from(pairMembership)
    .where(and(eq(pairMembership.pairId, pairId), isNull(pairMembership.endedAt)));
  if (
    activeMemberships.length !== 1 ||
    activeMemberships[0]?.participantId !== participantId ||
    activeMemberships[0]?.slot !== "first"
  ) {
    throw new CloserDomainError("INVITE_UNAVAILABLE");
  }
}

/**
 * Atomically establishes the terminal lifecycle boundary for a Pair.
 * Repeating the command from a former member is a stable no-op, so snapshots
 * and timestamps are never rewritten.
 */
export async function terminatePair(
  database: Database,
  input: { participantId: string; pairId: string },
) {
  return database.transaction(async (transaction) => {
    const tx = transaction as unknown as Database;
    const lockedPairs = await tx
      .select()
      .from(pair)
      .where(eq(pair.id, input.pairId))
      .for("update")
      .limit(1);
    const lockedPair = lockedPairs[0];
    if (!lockedPair) throw new CloserDomainError("PAIR_NOT_FOUND");

    const actorMemberships = await tx
      .select({ id: pairMembership.id, endedAt: pairMembership.endedAt })
      .from(pairMembership)
      .where(
        and(
          eq(pairMembership.pairId, input.pairId),
          eq(pairMembership.participantId, input.participantId),
        ),
      )
      .limit(1);
    if (!actorMemberships[0]) throw new CloserDomainError("PAIR_NOT_FOUND");
    if (lockedPair.terminatedAt)
      return {
        pairId: lockedPair.id,
        state: "terminated" as const,
        terminatedAt: lockedPair.terminatedAt,
      };
    if (actorMemberships[0].endedAt) throw new CloserDomainError("PAIR_NOT_FOUND");

    const endedAt = new Date();
    const activeMemberships = await tx
      .select({ id: pairMembership.id, displayName: participant.displayName })
      .from(pairMembership)
      .innerJoin(participant, eq(pairMembership.participantId, participant.id))
      .where(and(eq(pairMembership.pairId, input.pairId), isNull(pairMembership.endedAt)))
      .for("update");
    if (!activeMemberships.length) throw new CloserDomainError("PAIR_NOT_FOUND");

    await tx.update(pair).set({ terminatedAt: endedAt }).where(eq(pair.id, input.pairId));
    for (const membership of activeMemberships) {
      await tx
        .update(pairMembership)
        .set({ endedAt, endedDisplayName: membership.displayName })
        .where(and(eq(pairMembership.id, membership.id), isNull(pairMembership.endedAt)));
    }
    await tx
      .update(pairMembershipEra)
      .set({ endedAt })
      .where(and(eq(pairMembershipEra.pairId, input.pairId), isNull(pairMembershipEra.endedAt)));
    await tx
      .update(privateQuestionCandidate)
      .set({ state: "invalidated", resolvedAt: endedAt })
      .where(
        and(
          eq(privateQuestionCandidate.state, "unresolved"),
          sql`exists (
          select 1 from private_conversation terminal_conversation
          where terminal_conversation.id = ${privateQuestionCandidate.conversationId}
            and terminal_conversation.pair_id = ${input.pairId}
        )`,
        ),
      );
    await tx
      .update(initialInvite)
      .set({ revokedAt: endedAt })
      .where(
        and(
          eq(initialInvite.pairId, input.pairId),
          isNull(initialInvite.revokedAt),
          isNull(initialInvite.redeemedAt),
        ),
      );
    await tx
      .update(rejoinInvite)
      .set({ revokedAt: endedAt })
      .where(
        and(
          eq(rejoinInvite.pairId, input.pairId),
          isNull(rejoinInvite.revokedAt),
          isNull(rejoinInvite.redeemedAt),
        ),
      );
    await tx
      .update(togetherSession)
      .set({ endedAt })
      .where(and(eq(togetherSession.pairId, input.pairId), isNull(togetherSession.endedAt)));

    return { pairId: lockedPair.id, state: "terminated" as const, terminatedAt: endedAt };
  });
}

async function findUsableInitialInvite(database: Pick<Database, "select">, pairId: string) {
  const rows = await database
    .select({ id: initialInvite.id, expiresAt: initialInvite.expiresAt })
    .from(initialInvite)
    .where(
      and(
        eq(initialInvite.pairId, pairId),
        isNull(initialInvite.revokedAt),
        isNull(initialInvite.redeemedAt),
        gt(initialInvite.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(initialInvite.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

async function createInitialInviteInTransaction(
  tx: Parameters<Parameters<Database["transaction"]>[0]>[0],
  pairId: string,
) {
  const token = createInviteToken();
  const expiresAt = new Date(Date.now() + INITIAL_INVITE_LIFETIME_MS);

  await tx.insert(initialInvite).values({
    pairId,
    tokenHash: hashInviteToken(token),
    expiresAt,
  });

  return { token, expiresAt };
}

export async function createPairForParticipant(
  database: Database,
  input: {
    participantId: string;
    intendedPersonName: string;
    relationshipType: string;
    clientRequestId?: string;
  },
) {
  const relationshipType = input.relationshipType;
  assertRelationshipType(relationshipType);
  const intendedPersonName = normalizeIntendedPersonName(input.intendedPersonName);
  if (input.clientRequestId && !isUuid(input.clientRequestId))
    throw new CloserDomainError("PAIR_CREATION_REQUEST_INVALID");

  const existingParticipant = await database
    .select({ id: participant.id })
    .from(participant)
    .where(eq(participant.id, input.participantId))
    .limit(1);
  if (!existingParticipant[0]) throw new CloserDomainError("PARTICIPANT_NOT_FOUND");

  return database.transaction(async (tx) => {
    const pairs = await tx
      .insert(pair)
      .values({ relationshipType, intendedPersonName, creationRequestId: input.clientRequestId })
      .onConflictDoNothing({ target: pair.creationRequestId })
      .returning();
    let createdPair = pairs[0];
    if (!createdPair && input.clientRequestId) {
      const existing = await tx
        .select({ pair })
        .from(pair)
        .innerJoin(
          pairMembership,
          and(
            eq(pairMembership.pairId, pair.id),
            eq(pairMembership.participantId, input.participantId),
            eq(pairMembership.slot, "first"),
            isNull(pairMembership.endedAt),
          ),
        )
        .where(eq(pair.creationRequestId, input.clientRequestId))
        .limit(1);
      createdPair = existing[0]?.pair;
      if (createdPair) return { pair: createdPair };
    }
    if (!createdPair) throw new Error("Pair creation did not return a pair.");

    await tx.insert(pairMembership).values({
      pairId: createdPair.id,
      participantId: input.participantId,
      slot: "first",
    });

    return { pair: createdPair };
  });
}

export async function updateIntendedPersonName(
  database: Database,
  input: { participantId: string; pairId: string; intendedPersonName: string },
) {
  const intendedPersonName = normalizeIntendedPersonName(input.intendedPersonName);
  await requireActivePairAccess(database, input.participantId, input.pairId);

  return database.transaction(async (transaction) => {
    const tx = transaction as unknown as Database;
    await tx.execute(sql`select id from "pair" where id = ${input.pairId} for update`);
    await requireActivePairAccess(tx, input.participantId, input.pairId);
    const secondMember = await tx
      .select({ id: pairMembership.id })
      .from(pairMembership)
      .where(
        and(
          eq(pairMembership.pairId, input.pairId),
          eq(pairMembership.slot, "second"),
          isNull(pairMembership.endedAt),
        ),
      )
      .limit(1);
    if (secondMember[0]) throw new CloserDomainError("PAIR_ALREADY_CLAIMED");

    const updated = await tx
      .update(pair)
      .set({ intendedPersonName })
      .where(eq(pair.id, input.pairId))
      .returning();
    if (!updated[0]) throw new CloserDomainError("PAIR_NOT_FOUND");
    return updated[0];
  });
}

export async function getInitialInviteStatus(
  database: Database,
  input: { participantId: string; pairId: string },
) {
  await requireActivePairAccess(database, input.participantId, input.pairId);
  return database.transaction(async (tx) => {
    await requireSoleUnclaimedPairMemberInTransaction(tx, input.participantId, input.pairId);
    const usable = await findUsableInitialInvite(tx, input.pairId);
    return usable
      ? { state: "active" as const, expiresAt: usable.expiresAt }
      : { state: "none" as const };
  });
}

/**
 * Issues a raw credential only when no usable one exists. A caller that does
 * not retain the previous raw credential receives its existence and expiry,
 * never a silently rotated replacement.
 */
export async function issueOrReuseInitialInvite(
  database: Database,
  input: { participantId: string; pairId: string },
) {
  await requireActivePairAccess(database, input.participantId, input.pairId);
  return database.transaction(async (tx) => {
    await requireSoleUnclaimedPairMemberInTransaction(tx, input.participantId, input.pairId);
    const existing = await findUsableInitialInvite(tx, input.pairId);
    if (existing) return { state: "active" as const, expiresAt: existing.expiresAt };

    // Expired credentials are not usable. Mark them terminal before creating
    // the fresh credential, keeping lifecycle rows auditable without allowing
    // an unbounded set of apparently-live rows.
    await tx
      .update(initialInvite)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(initialInvite.pairId, input.pairId),
          isNull(initialInvite.revokedAt),
          isNull(initialInvite.redeemedAt),
        ),
      );
    const issued = await createInitialInviteInTransaction(tx, input.pairId);
    return { state: "issued" as const, ...issued };
  });
}

export async function replaceInitialInvite(
  database: Database,
  input: { participantId: string; pairId: string },
) {
  await requireActivePairAccess(database, input.participantId, input.pairId);
  return database.transaction(async (tx) => {
    await requireSoleUnclaimedPairMemberInTransaction(tx, input.participantId, input.pairId);
    const existing = await findUsableInitialInvite(tx, input.pairId);
    if (!existing) throw new CloserDomainError("INVITE_UNAVAILABLE");
    await tx
      .update(initialInvite)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(initialInvite.pairId, input.pairId),
          isNull(initialInvite.revokedAt),
          isNull(initialInvite.redeemedAt),
        ),
      );
    return createInitialInviteInTransaction(tx, input.pairId);
  });
}

export async function isInitialInviteUsable(
  database: Database,
  input: { participantId: string; pairId: string; token: string },
) {
  await requireActivePairAccess(database, input.participantId, input.pairId);
  const rows = await database
    .select({ id: initialInvite.id })
    .from(initialInvite)
    .where(
      and(
        eq(initialInvite.pairId, input.pairId),
        eq(initialInvite.tokenHash, hashInviteToken(input.token)),
        isNull(initialInvite.revokedAt),
        isNull(initialInvite.redeemedAt),
        gt(initialInvite.expiresAt, new Date()),
      ),
    )
    .limit(1);
  return Boolean(rows[0]);
}

export async function revokeInitialInvites(
  database: Database,
  input: { participantId: string; pairId: string },
) {
  await requireActivePairAccess(database, input.participantId, input.pairId);
  await database.transaction(async (tx) => {
    await tx.execute(sql`select id from "pair" where id = ${input.pairId} for update`);
    await requireActivePairAccess(tx as unknown as Database, input.participantId, input.pairId);
    await tx
      .update(initialInvite)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(initialInvite.pairId, input.pairId),
          isNull(initialInvite.revokedAt),
          isNull(initialInvite.redeemedAt),
        ),
      );
  });
}

/**
 * The high-entropy invite URL is the only public capability here. This small
 * projection lets its landing page name the inviter without exposing pair data
 * for a missing, revoked, redeemed, or expired invite.
 */
export async function getInitialInviteLanding(database: Database, token: string) {
  const rows = await database
    .select({
      inviterDisplayName: participant.displayName,
      relationshipType: pair.relationshipType,
      intendedPersonName: pair.intendedPersonName,
    })
    .from(initialInvite)
    .innerJoin(pair, eq(pair.id, initialInvite.pairId))
    .innerJoin(
      pairMembership,
      and(
        eq(pairMembership.pairId, initialInvite.pairId),
        eq(pairMembership.slot, "first"),
        isNull(pairMembership.endedAt),
      ),
    )
    .innerJoin(participant, eq(participant.id, pairMembership.participantId))
    .where(
      and(
        eq(initialInvite.tokenHash, hashInviteToken(token)),
        isNull(pair.terminatedAt),
        isNull(initialInvite.revokedAt),
        isNull(initialInvite.redeemedAt),
        gt(initialInvite.expiresAt, new Date()),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function redeemInitialInvite(
  database: Database,
  input: { token: string; participantId: string },
) {
  return database.transaction(async (tx) => {
    const inviteRows = await tx
      .select()
      .from(initialInvite)
      .where(eq(initialInvite.tokenHash, hashInviteToken(input.token)))
      .limit(1);
    const invite = inviteRows[0];
    if (!invite) throw new CloserDomainError("INVITE_UNAVAILABLE");

    await requireActivePairInTransaction(tx, invite.pairId);

    const usableInvite = await tx
      .select({ id: initialInvite.id })
      .from(initialInvite)
      .where(
        and(
          eq(initialInvite.id, invite.id),
          isNull(initialInvite.redeemedAt),
          isNull(initialInvite.revokedAt),
          gt(initialInvite.expiresAt, new Date()),
        ),
      )
      .limit(1);
    if (!usableInvite[0]) throw new CloserDomainError("INVITE_UNAVAILABLE");

    const participantMembership = await tx
      .select({ id: pairMembership.id })
      .from(pairMembership)
      .where(
        and(
          eq(pairMembership.pairId, invite.pairId),
          eq(pairMembership.participantId, input.participantId),
          isNull(pairMembership.endedAt),
        ),
      )
      .limit(1);
    if (participantMembership[0]) throw new CloserDomainError("INVITE_UNAVAILABLE");

    const existingMembership = await tx
      .select({ id: pairMembership.id })
      .from(pairMembership)
      .where(
        and(
          eq(pairMembership.pairId, invite.pairId),
          eq(pairMembership.slot, "second"),
          isNull(pairMembership.endedAt),
        ),
      )
      .limit(1);
    if (existingMembership[0]) throw new CloserDomainError("INVITE_UNAVAILABLE");

    const firstMembership = await tx
      .select({ id: pairMembership.id, participantId: pairMembership.participantId })
      .from(pairMembership)
      .where(
        and(
          eq(pairMembership.pairId, invite.pairId),
          eq(pairMembership.slot, "first"),
          isNull(pairMembership.endedAt),
        ),
      )
      .limit(1);
    const continuingParticipantId = firstMembership[0]?.participantId;
    const firstMembershipId = firstMembership[0]?.id;
    if (
      !continuingParticipantId ||
      !firstMembershipId ||
      continuingParticipantId === input.participantId
    ) {
      throw new CloserDomainError("INVITE_UNAVAILABLE");
    }

    // Serialize every attempt for this unordered real-Participant pair. This
    // prevents two different unclaimed Pairs being claimed concurrently.
    const lockKey = [continuingParticipantId, input.participantId].sort().join(":");
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${lockKey}))`);

    const duplicatePairs = await tx
      .select({ pairId: pairMembership.pairId })
      .from(pairMembership)
      .innerJoin(
        pairMembershipEra,
        and(eq(pairMembershipEra.pairId, pairMembership.pairId), isNull(pairMembershipEra.endedAt)),
      )
      .where(
        and(
          eq(pairMembership.participantId, continuingParticipantId),
          isNull(pairMembership.endedAt),
          sql`${pairMembership.pairId} <> ${invite.pairId}`,
          sql`exists (
            select 1 from pair_membership duplicate_member
            where duplicate_member.pair_id = ${pairMembership.pairId}
              and duplicate_member.participant_id = ${input.participantId}
              and duplicate_member.ended_at is null
          )`,
        ),
      )
      .limit(1);
    if (duplicatePairs[0]) throw new CloserDomainError("INVITE_UNAVAILABLE");

    const redeemed = await tx
      .update(initialInvite)
      .set({ redeemedAt: new Date(), redeemedByParticipantId: input.participantId })
      .where(
        and(
          eq(initialInvite.id, invite.id),
          isNull(initialInvite.redeemedAt),
          isNull(initialInvite.revokedAt),
          gt(initialInvite.expiresAt, new Date()),
        ),
      )
      .returning({ pairId: initialInvite.pairId });
    if (!redeemed[0]) throw new CloserDomainError("INVITE_UNAVAILABLE");

    const secondMembership = await tx
      .insert(pairMembership)
      .values({
        pairId: invite.pairId,
        participantId: input.participantId,
        slot: "second",
      })
      .returning({ id: pairMembership.id });
    if (!secondMembership[0]) throw new Error("Initial claim did not create a membership.");

    const era = await tx
      .insert(pairMembershipEra)
      .values({
        pairId: invite.pairId,
        firstMembershipId,
        secondMembershipId: secondMembership[0].id,
      })
      .returning({ id: pairMembershipEra.id });
    if (!era[0]) throw new Error("Initial claim did not create a membership era.");

    await tx.update(pair).set({ intendedPersonName: null }).where(eq(pair.id, invite.pairId));
    await tx
      .update(togetherSession)
      .set({ endedAt: new Date() })
      .where(and(eq(togetherSession.pairId, invite.pairId), isNull(togetherSession.endedAt)));

    return { pairId: invite.pairId, membershipEraId: era[0].id };
  });
}

async function findEligibleRejoinTarget(database: Database, participantId: string, pairId: string) {
  const access = await requireActivePairAccess(database, participantId, pairId);
  const targetSlot: "first" | "second" = access.membership.slot === "first" ? "second" : "first";
  const rows = await database
    .select({ membership: pairMembership, targetParticipant: participant, authUser: user })
    .from(pairMembership)
    .innerJoin(participant, eq(pairMembership.participantId, participant.id))
    .innerJoin(user, eq(participant.authUserId, user.id))
    .where(
      and(
        eq(pairMembership.pairId, pairId),
        eq(pairMembership.slot, targetSlot),
        isNull(pairMembership.endedAt),
      ),
    )
    .limit(1);
  const target = rows[0];
  if (!target || !target.authUser.isAnonymous) throw new CloserDomainError("REJOIN_UNAVAILABLE");

  const activeSessions = await database
    .select({ id: session.id })
    .from(session)
    .where(and(eq(session.userId, target.authUser.id), gt(session.expiresAt, new Date())))
    .limit(1);
  if (activeSessions[0]) throw new CloserDomainError("REJOIN_UNAVAILABLE");

  return { access, targetSlot, target };
}

export async function issueRejoinInvite(
  database: Database,
  input: { participantId: string; pairId: string },
) {
  await requireActivePairAccess(database, input.participantId, input.pairId);

  return database.transaction(async (transaction) => {
    const tx = transaction as unknown as Database;
    await tx.execute(sql`select id from "pair" where id = ${input.pairId} for update`);
    const { targetSlot, target } = await findEligibleRejoinTarget(
      tx,
      input.participantId,
      input.pairId,
    );
    const token = createInviteToken();
    const expiresAt = new Date(Date.now() + REJOIN_INVITE_LIFETIME_MS);

    await tx
      .update(rejoinInvite)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(rejoinInvite.pairId, input.pairId),
          eq(rejoinInvite.targetSlot, targetSlot),
          eq(rejoinInvite.targetParticipantId, target.targetParticipant.id),
          isNull(rejoinInvite.revokedAt),
          isNull(rejoinInvite.redeemedAt),
        ),
      );

    await tx.insert(rejoinInvite).values({
      pairId: input.pairId,
      targetSlot,
      targetParticipantId: target.targetParticipant.id,
      tokenHash: hashInviteToken(token),
      expiresAt,
    });

    return {
      token,
      expiresAt,
      targetSlot,
      targetParticipantDisplayName: target.targetParticipant.displayName,
    };
  });
}

export async function revokeRejoinInvites(
  database: Database,
  input: { participantId: string; pairId: string },
) {
  await requireActivePairAccess(database, input.participantId, input.pairId);
  await database.transaction(async (transaction) => {
    const tx = transaction as unknown as Database;
    await tx.execute(sql`select id from "pair" where id = ${input.pairId} for update`);
    const access = await requireActivePairAccess(tx, input.participantId, input.pairId);
    const targetSlot: "first" | "second" = access.membership.slot === "first" ? "second" : "first";
    await tx
      .update(rejoinInvite)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(rejoinInvite.pairId, input.pairId),
          eq(rejoinInvite.targetSlot, targetSlot),
          isNull(rejoinInvite.revokedAt),
          isNull(rejoinInvite.redeemedAt),
        ),
      );
  });
}

export async function getRejoinInviteLanding(database: Database, token: string) {
  const rows = await database
    .select({ targetSlot: rejoinInvite.targetSlot })
    .from(rejoinInvite)
    .innerJoin(pair, eq(pair.id, rejoinInvite.pairId))
    .where(
      and(
        eq(rejoinInvite.tokenHash, hashInviteToken(token)),
        isNull(pair.terminatedAt),
        isNull(rejoinInvite.revokedAt),
        isNull(rejoinInvite.redeemedAt),
        gt(rejoinInvite.expiresAt, new Date()),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function redeemRejoinInvite(
  database: Database,
  input: { token: string; authUserId: string; displayName: string },
) {
  return database.transaction(async (transaction) => {
    const tx = transaction as unknown as Database;
    const inviteRows = await tx
      .select()
      .from(rejoinInvite)
      .where(eq(rejoinInvite.tokenHash, hashInviteToken(input.token)))
      .limit(1);
    const invite = inviteRows[0];
    if (!invite) throw new CloserDomainError("REJOIN_UNAVAILABLE");

    await requireActivePairInTransaction(tx, invite.pairId);

    const targetMembershipRows = await tx
      .select({ membership: pairMembership, targetParticipant: participant })
      .from(pairMembership)
      .innerJoin(participant, eq(pairMembership.participantId, participant.id))
      .where(
        and(
          eq(pairMembership.pairId, invite.pairId),
          eq(pairMembership.slot, invite.targetSlot),
          eq(pairMembership.participantId, invite.targetParticipantId),
          isNull(pairMembership.endedAt),
        ),
      )
      .limit(1);
    if (!targetMembershipRows[0]) throw new CloserDomainError("REJOIN_UNAVAILABLE");

    const existingReplacement = await tx
      .select({ id: participant.id })
      .from(participant)
      .where(eq(participant.authUserId, input.authUserId))
      .limit(1);
    if (existingReplacement[0]) throw new CloserDomainError("REJOIN_UNAVAILABLE");

    const currentEraRows = await tx
      .select()
      .from(pairMembershipEra)
      .where(and(eq(pairMembershipEra.pairId, invite.pairId), isNull(pairMembershipEra.endedAt)))
      .limit(1);
    const currentEra = currentEraRows[0];
    if (
      !currentEra ||
      (currentEra.firstMembershipId !== targetMembershipRows[0].membership.id &&
        currentEra.secondMembershipId !== targetMembershipRows[0].membership.id)
    ) {
      throw new CloserDomainError("REJOIN_UNAVAILABLE");
    }
    const continuingMembershipId =
      currentEra.firstMembershipId === targetMembershipRows[0].membership.id
        ? currentEra.secondMembershipId
        : currentEra.firstMembershipId;
    const insertedReplacement = await tx
      .insert(participant)
      .values({
        authUserId: input.authUserId,
        displayName: normalizeDisplayName(input.displayName),
      })
      .onConflictDoNothing({ target: participant.authUserId })
      .returning({ id: participant.id });
    const replacementParticipant = insertedReplacement[0];
    if (!replacementParticipant) throw new CloserDomainError("REJOIN_UNAVAILABLE");

    const redeemed = await tx
      .update(rejoinInvite)
      .set({ redeemedAt: new Date(), redeemedByParticipantId: replacementParticipant.id })
      .where(
        and(
          eq(rejoinInvite.id, invite.id),
          isNull(rejoinInvite.redeemedAt),
          isNull(rejoinInvite.revokedAt),
          gt(rejoinInvite.expiresAt, new Date()),
        ),
      )
      .returning({ pairId: rejoinInvite.pairId });
    if (!redeemed[0]) throw new CloserDomainError("REJOIN_UNAVAILABLE");

    const endedAt = new Date();
    await tx
      .update(pairMembership)
      .set({ endedAt, endedDisplayName: targetMembershipRows[0].targetParticipant.displayName })
      .where(eq(pairMembership.id, targetMembershipRows[0].membership.id));
    await tx
      .update(pairMembershipEra)
      .set({ endedAt })
      .where(and(eq(pairMembershipEra.id, currentEra.id), isNull(pairMembershipEra.endedAt)));
    await tx
      .update(privateQuestionCandidate)
      .set({ state: "invalidated", resolvedAt: endedAt })
      .where(
        and(
          eq(privateQuestionCandidate.state, "unresolved"),
          sql`exists (
          select 1 from private_conversation old_conversation
          where old_conversation.id = ${privateQuestionCandidate.conversationId}
            and old_conversation.membership_era_id = ${currentEra.id}
        )`,
        ),
      );
    await tx
      .update(togetherSession)
      .set({ endedAt })
      .where(
        and(eq(togetherSession.membershipEraId, currentEra.id), isNull(togetherSession.endedAt)),
      );

    const replacementMembership = await tx
      .insert(pairMembership)
      .values({
        pairId: invite.pairId,
        participantId: replacementParticipant.id,
        slot: invite.targetSlot,
      })
      .returning({ id: pairMembership.id });
    if (!replacementMembership[0])
      throw new Error("Rejoin replacement did not create a membership.");
    const replacementEra = await tx
      .insert(pairMembershipEra)
      .values({
        pairId: invite.pairId,
        firstMembershipId:
          invite.targetSlot === "first" ? replacementMembership[0].id : continuingMembershipId,
        secondMembershipId:
          invite.targetSlot === "second" ? replacementMembership[0].id : continuingMembershipId,
      })
      .returning({ id: pairMembershipEra.id });
    if (!replacementEra[0]) throw new Error("Rejoin replacement did not create a membership era.");
    await tx
      .update(rejoinInvite)
      .set({ revokedAt: endedAt })
      .where(
        and(
          eq(rejoinInvite.pairId, invite.pairId),
          eq(rejoinInvite.targetSlot, invite.targetSlot),
          eq(rejoinInvite.targetParticipantId, invite.targetParticipantId),
          isNull(rejoinInvite.revokedAt),
          isNull(rejoinInvite.redeemedAt),
        ),
      );

    return {
      pairId: invite.pairId,
      membershipEraId: replacementEra[0].id,
      participantId: replacementParticipant.id,
    };
  });
}

export async function getPairForParticipant(
  database: Database,
  participantId: string,
  pairId: string,
) {
  const access = await requireActivePairAccess(database, participantId, pairId);
  const members = await database
    .select({
      participantId: pairMembership.participantId,
      slot: pairMembership.slot,
      displayName: participant.displayName,
    })
    .from(pairMembership)
    .innerJoin(participant, eq(pairMembership.participantId, participant.id))
    .where(and(eq(pairMembership.pairId, pairId), isNull(pairMembership.endedAt)));

  return { pair: access.pair, members };
}

export async function getPairStatusForParticipant(
  database: Database,
  participantId: string,
  pairId: string,
) {
  const access = await requireActivePairAccess(database, participantId, pairId);
  const otherSlot = access.membership.slot === "first" ? "second" : "first";
  const otherMembers = await database
    .select({ displayName: participant.displayName })
    .from(pairMembership)
    .innerJoin(participant, eq(pairMembership.participantId, participant.id))
    .where(
      and(
        eq(pairMembership.pairId, pairId),
        eq(pairMembership.slot, otherSlot),
        isNull(pairMembership.endedAt),
      ),
    )
    .limit(1);

  const otherMember = otherMembers[0];
  if (!otherMember) return { state: "waiting" as const };
  return { state: "connected" as const, otherParticipantDisplayName: otherMember.displayName };
}

async function requireCompletePairAccess(
  database: Database,
  participantId: string,
  pairId: string,
) {
  const access = await requireActivePairAccess(database, participantId, pairId);
  const members = await database
    .select({ participantId: pairMembership.participantId, displayName: participant.displayName })
    .from(pairMembership)
    .innerJoin(participant, eq(pairMembership.participantId, participant.id))
    .where(and(eq(pairMembership.pairId, pairId), isNull(pairMembership.endedAt)));

  if (members.length !== 2) throw new CloserDomainError("PAIR_NOT_READY");
  return { ...access, members };
}

async function getActiveMembershipEra(database: Database, pairId: string) {
  const rows = await database
    .select({ id: pairMembershipEra.id })
    .from(pairMembershipEra)
    .where(and(eq(pairMembershipEra.pairId, pairId), isNull(pairMembershipEra.endedAt)))
    .limit(1);
  return rows[0] ?? null;
}

async function loadTogetherSessionContext(
  database: Database,
  participantId: string,
  pairId: string,
  sessionId: string,
) {
  const access = await requireActivePairAccess(database, participantId, pairId);
  const rows = await database
    .select({ session: togetherSession })
    .from(togetherSession)
    .where(
      and(
        eq(togetherSession.id, sessionId),
        eq(togetherSession.pairId, pairId),
        or(
          sql`exists (
            select 1 from pair_membership_era session_era
            where session_era.id = ${togetherSession.membershipEraId}
              and (${access.membership.id} = session_era.first_membership_id or ${access.membership.id} = session_era.second_membership_id)
          )`,
          and(
            isNull(togetherSession.membershipEraId),
            eq(togetherSession.startedByParticipantId, participantId),
          ),
        ),
      ),
    )
    .limit(1);
  const result = rows[0];
  if (!result) throw new CloserDomainError("TOGETHER_SESSION_NOT_FOUND");
  return { ...access, session: result.session };
}

async function requireMutableTogetherSessionInTransaction(
  tx: Database,
  input: { participantId: string; pairId: string; sessionId: string },
) {
  await tx.execute(sql`select id from "pair" where id = ${input.pairId} for update`);
  const context = await loadTogetherSessionContext(
    tx,
    input.participantId,
    input.pairId,
    input.sessionId,
  );
  const activeEra = await getActiveMembershipEra(tx, input.pairId);
  if (context.session.membershipEraId !== (activeEra?.id ?? null)) {
    throw new CloserDomainError("TOGETHER_SESSION_ENDED");
  }
  return context;
}

async function eligibleTogetherQuestions(
  database: Database,
  input: { relationshipType: RelationshipType; category: QuestionCategory },
) {
  return database
    .select({
      id: question.id,
      questionRevisionId: questionRevision.id,
      text: questionRevision.text,
      category: questionRevision.category,
      relationshipFit: questionRevision.relationshipFit,
      modeFit: questionRevision.modeFit,
      intensity: questionRevision.intensity,
    })
    .from(question)
    .innerJoin(questionRevision, eq(question.currentRevisionId, questionRevision.id))
    .where(
      and(
        eq(question.isActive, true),
        eq(questionRevision.category, input.category),
        inArray(questionRevision.relationshipFit, ["both", input.relationshipType]),
        inArray(questionRevision.modeFit, ["both", "together"]),
        isNull(questionRevision.withdrawnAt),
      ),
    );
}

export async function listEligibleTogetherQuestions(
  database: Database,
  input: { participantId: string; pairId: string; category: string },
) {
  const access = await requireActivePairAccess(database, input.participantId, input.pairId);
  assertCategoryForPair(access, input.category);
  return eligibleTogetherQuestions(database, {
    relationshipType: access.pair.relationshipType,
    category: input.category as QuestionCategory,
  });
}

function deterministicTogetherQuestionRank(selectionSeed: string, questionId: string) {
  return createHash("sha256")
    .update(`closer:together:${selectionSeed}:${questionId}`)
    .digest("hex");
}

function encodeTogetherQuestionCursor(questionId: string) {
  return Buffer.from(questionId, "utf8").toString("base64url");
}

function decodeTogetherQuestionCursor(cursor: string | undefined) {
  if (!cursor) return null;
  try {
    const questionId = Buffer.from(cursor, "base64url").toString("utf8");
    return isUuid(questionId) ? questionId : null;
  } catch {
    return null;
  }
}

async function loadTogetherQuestionPage(
  database: Database,
  input: {
    sessionId?: string;
    selectionSeed: string;
    relationshipType: RelationshipType;
    category: QuestionCategory;
    band: TogetherQuestionBand;
    cursor?: string;
  },
): Promise<TogetherQuestionPage> {
  const cursorQuestionId = decodeTogetherQuestionCursor(input.cursor);
  if (input.cursor && !cursorQuestionId) throw new CloserDomainError("TOGETHER_ACTION_INVALID");

  const canonicalRank = sql<string>`encode(digest(${`closer:together:${input.selectionSeed}:`} || ${question.id}::text, 'sha256'), 'hex')`;
  const cursorRank = cursorQuestionId
    ? deterministicTogetherQuestionRank(input.selectionSeed, cursorQuestionId)
    : null;
  const cursorCondition =
    cursorQuestionId && cursorRank
      ? or(
          gt(canonicalRank, cursorRank),
          and(eq(canonicalRank, cursorRank), gt(question.id, cursorQuestionId)),
        )
      : undefined;
  const shownCondition = input.sessionId
    ? sql`not exists (
        select 1
        from together_session_question shown_question
        where shown_question.session_id = ${input.sessionId}
          and shown_question.question_id = ${question.id}
      )`
    : undefined;
  const rows = await database
    .select({
      questionId: question.id,
      questionRevisionId: questionRevision.id,
      text: questionRevision.text,
    })
    .from(question)
    .innerJoin(questionRevision, eq(question.currentRevisionId, questionRevision.id))
    .where(
      and(
        eq(question.isActive, true),
        eq(questionRevision.category, input.category),
        inArray(questionRevision.relationshipFit, ["both", input.relationshipType]),
        inArray(questionRevision.modeFit, ["both", "together"]),
        eq(questionRevision.intensity, input.band),
        isNull(questionRevision.withdrawnAt),
        shownCondition,
        cursorCondition,
      ),
    )
    .orderBy(asc(canonicalRank), asc(question.id))
    .limit(TOGETHER_QUESTION_PAGE_SIZE + 1);
  const hasMore = rows.length > TOGETHER_QUESTION_PAGE_SIZE;
  const items = rows.slice(0, TOGETHER_QUESTION_PAGE_SIZE);
  const lastQuestion = items.at(-1);
  return {
    items,
    hasMore,
    nextCursor:
      hasMore && lastQuestion ? encodeTogetherQuestionCursor(lastQuestion.questionId) : null,
  };
}

async function loadCompletedTogetherNextTransitionCount(database: Database, sessionId: string) {
  return (
    await database
      .select({ id: togetherSessionQuestion.id })
      .from(togetherSessionQuestion)
      .where(
        and(
          eq(togetherSessionQuestion.sessionId, sessionId),
          isNull(togetherSessionQuestion.skippedAt),
          sql`${togetherSessionQuestion.advancedAt} is not null`,
        ),
      )
  ).length;
}

async function requireActiveTogetherSessionForPage(
  database: Database,
  input: { participantId: string; pairId: string; sessionId: string },
) {
  const context = await loadTogetherSessionContext(
    database,
    input.participantId,
    input.pairId,
    input.sessionId,
  );
  if (context.session.endedAt) throw new CloserDomainError("TOGETHER_SESSION_ENDED");
  const activeEra = await getActiveMembershipEra(database, input.pairId);
  if (context.session.membershipEraId !== (activeEra?.id ?? null)) {
    throw new CloserDomainError("TOGETHER_SESSION_ENDED");
  }
  return context;
}

export async function getTogetherQuestionPageForParticipant(
  database: Database,
  input: {
    participantId: string;
    pairId: string;
    sessionId: string;
    band: string;
    cursor?: string;
  },
) {
  if (!togetherQuestionBands.includes(input.band as TogetherQuestionBand)) {
    throw new CloserDomainError("TOGETHER_ACTION_INVALID");
  }
  const context = await requireActiveTogetherSessionForPage(database, input);
  return loadTogetherQuestionPage(database, {
    sessionId: context.session.id,
    selectionSeed: context.session.selectionSeed,
    relationshipType: context.pair.relationshipType,
    category: context.session.category,
    band: input.band as TogetherQuestionBand,
    cursor: input.cursor,
  });
}

async function nextTogetherQuestion(
  database: Database,
  input: {
    sessionId?: string;
    selectionSeed: string;
    relationshipType: RelationshipType;
    category: QuestionCategory;
    completedNextTransitions?: number;
  },
) {
  for (const band of togetherIntensityFallback(input.completedNextTransitions ?? 0)) {
    const page = await loadTogetherQuestionPage(database, { ...input, band });
    const candidate = page.items[0];
    if (candidate) return candidate;
  }
  return null;
}

async function currentTogetherQuestion(database: Database, sessionId: string) {
  const rows = await database
    .select({ card: togetherSessionQuestion, revision: questionRevision })
    .from(togetherSessionQuestion)
    .innerJoin(
      questionRevision,
      eq(togetherSessionQuestion.questionRevisionId, questionRevision.id),
    )
    .where(
      and(
        eq(togetherSessionQuestion.sessionId, sessionId),
        isNull(togetherSessionQuestion.advancedAt),
      ),
    )
    .orderBy(asc(togetherSessionQuestion.position))
    .limit(1);
  return rows[0] ?? null;
}

export async function startTogetherSession(
  database: Database,
  input: {
    participantId: string;
    pairId: string;
    category: string;
    clientRequestId?: string;
    selectionSeed?: string;
  },
) {
  const access = await requireActivePairAccess(database, input.participantId, input.pairId);
  if (input.clientRequestId && !isUuid(input.clientRequestId))
    throw new CloserDomainError("TOGETHER_ACTION_INVALID");
  assertCategoryForPair(access, input.category);
  const category = input.category as QuestionCategory;
  const selectionSeed = normalizeTogetherSelectionSeed(input.selectionSeed);

  return database.transaction(async (transaction) => {
    const tx = transaction as unknown as Database;
    await tx.execute(sql`select id from "pair" where id = ${input.pairId} for update`);
    const currentAccess = await requireActivePairAccess(tx, input.participantId, input.pairId);
    const activeEra = await getActiveMembershipEra(tx, input.pairId);

    if (input.clientRequestId) {
      const existing = await tx
        .select({ id: togetherSession.id })
        .from(togetherSession)
        .where(
          and(
            eq(togetherSession.pairId, input.pairId),
            eq(togetherSession.startedByParticipantId, input.participantId),
            eq(togetherSession.startRequestId, input.clientRequestId),
          ),
        )
        .limit(1);
      if (existing[0]) {
        const current = await currentTogetherQuestion(tx, existing[0].id);
        if (!current) throw new CloserDomainError("TOGETHER_SESSION_EXHAUSTED");
        return {
          sessionId: existing[0].id,
          questionId: current.card.questionId,
          questionRevisionId: current.card.questionRevisionId,
        };
      }
    }

    const nextQuestion = await nextTogetherQuestion(tx, {
      relationshipType: currentAccess.pair.relationshipType,
      category,
      selectionSeed,
    });
    if (!nextQuestion) throw new CloserDomainError("QUESTION_UNAVAILABLE");

    const inserted = await tx
      .insert(togetherSession)
      .values({
        pairId: input.pairId,
        membershipEraId: activeEra?.id,
        category,
        startedByParticipantId: input.participantId,
        startRequestId: input.clientRequestId,
        selectionSeed,
      })
      .returning({ id: togetherSession.id });
    const session = inserted[0];
    if (!session) throw new Error("Together session creation did not return a session.");

    await tx.insert(togetherSessionQuestion).values({
      sessionId: session.id,
      questionId: nextQuestion.questionId,
      questionRevisionId: nextQuestion.questionRevisionId,
      position: 1,
    });
    return {
      sessionId: session.id,
      questionId: nextQuestion.questionId,
      questionRevisionId: nextQuestion.questionRevisionId,
    };
  });
}

export async function getTogetherSessionForParticipant(
  database: Database,
  input: { participantId: string; pairId: string; sessionId: string },
) {
  const context = await loadTogetherSessionContext(
    database,
    input.participantId,
    input.pairId,
    input.sessionId,
  );
  const current = await currentTogetherQuestion(database, input.sessionId);
  return {
    id: context.session.id,
    pairId: context.session.pairId,
    relationshipType: context.pair.relationshipType,
    category: context.session.category,
    startedByParticipantId: context.session.startedByParticipantId,
    startedAt: context.session.startedAt.toISOString(),
    endedAt: context.session.endedAt?.toISOString() ?? null,
    exhausted: current === null,
    question: current
      ? {
          id: current.card.questionId,
          questionRevisionId: current.card.questionRevisionId,
          text: current.revision.text,
          category: current.revision.category,
          intensity: current.revision.intensity,
          position: current.card.position,
          liked: current.card.likedAt !== null,
        }
      : null,
  };
}

function emptyTogetherQuestionPage(): TogetherQuestionPage {
  return { items: [], nextCursor: null, hasMore: false };
}

function emptyTogetherQuestionPools(): TogetherQuestionPools {
  return {
    light: emptyTogetherQuestionPage(),
    medium: emptyTogetherQuestionPage(),
    deep: emptyTogetherQuestionPage(),
  };
}

export async function getTogetherSessionPlaybackForParticipant(
  database: Database,
  input: { participantId: string; pairId: string; sessionId: string },
) {
  const context = await loadTogetherSessionContext(
    database,
    input.participantId,
    input.pairId,
    input.sessionId,
  );
  const [current, activeEra] = await Promise.all([
    currentTogetherQuestion(database, input.sessionId),
    getActiveMembershipEra(database, input.pairId),
  ]);
  const sessionIsActive =
    !context.session.endedAt && context.session.membershipEraId === (activeEra?.id ?? null);
  const completedNextTransitions = current
    ? await loadCompletedTogetherNextTransitionCount(database, input.sessionId)
    : 0;
  const pages =
    current && sessionIsActive
      ? (Object.fromEntries(
          await Promise.all(
            togetherQuestionBands.map(async (band) => [
              band,
              await loadTogetherQuestionPage(database, {
                sessionId: context.session.id,
                selectionSeed: context.session.selectionSeed,
                relationshipType: context.pair.relationshipType,
                category: context.session.category,
                band,
              }),
            ]),
          ),
        ) as TogetherQuestionPools)
      : emptyTogetherQuestionPools();

  return {
    id: context.session.id,
    pairId: context.session.pairId,
    relationshipType: context.pair.relationshipType,
    category: context.session.category,
    endedAt: context.session.endedAt?.toISOString() ?? null,
    exhausted: current === null || !sessionIsActive,
    completedNextTransitions,
    question: current
      ? {
          questionId: current.card.questionId,
          questionRevisionId: current.card.questionRevisionId,
          text: current.revision.text,
          position: current.card.position,
          liked: current.card.likedAt !== null,
        }
      : null,
    pages,
  };
}

export async function advanceTogetherSession(
  database: Database,
  input: {
    participantId: string;
    pairId: string;
    sessionId: string;
    action: "next" | "skip";
    clientRequestId?: string;
    currentQuestionId?: string;
    nextQuestionId?: string;
    nextQuestionRevisionId?: string;
  },
) {
  if (input.clientRequestId && !isUuid(input.clientRequestId))
    throw new CloserDomainError("TOGETHER_ACTION_INVALID");
  if (
    (input.nextQuestionId === undefined) !== (input.nextQuestionRevisionId === undefined) ||
    (input.nextQuestionId !== undefined &&
      (!isUuid(input.nextQuestionId) || !isUuid(input.nextQuestionRevisionId!)))
  ) {
    throw new CloserDomainError("TOGETHER_ACTION_INVALID");
  }
  return database.transaction(async (transaction) => {
    const tx = transaction as unknown as Database;
    const mutableContext = await requireMutableTogetherSessionInTransaction(tx, input);
    const sessionRows = await tx
      .select()
      .from(togetherSession)
      .where(eq(togetherSession.id, input.sessionId))
      .for("update");
    const session = sessionRows[0];
    if (!session || session.pairId !== input.pairId) {
      throw new CloserDomainError("TOGETHER_SESSION_NOT_FOUND");
    }
    if (session.endedAt) throw new CloserDomainError("TOGETHER_SESSION_ENDED");

    if (input.clientRequestId) {
      const previous = await tx
        .select({ id: togetherSessionQuestion.id })
        .from(togetherSessionQuestion)
        .where(
          and(
            eq(togetherSessionQuestion.sessionId, input.sessionId),
            eq(togetherSessionQuestion.advanceRequestId, input.clientRequestId),
          ),
        )
        .limit(1);
      if (previous[0]) {
        const current = await currentTogetherQuestion(tx, input.sessionId);
        const completedNextTransitions = await loadCompletedTogetherNextTransitionCount(
          tx,
          input.sessionId,
        );
        return current
          ? {
              kind: "QUESTION" as const,
              sessionId: input.sessionId,
              questionId: current.card.questionId,
              questionRevisionId: current.card.questionRevisionId,
              position: current.card.position,
              completedNextTransitions,
            }
          : { kind: "EXHAUSTED" as const, sessionId: input.sessionId, completedNextTransitions };
      }
    }

    const current = await currentTogetherQuestion(tx, input.sessionId);
    if (!current) return { kind: "EXHAUSTED" as const, sessionId: input.sessionId };
    if (input.currentQuestionId && current.card.questionId !== input.currentQuestionId) {
      throw new CloserDomainError("TOGETHER_ACTION_INVALID");
    }

    const now = new Date();
    await tx
      .update(togetherSessionQuestion)
      .set({
        skippedAt: input.action === "skip" ? now : current.card.skippedAt,
        advancedAt: now,
        advanceRequestId: input.clientRequestId,
      })
      .where(eq(togetherSessionQuestion.id, current.card.id));

    const completedNextTransitions = await loadCompletedTogetherNextTransitionCount(
      tx,
      input.sessionId,
    );
    const nextQuestion = await nextTogetherQuestion(tx, {
      sessionId: input.sessionId,
      selectionSeed: session.selectionSeed,
      relationshipType: mutableContext.pair.relationshipType,
      category: session.category,
      completedNextTransitions,
    });
    if (!nextQuestion)
      return { kind: "EXHAUSTED" as const, sessionId: input.sessionId, completedNextTransitions };
    if (
      input.nextQuestionId &&
      (nextQuestion.questionId !== input.nextQuestionId ||
        nextQuestion.questionRevisionId !== input.nextQuestionRevisionId)
    ) {
      throw new CloserDomainError("TOGETHER_ACTION_INVALID");
    }

    await tx.insert(togetherSessionQuestion).values({
      sessionId: input.sessionId,
      questionId: nextQuestion.questionId,
      questionRevisionId: nextQuestion.questionRevisionId,
      position: current.card.position + 1,
    });
    return {
      kind: "QUESTION" as const,
      sessionId: input.sessionId,
      questionId: nextQuestion.questionId,
      questionRevisionId: nextQuestion.questionRevisionId,
      position: current.card.position + 1,
      completedNextTransitions,
    };
  });
}

export async function setTogetherSessionLike(
  database: Database,
  input: {
    participantId: string;
    pairId: string;
    sessionId: string;
    liked: boolean;
    currentQuestionId?: string;
  },
) {
  await database.transaction(async (transaction) => {
    const tx = transaction as unknown as Database;
    await requireMutableTogetherSessionInTransaction(tx, input);
    const sessionRows = await tx
      .select({ endedAt: togetherSession.endedAt })
      .from(togetherSession)
      .where(eq(togetherSession.id, input.sessionId))
      .for("update");
    const session = sessionRows[0];
    if (!session) throw new CloserDomainError("TOGETHER_SESSION_NOT_FOUND");
    if (session.endedAt) throw new CloserDomainError("TOGETHER_SESSION_ENDED");
    const current = await currentTogetherQuestion(tx, input.sessionId);
    if (!current) throw new CloserDomainError("TOGETHER_SESSION_EXHAUSTED");
    if (input.currentQuestionId && current.card.questionId !== input.currentQuestionId) {
      throw new CloserDomainError("TOGETHER_ACTION_INVALID");
    }
    await tx
      .update(togetherSessionQuestion)
      .set({ likedAt: input.liked ? new Date() : null })
      .where(eq(togetherSessionQuestion.id, current.card.id));
  });
  return getTogetherSessionForParticipant(database, input);
}

export async function endTogetherSession(
  database: Database,
  input: { participantId: string; pairId: string; sessionId: string },
) {
  await database.transaction(async (transaction) => {
    const tx = transaction as unknown as Database;
    await requireMutableTogetherSessionInTransaction(tx, input);
    const sessionRows = await tx
      .select({ endedAt: togetherSession.endedAt })
      .from(togetherSession)
      .where(eq(togetherSession.id, input.sessionId))
      .for("update");
    const session = sessionRows[0];
    if (!session) throw new CloserDomainError("TOGETHER_SESSION_NOT_FOUND");
    if (!session.endedAt) {
      await tx
        .update(togetherSession)
        .set({ endedAt: new Date() })
        .where(eq(togetherSession.id, input.sessionId));
    }
  });
  return getTogetherSessionForParticipant(database, input);
}

async function loadPrivateRoundContext(
  database: Database,
  participantId: string,
  pairId: string,
  roundId: string,
) {
  const access = await requireActivePairAccess(database, participantId, pairId);
  const rows = await database
    .select({
      round: privateRound,
      revision: questionRevision,
      conversation: privateConversation,
      membershipEra: pairMembershipEra,
    })
    .from(privateRound)
    .innerJoin(
      privateConversation,
      and(
        eq(privateRound.conversationId, privateConversation.id),
        eq(privateRound.pairId, privateConversation.pairId),
      ),
    )
    .innerJoin(pairMembershipEra, eq(privateConversation.membershipEraId, pairMembershipEra.id))
    .innerJoin(questionRevision, eq(privateRound.questionRevisionId, questionRevision.id))
    .where(
      and(
        eq(privateRound.id, roundId),
        eq(privateRound.pairId, pairId),
        or(
          eq(pairMembershipEra.firstMembershipId, access.membership.id),
          eq(pairMembershipEra.secondMembershipId, access.membership.id),
        ),
      ),
    )
    .limit(1);
  const result = rows[0];
  if (!result) throw new CloserDomainError("ROUND_NOT_FOUND");
  const members = await database
    .select({
      id: pairMembership.id,
      participantId: pairMembership.participantId,
      displayName: sql<string>`coalesce(${pairMembership.endedDisplayName}, ${participant.displayName})`,
    })
    .from(pairMembership)
    .innerJoin(participant, eq(pairMembership.participantId, participant.id))
    .where(
      inArray(pairMembership.id, [
        result.membershipEra.firstMembershipId,
        result.membershipEra.secondMembershipId,
      ]),
    );
  return { ...access, ...result, members };
}

async function requireMutablePrivateRoundInTransaction(
  tx: Database,
  input: { participantId: string; pairId: string; roundId: string },
) {
  await tx.execute(sql`select id from "pair" where id = ${input.pairId} for update`);
  const context = await loadPrivateRoundContext(
    tx,
    input.participantId,
    input.pairId,
    input.roundId,
  );
  if (context.membershipEra.endedAt) throw new CloserDomainError("ROUND_NOT_FOUND");
  return context;
}

function viewerRoundState(
  answerCount: number,
  hasViewerAnswer: boolean,
  revealViewedAt: Date | null,
  isDeclined: boolean,
): "YOUR_TURN" | "WAITING" | "REVEAL_READY" | "REVEAL_VIEWED" | "DECLINED" {
  if (isDeclined) return "DECLINED";
  if (answerCount === 2) return revealViewedAt ? "REVEAL_VIEWED" : "REVEAL_READY";
  return hasViewerAnswer ? "WAITING" : "YOUR_TURN";
}

export async function listEligiblePrivateQuestions(
  database: Database,
  input: { participantId: string; pairId: string; category: string },
) {
  assertQuestionCategory(input.category);
  const access = await requireCompletePairAccess(database, input.participantId, input.pairId);
  const relationshipCategory =
    access.pair.relationshipType === "partner" ? "relationship" : "friendship";
  if (input.category === "relationship" || input.category === "friendship") {
    if (input.category !== relationshipCategory)
      throw new CloserDomainError("QUESTION_UNAVAILABLE");
  }

  const eligibleQuestions = await database
    .select({
      id: question.id,
      questionRevisionId: questionRevision.id,
      text: questionRevision.text,
      category: questionRevision.category,
      relationshipFit: questionRevision.relationshipFit,
      modeFit: questionRevision.modeFit,
      intensity: questionRevision.intensity,
    })
    .from(question)
    .innerJoin(questionRevision, eq(question.currentRevisionId, questionRevision.id))
    .where(
      and(
        eq(question.isActive, true),
        eq(questionRevision.category, input.category),
        inArray(questionRevision.relationshipFit, ["both", access.pair.relationshipType]),
        inArray(questionRevision.modeFit, ["both", "private"]),
        isNull(questionRevision.withdrawnAt),
      ),
    );

  // This is deliberately preference-free: a pair sees every compatible question again
  // only after it has exhausted the compatible questions it has not used before.
  const usedRows = await database
    .select({ questionId: privateRound.questionId })
    .from(privateRound)
    .where(eq(privateRound.pairId, input.pairId));
  const usedQuestionIds = new Set(usedRows.map((row) => row.questionId));

  return eligibleQuestions.toSorted((left, right) => {
    const usageDifference =
      Number(usedQuestionIds.has(left.id)) - Number(usedQuestionIds.has(right.id));
    return usageDifference || left.id.localeCompare(right.id);
  });
}

function assertCategoryForPair(
  access: { pair: { relationshipType: RelationshipType } },
  category: string,
) {
  assertQuestionCategory(category);
  const relationshipCategory =
    access.pair.relationshipType === "partner" ? "relationship" : "friendship";
  if (
    (category === "relationship" || category === "friendship") &&
    category !== relationshipCategory
  ) {
    throw new CloserDomainError("QUESTION_UNAVAILABLE");
  }
}

async function eligiblePrivateQuestions(
  database: Database,
  input: { relationshipType: RelationshipType; category: QuestionCategory },
) {
  return database
    .select({
      id: question.id,
      questionRevisionId: questionRevision.id,
      text: questionRevision.text,
      category: questionRevision.category,
      relationshipFit: questionRevision.relationshipFit,
      modeFit: questionRevision.modeFit,
      intensity: questionRevision.intensity,
    })
    .from(question)
    .innerJoin(questionRevision, eq(question.currentRevisionId, questionRevision.id))
    .where(
      and(
        eq(question.isActive, true),
        eq(questionRevision.category, input.category),
        inArray(questionRevision.relationshipFit, ["both", input.relationshipType]),
        inArray(questionRevision.modeFit, ["both", "private"]),
        isNull(questionRevision.withdrawnAt),
      ),
    );
}

async function latestRoundForConversation(database: Database, conversationId: string) {
  const rows = await database
    .select({
      id: privateRound.id,
      questionId: privateRound.questionId,
      questionRevisionId: privateRound.questionRevisionId,
      questionNumber: privateRound.questionNumber,
    })
    .from(privateRound)
    .where(eq(privateRound.conversationId, conversationId))
    .orderBy(desc(privateRound.questionNumber))
    .limit(1);
  return rows[0] ?? null;
}

async function answerCountForRound(database: Database, roundId: string) {
  const rows = await database
    .select({ id: privateAnswer.id })
    .from(privateAnswer)
    .where(eq(privateAnswer.roundId, roundId));
  return rows.length;
}

async function privateRoundIsUnresolved(database: Database, roundId: string) {
  const round = await database
    .select({ status: privateRound.status })
    .from(privateRound)
    .where(eq(privateRound.id, roundId))
    .limit(1);
  if (!round[0] || round[0].status === "declined") return false;
  if ((await answerCountForRound(database, roundId)) < 2) return true;
  const revealViews = await database
    .select({ id: privateRevealView.id })
    .from(privateRevealView)
    .where(eq(privateRevealView.roundId, roundId));
  return revealViews.length < 2;
}

function deterministicPrivateQuestionRank(seed: string, questionId: string) {
  return createHash("sha256").update(`${seed}:${questionId}`).digest("hex");
}

async function consumedPrivateQuestionIds(database: Database, conversationId: string) {
  const asked = await database
    .select({ questionId: privateRound.questionId })
    .from(privateRound)
    .where(eq(privateRound.conversationId, conversationId));
  const skipped = await database
    .select({ questionId: privateQuestionCandidate.questionId })
    .from(privateQuestionCandidate)
    .where(
      and(
        eq(privateQuestionCandidate.conversationId, conversationId),
        eq(privateQuestionCandidate.state, "skipped"),
      ),
    );
  return new Set([...asked, ...skipped].map((item) => item.questionId));
}

async function mutuallyCompletedPrivateRoundCount(database: Database, conversationId: string) {
  const rounds = await database
    .select({ id: privateRound.id, status: privateRound.status })
    .from(privateRound)
    .where(eq(privateRound.conversationId, conversationId));
  let completed = 0;
  for (const round of rounds) {
    if (round.status === "declined") continue;
    if ((await answerCountForRound(database, round.id)) !== 2) continue;
    const revealViews = await database
      .select({ id: privateRevealView.id })
      .from(privateRevealView)
      .where(eq(privateRevealView.roundId, round.id));
    if (revealViews.length === 2) completed += 1;
  }
  return completed;
}

export function privateIntensityFallback(completedRoundCount: number): QuestionIntensity[] {
  if (completedRoundCount >= 4) return ["deep", "medium", "light"];
  if (completedRoundCount >= 2) return ["medium", "light", "deep"];
  return ["light", "medium", "deep"];
}

async function selectPrivateQuestionCandidate(
  database: Database,
  conversation: typeof privateConversation.$inferSelect,
  relationshipType: RelationshipType,
) {
  const latestRound = await latestRoundForConversation(database, conversation.id);
  if (latestRound && (await privateRoundIsUnresolved(database, latestRound.id))) return null;
  const current = await database
    .select({ candidate: privateQuestionCandidate, revision: questionRevision })
    .from(privateQuestionCandidate)
    .innerJoin(
      questionRevision,
      eq(privateQuestionCandidate.questionRevisionId, questionRevision.id),
    )
    .where(
      and(
        eq(privateQuestionCandidate.conversationId, conversation.id),
        eq(privateQuestionCandidate.state, "unresolved"),
      ),
    )
    .limit(1);
  if (current[0] && !current[0].revision.withdrawnAt) return current[0];
  if (current[0]) {
    await database
      .update(privateQuestionCandidate)
      .set({ state: "invalidated", resolvedAt: new Date() })
      .where(
        and(
          eq(privateQuestionCandidate.id, current[0].candidate.id),
          eq(privateQuestionCandidate.state, "unresolved"),
        ),
      );
  }

  const eligible = await eligiblePrivateQuestions(database, {
    relationshipType,
    category: conversation.category,
  });
  const usedQuestionIds = await consumedPrivateQuestionIds(database, conversation.id);
  const unused = eligible.filter((candidate) => !usedQuestionIds.has(candidate.id));
  if (!unused.length) return null;

  const preferredIntensities = privateIntensityFallback(
    await mutuallyCompletedPrivateRoundCount(database, conversation.id),
  );
  const preferred = preferredIntensities.find((intensity) =>
    unused.some((candidate) => candidate.intensity === intensity),
  );
  const selected = unused
    .filter((candidate) => candidate.intensity === preferred)
    .toSorted(
      (left, right) =>
        deterministicPrivateQuestionRank(conversation.selectionSeed, left.id).localeCompare(
          deterministicPrivateQuestionRank(conversation.selectionSeed, right.id),
        ) || left.id.localeCompare(right.id),
    )[0];
  if (!selected) return null;

  const inserted = await database
    .insert(privateQuestionCandidate)
    .values({
      conversationId: conversation.id,
      questionId: selected.id,
      questionRevisionId: selected.questionRevisionId,
    })
    .onConflictDoNothing()
    .returning({ id: privateQuestionCandidate.id });
  const candidateId = inserted[0]?.id;
  if (!candidateId) {
    const resolved = await database
      .select({ candidate: privateQuestionCandidate, revision: questionRevision })
      .from(privateQuestionCandidate)
      .innerJoin(
        questionRevision,
        eq(privateQuestionCandidate.questionRevisionId, questionRevision.id),
      )
      .where(
        and(
          eq(privateQuestionCandidate.conversationId, conversation.id),
          eq(privateQuestionCandidate.state, "unresolved"),
        ),
      )
      .limit(1);
    if (resolved[0] && !resolved[0].revision.withdrawnAt) return resolved[0];
    return null;
  }
  const resolved = await database
    .select({ candidate: privateQuestionCandidate, revision: questionRevision })
    .from(privateQuestionCandidate)
    .innerJoin(
      questionRevision,
      eq(privateQuestionCandidate.questionRevisionId, questionRevision.id),
    )
    .where(eq(privateQuestionCandidate.id, candidateId))
    .limit(1);
  return resolved[0] ?? null;
}

async function lockPairAndFindConversation(
  database: Database,
  input: {
    pairId: string;
    category: QuestionCategory;
    participantId: string;
    membershipEraId: string;
  },
) {
  await database.execute(sql`select id from "pair" where id = ${input.pairId} for update`);
  const existing = await database
    .select()
    .from(privateConversation)
    .where(
      and(
        eq(privateConversation.pairId, input.pairId),
        eq(privateConversation.category, input.category),
        eq(privateConversation.membershipEraId, input.membershipEraId),
      ),
    )
    .limit(1);
  if (existing[0]) return existing[0];

  const inserted = await database
    .insert(privateConversation)
    .values({
      pairId: input.pairId,
      category: input.category,
      createdByParticipantId: input.participantId,
      membershipEraId: input.membershipEraId,
    })
    .onConflictDoNothing()
    .returning();
  if (inserted[0]) return inserted[0];

  const resolved = await database
    .select()
    .from(privateConversation)
    .where(
      and(
        eq(privateConversation.pairId, input.pairId),
        eq(privateConversation.category, input.category),
        eq(privateConversation.membershipEraId, input.membershipEraId),
      ),
    )
    .limit(1);
  if (!resolved[0]) throw new Error("Private conversation creation did not resolve.");
  return resolved[0];
}

async function projectPrivateConversationForParticipant(
  database: Database,
  input: { participantId: string; pairId: string; conversationId: string },
  access: Awaited<ReturnType<typeof requireCompletePairAccess>>,
) {
  const rows = await database
    .select({ conversation: privateConversation, era: pairMembershipEra })
    .from(privateConversation)
    .innerJoin(pairMembershipEra, eq(privateConversation.membershipEraId, pairMembershipEra.id))
    .where(
      and(
        eq(privateConversation.id, input.conversationId),
        eq(privateConversation.pairId, input.pairId),
        isNull(pairMembershipEra.endedAt),
        or(
          eq(pairMembershipEra.firstMembershipId, access.membership.id),
          eq(pairMembershipEra.secondMembershipId, access.membership.id),
        ),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) throw new CloserDomainError("CONVERSATION_NOT_FOUND");

  const creator = access.members.find(
    (member) => member.participantId === row.conversation.createdByParticipantId,
  );
  const otherParticipant = access.members.find(
    (member) => member.participantId !== input.participantId,
  );
  if (!creator || !otherParticipant) throw new CloserDomainError("CONVERSATION_NOT_FOUND");
  const role =
    row.conversation.createdByParticipantId === input.participantId ? "creator" : "non-creator";
  const base = {
    id: row.conversation.id,
    conversationId: row.conversation.id,
    pairId: row.conversation.pairId,
    category: row.conversation.category,
    creator: { participantId: creator.participantId, displayName: creator.displayName },
    role,
    otherParticipantDisplayName: otherParticipant.displayName,
  } as const;

  const currentRound = await database
    .select({ round: privateRound, revision: questionRevision })
    .from(privateRound)
    .innerJoin(questionRevision, eq(privateRound.questionRevisionId, questionRevision.id))
    .where(eq(privateRound.conversationId, row.conversation.id))
    .orderBy(desc(privateRound.questionNumber))
    .limit(1);
  if (currentRound[0] && currentRound[0].round.status !== "declined") {
    const [answers, revealViews] = await Promise.all([
      database
        .select({ participantId: privateAnswer.participantId })
        .from(privateAnswer)
        .where(eq(privateAnswer.roundId, currentRound[0].round.id)),
      database
        .select({ participantId: privateRevealView.participantId })
        .from(privateRevealView)
        .where(eq(privateRevealView.roundId, currentRound[0].round.id)),
    ]);
    const isUnresolved = answers.length < 2 || revealViews.length < 2;
    if (isUnresolved) {
      return {
        ...base,
        state: "CURRENT_ROUND" as const,
        roundId: currentRound[0].round.id,
        currentRound: {
          id: currentRound[0].round.id,
          question: {
            id: currentRound[0].round.questionId,
            questionRevisionId: currentRound[0].round.questionRevisionId,
            text: currentRound[0].revision.text,
            category: currentRound[0].revision.category,
            intensity: currentRound[0].revision.intensity,
          },
          state: viewerRoundState(
            answers.length,
            answers.some((answer) => answer.participantId === input.participantId),
            revealViews.some((view) => view.participantId === input.participantId)
              ? new Date()
              : null,
            false,
          ),
          otherRevealViewed: revealViews.some((view) => view.participantId !== input.participantId),
        },
      };
    }
  }

  const unresolvedCandidate = await database
    .select({ candidate: privateQuestionCandidate, revision: questionRevision })
    .from(privateQuestionCandidate)
    .innerJoin(
      questionRevision,
      eq(privateQuestionCandidate.questionRevisionId, questionRevision.id),
    )
    .where(
      and(
        eq(privateQuestionCandidate.conversationId, row.conversation.id),
        eq(privateQuestionCandidate.state, "unresolved"),
        isNull(questionRevision.withdrawnAt),
      ),
    )
    .limit(1);
  if (role === "creator" && unresolvedCandidate[0]) {
    return {
      ...base,
      state: "CANDIDATE" as const,
      candidate: {
        id: unresolvedCandidate[0].candidate.id,
        liked: unresolvedCandidate[0].candidate.liked,
        question: {
          id: unresolvedCandidate[0].candidate.questionId,
          questionRevisionId: unresolvedCandidate[0].candidate.questionRevisionId,
          text: unresolvedCandidate[0].revision.text,
          category: unresolvedCandidate[0].revision.category,
          intensity: unresolvedCandidate[0].revision.intensity,
        },
      },
    };
  }
  const eligible = await eligiblePrivateQuestions(database, {
    relationshipType: access.pair.relationshipType,
    category: row.conversation.category,
  });
  const usedIds = await consumedPrivateQuestionIds(database, row.conversation.id);
  if (!eligible.some((candidate) => !usedIds.has(candidate.id))) {
    return { ...base, state: "EXHAUSTED" as const, message: "You've reached the end for now." };
  }
  if (role === "creator" && currentRound[0]?.round.status === "open") {
    return { ...base, state: "READY_FOR_NEXT" as const };
  }
  return {
    ...base,
    state: "WAITING_FOR_CREATOR" as const,
    message: `Waiting for ${creator.displayName} to choose a question.`,
  };
}

export async function getPrivateConversationForParticipant(
  database: Database,
  input: { participantId: string; pairId: string; conversationId: string },
) {
  const access = await requireCompletePairAccess(database, input.participantId, input.pairId);
  return projectPrivateConversationForParticipant(database, input, access);
}

async function insertRoundForConversation(
  database: Database,
  input: {
    pairId: string;
    conversationId: string;
    participantId: string;
    questionId: string;
    questionRevisionId: string;
    questionNumber: number;
    clientRequestId?: string;
  },
) {
  if (input.clientRequestId) {
    const existing = await database
      .select({
        id: privateRound.id,
        conversationId: privateRound.conversationId,
        questionId: privateRound.questionId,
        questionRevisionId: privateRound.questionRevisionId,
      })
      .from(privateRound)
      .where(
        and(
          eq(privateRound.pairId, input.pairId),
          eq(privateRound.initiatorParticipantId, input.participantId),
          eq(privateRound.clientRequestId, input.clientRequestId),
        ),
      )
      .limit(1);
    if (existing[0]) {
      if (
        existing[0].conversationId !== input.conversationId ||
        existing[0].questionId !== input.questionId ||
        existing[0].questionRevisionId !== input.questionRevisionId
      )
        throw new CloserDomainError("QUESTION_UNAVAILABLE");
      return { id: existing[0].id };
    }
  }

  const inserted = await database
    .insert(privateRound)
    .values({
      pairId: input.pairId,
      conversationId: input.conversationId,
      questionId: input.questionId,
      questionRevisionId: input.questionRevisionId,
      questionNumber: input.questionNumber,
      initiatorParticipantId: input.participantId,
      clientRequestId: input.clientRequestId,
    })
    .onConflictDoNothing()
    .returning({ id: privateRound.id });
  if (inserted[0]) return { id: inserted[0].id };

  if (!input.clientRequestId) throw new Error("Private round creation did not return a round.");
  const resolved = await database
    .select({
      id: privateRound.id,
      conversationId: privateRound.conversationId,
      questionId: privateRound.questionId,
      questionRevisionId: privateRound.questionRevisionId,
    })
    .from(privateRound)
    .where(
      and(
        eq(privateRound.pairId, input.pairId),
        eq(privateRound.initiatorParticipantId, input.participantId),
        eq(privateRound.clientRequestId, input.clientRequestId),
      ),
    )
    .limit(1);
  if (!resolved[0]) throw new Error("Private round creation did not resolve.");
  if (
    resolved[0].conversationId !== input.conversationId ||
    resolved[0].questionId !== input.questionId ||
    resolved[0].questionRevisionId !== input.questionRevisionId
  )
    throw new CloserDomainError("QUESTION_UNAVAILABLE");
  return { id: resolved[0].id };
}

export async function startOrResumePrivateConversation(
  database: Database,
  input: { participantId: string; pairId: string; category: string; clientRequestId?: string },
) {
  const access = await requireCompletePairAccess(database, input.participantId, input.pairId);
  if (input.clientRequestId && !isUuid(input.clientRequestId))
    throw new CloserDomainError("QUESTION_UNAVAILABLE");
  assertCategoryForPair(access, input.category);
  const category = input.category as QuestionCategory;

  return database
    .transaction(async (transaction) => {
      const tx = transaction as unknown as Database;
      await tx.execute(sql`select id from "pair" where id = ${input.pairId} for update`);
      await requireCompletePairAccess(tx, input.participantId, input.pairId);
      const activeEra = await getActiveMembershipEra(tx, input.pairId);
      if (!activeEra) throw new CloserDomainError("PAIR_NOT_READY");
      const conversation = await lockPairAndFindConversation(tx, {
        pairId: input.pairId,
        category,
        participantId: input.participantId,
        membershipEraId: activeEra.id,
      });
      const currentRound = await latestRoundForConversation(tx, conversation.id);
      if (!currentRound || !(await privateRoundIsUnresolved(tx, currentRound.id))) {
        if (conversation.createdByParticipantId === input.participantId) {
          await selectPrivateQuestionCandidate(tx, conversation, access.pair.relationshipType);
        }
      }
      return { conversationId: conversation.id };
    })
    .then(({ conversationId }) =>
      getPrivateConversationForParticipant(database, {
        participantId: input.participantId,
        pairId: input.pairId,
        conversationId,
      }),
    );
}

async function loadMutableCreatorCandidateInTransaction(
  tx: Database,
  input: { participantId: string; pairId: string; conversationId: string; candidateId: string },
) {
  await tx.execute(sql`select id from "pair" where id = ${input.pairId} for update`);
  const access = await requireCompletePairAccess(tx, input.participantId, input.pairId);
  const activeEra = await getActiveMembershipEra(tx, input.pairId);
  if (!activeEra) throw new CloserDomainError("PAIR_NOT_READY");
  const conversations = await tx
    .select()
    .from(privateConversation)
    .where(
      and(
        eq(privateConversation.id, input.conversationId),
        eq(privateConversation.pairId, input.pairId),
        eq(privateConversation.membershipEraId, activeEra.id),
        eq(privateConversation.createdByParticipantId, input.participantId),
      ),
    )
    .limit(1);
  const conversation = conversations[0];
  if (!conversation) throw new CloserDomainError("CONVERSATION_NOT_FOUND");
  await tx.execute(
    sql`select id from "private_conversation" where id = ${conversation.id} for update`,
  );
  await tx.execute(
    sql`select id from "private_question_candidate" where id = ${input.candidateId} for update`,
  );
  const candidates = await tx
    .select({ candidate: privateQuestionCandidate, revision: questionRevision })
    .from(privateQuestionCandidate)
    .innerJoin(
      questionRevision,
      eq(privateQuestionCandidate.questionRevisionId, questionRevision.id),
    )
    .where(
      and(
        eq(privateQuestionCandidate.id, input.candidateId),
        eq(privateQuestionCandidate.conversationId, conversation.id),
      ),
    )
    .limit(1);
  const candidate = candidates[0];
  if (!candidate) throw new CloserDomainError("QUESTION_UNAVAILABLE");
  return { access, conversation, candidate };
}

async function nextPrivateRoundNumber(database: Database, conversationId: string) {
  const latest = await database
    .select({ questionNumber: privateRound.questionNumber })
    .from(privateRound)
    .where(eq(privateRound.conversationId, conversationId))
    .orderBy(desc(privateRound.questionNumber))
    .limit(1);
  return (latest[0]?.questionNumber ?? 0) + 1;
}

async function assertNoCurrentPrivateRound(database: Database, conversationId: string) {
  const currentRound = await latestRoundForConversation(database, conversationId);
  if (currentRound && (await privateRoundIsUnresolved(database, currentRound.id))) {
    throw new CloserDomainError("QUESTION_UNAVAILABLE");
  }
}

export async function askPrivateQuestionCandidate(
  database: Database,
  input: {
    participantId: string;
    pairId: string;
    conversationId: string;
    candidateId: string;
    clientRequestId?: string;
  },
) {
  if (input.clientRequestId && !isUuid(input.clientRequestId))
    throw new CloserDomainError("QUESTION_UNAVAILABLE");
  return database.transaction(async (transaction) => {
    const tx = transaction as unknown as Database;
    const { conversation, candidate } = await loadMutableCreatorCandidateInTransaction(tx, input);
    if (candidate.candidate.state === "asked") {
      const rounds = await tx
        .select({ id: privateRound.id })
        .from(privateRound)
        .where(
          and(
            eq(privateRound.conversationId, conversation.id),
            eq(privateRound.questionId, candidate.candidate.questionId),
            eq(privateRound.questionRevisionId, candidate.candidate.questionRevisionId),
          ),
        )
        .limit(1);
      if (rounds[0]) return { conversationId: conversation.id, roundId: rounds[0].id };
      throw new Error("Asked candidate did not resolve to a Round.");
    }
    if (candidate.candidate.state !== "unresolved")
      throw new CloserDomainError("QUESTION_UNAVAILABLE");
    await assertNoCurrentPrivateRound(tx, conversation.id);
    if (candidate.revision.withdrawnAt) {
      await tx
        .update(privateQuestionCandidate)
        .set({ state: "invalidated", resolvedAt: new Date() })
        .where(eq(privateQuestionCandidate.id, candidate.candidate.id));
      throw new CloserDomainError("QUESTION_UNAVAILABLE");
    }

    const updated = await tx
      .update(privateQuestionCandidate)
      .set({ state: "asked", resolvedAt: new Date() })
      .where(
        and(
          eq(privateQuestionCandidate.id, candidate.candidate.id),
          eq(privateQuestionCandidate.state, "unresolved"),
        ),
      )
      .returning({ id: privateQuestionCandidate.id });
    if (!updated[0]) throw new CloserDomainError("QUESTION_UNAVAILABLE");
    const round = await insertRoundForConversation(tx, {
      pairId: input.pairId,
      conversationId: conversation.id,
      participantId: input.participantId,
      questionId: candidate.candidate.questionId,
      questionRevisionId: candidate.candidate.questionRevisionId,
      questionNumber: await nextPrivateRoundNumber(tx, conversation.id),
      clientRequestId: input.clientRequestId,
    });
    return { conversationId: conversation.id, roundId: round.id };
  });
}

export async function skipPrivateQuestionCandidate(
  database: Database,
  input: { participantId: string; pairId: string; conversationId: string; candidateId: string },
) {
  await database.transaction(async (transaction) => {
    const tx = transaction as unknown as Database;
    const { access, conversation, candidate } = await loadMutableCreatorCandidateInTransaction(
      tx,
      input,
    );
    if (candidate.candidate.state === "skipped") {
      await selectPrivateQuestionCandidate(tx, conversation, access.pair.relationshipType);
      return;
    }
    if (candidate.candidate.state !== "unresolved")
      throw new CloserDomainError("QUESTION_UNAVAILABLE");
    await assertNoCurrentPrivateRound(tx, conversation.id);
    const updated = await tx
      .update(privateQuestionCandidate)
      .set({ state: "skipped", resolvedAt: new Date() })
      .where(
        and(
          eq(privateQuestionCandidate.id, candidate.candidate.id),
          eq(privateQuestionCandidate.state, "unresolved"),
        ),
      )
      .returning({ id: privateQuestionCandidate.id });
    if (!updated[0]) throw new CloserDomainError("QUESTION_UNAVAILABLE");
    await selectPrivateQuestionCandidate(tx, conversation, access.pair.relationshipType);
  });
  return getPrivateConversationForParticipant(database, input);
}

export async function setPrivateQuestionCandidateLike(
  database: Database,
  input: {
    participantId: string;
    pairId: string;
    conversationId: string;
    candidateId: string;
    liked: boolean;
  },
) {
  return database.transaction(async (transaction) => {
    const tx = transaction as unknown as Database;
    const { conversation, candidate } = await loadMutableCreatorCandidateInTransaction(tx, input);
    if (candidate.candidate.state !== "unresolved")
      throw new CloserDomainError("QUESTION_UNAVAILABLE");
    await assertNoCurrentPrivateRound(tx, conversation.id);
    const updated = await tx
      .update(privateQuestionCandidate)
      .set({ liked: input.liked })
      .where(
        and(
          eq(privateQuestionCandidate.id, candidate.candidate.id),
          eq(privateQuestionCandidate.state, "unresolved"),
        ),
      )
      .returning({ liked: privateQuestionCandidate.liked });
    if (!updated[0]) throw new CloserDomainError("QUESTION_UNAVAILABLE");
    return updated[0];
  });
}

export async function getPrivateRoundForParticipant(
  database: Database,
  input: { participantId: string; pairId: string; roundId: string },
) {
  const context = await loadPrivateRoundContext(
    database,
    input.participantId,
    input.pairId,
    input.roundId,
  );
  const [answers, viewerReveal] = await Promise.all([
    database.select().from(privateAnswer).where(eq(privateAnswer.roundId, input.roundId)),
    database
      .select({ viewedAt: privateRevealView.viewedAt })
      .from(privateRevealView)
      .where(
        and(
          eq(privateRevealView.roundId, input.roundId),
          eq(privateRevealView.participantId, input.participantId),
        ),
      )
      .limit(1),
  ]);
  const viewerAnswer =
    answers.find((answer) => answer.participantId === input.participantId) ?? null;
  const isDeclined = context.round.status === "declined";
  const isRevealReady = !isDeclined && answers.length === 2;
  const revealViewedAt = viewerReveal[0]?.viewedAt ?? null;
  const otherMember = context.members.find(
    (member) => member.participantId !== input.participantId,
  );
  if (!otherMember) throw new CloserDomainError("ROUND_NOT_FOUND");
  const otherRevealViewed =
    (
      await database
        .select({ id: privateRevealView.id })
        .from(privateRevealView)
        .where(
          and(
            eq(privateRevealView.roundId, input.roundId),
            eq(privateRevealView.participantId, otherMember.participantId),
          ),
        )
        .limit(1)
    ).length > 0;

  const result = {
    id: context.round.id,
    pairId: context.round.pairId,
    conversation: {
      id: context.conversation.id,
      category: context.conversation.category,
      questionNumber: context.round.questionNumber,
      isCreator: context.conversation.createdByParticipantId === input.participantId,
    },
    question: {
      id: context.round.questionId,
      questionRevisionId: context.round.questionRevisionId,
      text: context.revision.text,
      category: context.revision.category,
      intensity: context.revision.intensity,
    },
    otherParticipant: { id: otherMember.participantId, displayName: otherMember.displayName },
    yourAnswer: viewerAnswer?.body ?? null,
    state: viewerRoundState(answers.length, viewerAnswer !== null, revealViewedAt, isDeclined),
    revealViewedAt: revealViewedAt?.toISOString() ?? null,
    otherRevealViewed,
  } as {
    id: string;
    pairId: string;
    conversation: {
      id: string;
      category: QuestionCategory;
      questionNumber: number;
      isCreator: boolean;
    };
    question: {
      id: string;
      questionRevisionId: string;
      text: string;
      category: QuestionCategory;
      intensity: QuestionIntensity;
    };
    otherParticipant: { id: string; displayName: string };
    yourAnswer: string | null;
    state: "YOUR_TURN" | "WAITING" | "REVEAL_READY" | "REVEAL_VIEWED" | "DECLINED";
    revealViewedAt: string | null;
    otherRevealViewed: boolean;
    answers?: Array<{ participantId: string; displayName: string; body: string }>;
    reactions?: Array<{ participantId: string; displayName: string; value: ReactionValue }>;
    replies?: Array<{ participantId: string; displayName: string; body: string; isOwner: boolean }>;
  };

  // Deliberately do not put another participant's answer anywhere in this projection until this participant explicitly Reveals.
  if (!isRevealReady || !revealViewedAt) return result;

  const memberNames = new Map(
    context.members.map((member) => [member.participantId, member.displayName]),
  );
  const [reactions, replies] = await Promise.all([
    database.select().from(privateReaction).where(eq(privateReaction.roundId, input.roundId)),
    database.select().from(privateReply).where(eq(privateReply.roundId, input.roundId)),
  ]);
  result.answers = answers.map((answer) => ({
    participantId: answer.participantId,
    displayName: memberNames.get(answer.participantId) ?? "Participant",
    body: answer.body,
  }));
  result.reactions = reactions.map((reaction) => ({
    participantId: reaction.participantId,
    displayName: memberNames.get(reaction.participantId) ?? "Participant",
    value: reaction.value,
  }));
  result.replies = replies.map((reply) => ({
    participantId: reply.participantId,
    displayName: memberNames.get(reply.participantId) ?? "Participant",
    body: reply.body,
    isOwner: reply.participantId === input.participantId,
  }));
  return result;
}

export async function getPrivateRoundStatusForParticipant(
  database: Database,
  input: { participantId: string; pairId: string; roundId: string },
) {
  const view = await getPrivateRoundForParticipant(database, input);
  return { state: view.state };
}

export async function listActivePrivateConversations(
  database: Database,
  input: { participantId: string; pairId: string },
) {
  const access = await requireCompletePairAccess(database, input.participantId, input.pairId);
  const conversations = await database
    .select({
      id: privateConversation.id,
      category: privateConversation.category,
      createdAt: privateConversation.createdAt,
    })
    .from(privateConversation)
    .where(
      and(
        eq(privateConversation.pairId, input.pairId),
        sql`exists (
          select 1 from pair_membership_era active_era
          where active_era.id = ${privateConversation.membershipEraId}
            and active_era.ended_at is null
            and (${privateConversation.membershipEraId} = active_era.id)
            and (${access.membership.id} = active_era.first_membership_id or ${access.membership.id} = active_era.second_membership_id)
        )`,
      ),
    )
    .orderBy(desc(privateConversation.createdAt));
  if (!conversations.length) return [];

  return Promise.all(
    conversations.map(async (conversation) => {
      const projection = await projectPrivateConversationForParticipant(
        database,
        {
          participantId: input.participantId,
          pairId: input.pairId,
          conversationId: conversation.id,
        },
        access,
      );
      const rounds = await database
        .select({ id: privateRound.id })
        .from(privateRound)
        .where(eq(privateRound.conversationId, conversation.id));
      if (projection.state === "CURRENT_ROUND") {
        const state:
          | "YOUR_TURN"
          | "WAITING"
          | "REVEAL_READY"
          | "DECLINED"
          | "WAITING_FOR_REVEAL"
          | "READY_FOR_NEXT"
          | "WAITING_FOR_CREATOR" =
          projection.currentRound.state === "REVEAL_VIEWED"
            ? projection.role === "creator"
              ? projection.currentRound.otherRevealViewed
                ? "READY_FOR_NEXT"
                : "WAITING_FOR_REVEAL"
              : "WAITING_FOR_CREATOR"
            : projection.currentRound.state;
        return {
          ...projection,
          questionCount: rounds.length,
          state,
        };
      }
      return { ...projection, questionCount: rounds.length };
    }),
  );
}

/** @deprecated Pair Home must use conversation summaries. */
export const listActivePrivateRounds = listActivePrivateConversations;

/**
 * Returns only read-only activity from membership configurations the viewer
 * actually belonged to. This is deliberately separate from the active Private
 * projections: history grants both era members access to a mutually answered
 * Round even when neither recorded a Reveal View before the era closed.
 */
export async function getFormerEraHistoryForParticipant(
  database: Database,
  input: { participantId: string; pairId: string },
) {
  const [[formerPair], viewerMemberships] = await Promise.all([
    database
      .select({ terminatedAt: pair.terminatedAt, intendedPersonName: pair.intendedPersonName })
      .from(pair)
      .where(eq(pair.id, input.pairId))
      .limit(1),
    database
      .select({ id: pairMembership.id })
      .from(pairMembership)
      .where(
        and(
          eq(pairMembership.pairId, input.pairId),
          eq(pairMembership.participantId, input.participantId),
        ),
      ),
  ]);
  if (!formerPair) throw new CloserDomainError("PAIR_NOT_FOUND");
  const viewerMembershipIds = new Set(viewerMemberships.map((membership) => membership.id));
  if (!viewerMembershipIds.size) throw new CloserDomainError("PAIR_NOT_FOUND");

  const eras = (
    await database
      .select({
        id: pairMembershipEra.id,
        firstMembershipId: pairMembershipEra.firstMembershipId,
        secondMembershipId: pairMembershipEra.secondMembershipId,
        endedAt: pairMembershipEra.endedAt,
      })
      .from(pairMembershipEra)
      .where(
        and(
          eq(pairMembershipEra.pairId, input.pairId),
          sql`${pairMembershipEra.endedAt} is not null`,
        ),
      )
      .orderBy(desc(pairMembershipEra.endedAt))
  ).filter(
    (era) =>
      viewerMembershipIds.has(era.firstMembershipId) ||
      viewerMembershipIds.has(era.secondMembershipId),
  );

  const eraIds = eras.map((era) => era.id);
  const eraMembershipIds = eras.flatMap((era) => [era.firstMembershipId, era.secondMembershipId]);
  const preClaimSessionsPromise = database
    .select({
      id: togetherSession.id,
      category: togetherSession.category,
      startedAt: togetherSession.startedAt,
      endedAt: togetherSession.endedAt,
    })
    .from(togetherSession)
    .where(
      and(
        eq(togetherSession.pairId, input.pairId),
        isNull(togetherSession.membershipEraId),
        eq(togetherSession.startedByParticipantId, input.participantId),
        sql`${togetherSession.endedAt} is not null`,
      ),
    )
    .orderBy(desc(togetherSession.startedAt));
  const membersPromise = eraMembershipIds.length
    ? database
        .select({
          id: pairMembership.id,
          participantId: pairMembership.participantId,
          displayName: sql<string>`coalesce(${pairMembership.endedDisplayName}, ${participant.displayName})`,
        })
        .from(pairMembership)
        .innerJoin(participant, eq(pairMembership.participantId, participant.id))
        .where(inArray(pairMembership.id, eraMembershipIds))
    : Promise.resolve([]);
  const conversationsPromise = eraIds.length
    ? database
        .select({
          id: privateConversation.id,
          membershipEraId: privateConversation.membershipEraId,
          category: privateConversation.category,
          createdAt: privateConversation.createdAt,
        })
        .from(privateConversation)
        .where(
          and(
            eq(privateConversation.pairId, input.pairId),
            inArray(privateConversation.membershipEraId, eraIds),
          ),
        )
        .orderBy(desc(privateConversation.createdAt))
    : Promise.resolve([]);
  const sessionsPromise = eraIds.length
    ? database
        .select({
          id: togetherSession.id,
          membershipEraId: togetherSession.membershipEraId,
          category: togetherSession.category,
          startedAt: togetherSession.startedAt,
          endedAt: togetherSession.endedAt,
        })
        .from(togetherSession)
        .where(inArray(togetherSession.membershipEraId, eraIds))
        .orderBy(desc(togetherSession.startedAt))
    : Promise.resolve([]);
  const [members, conversations, sessions, preClaimSessions] = await Promise.all([
    membersPromise,
    conversationsPromise,
    sessionsPromise,
    preClaimSessionsPromise,
  ]);

  const conversationIds = conversations.map((conversation) => conversation.id);
  const allSessions = [...sessions, ...preClaimSessions];
  const sessionIds = allSessions.map((session) => session.id);
  const [roundRows, cardRows] = await Promise.all([
    conversationIds.length
      ? database
          .select({
            id: privateRound.id,
            conversationId: privateRound.conversationId,
            questionNumber: privateRound.questionNumber,
            status: privateRound.status,
            text: questionRevision.text,
            category: questionRevision.category,
          })
          .from(privateRound)
          .innerJoin(questionRevision, eq(privateRound.questionRevisionId, questionRevision.id))
          .where(inArray(privateRound.conversationId, conversationIds))
          .orderBy(asc(privateRound.questionNumber))
      : Promise.resolve([]),
    sessionIds.length
      ? database
          .select({
            id: togetherSessionQuestion.id,
            sessionId: togetherSessionQuestion.sessionId,
            position: togetherSessionQuestion.position,
            text: questionRevision.text,
            likedAt: togetherSessionQuestion.likedAt,
            skippedAt: togetherSessionQuestion.skippedAt,
            advancedAt: togetherSessionQuestion.advancedAt,
          })
          .from(togetherSessionQuestion)
          .innerJoin(
            questionRevision,
            eq(togetherSessionQuestion.questionRevisionId, questionRevision.id),
          )
          .where(inArray(togetherSessionQuestion.sessionId, sessionIds))
          .orderBy(asc(togetherSessionQuestion.position))
      : Promise.resolve([]),
  ]);

  const roundIds = roundRows.map((round) => round.id);
  const [answerRows, reactionRows, replyRows] = await Promise.all([
    roundIds.length
      ? database
          .select({
            roundId: privateAnswer.roundId,
            participantId: privateAnswer.participantId,
            body: privateAnswer.body,
          })
          .from(privateAnswer)
          .where(inArray(privateAnswer.roundId, roundIds))
      : Promise.resolve([]),
    roundIds.length
      ? database
          .select({
            roundId: privateReaction.roundId,
            participantId: privateReaction.participantId,
            value: privateReaction.value,
          })
          .from(privateReaction)
          .where(inArray(privateReaction.roundId, roundIds))
      : Promise.resolve([]),
    roundIds.length
      ? database
          .select({
            roundId: privateReply.roundId,
            participantId: privateReply.participantId,
            body: privateReply.body,
          })
          .from(privateReply)
          .where(inArray(privateReply.roundId, roundIds))
      : Promise.resolve([]),
  ]);

  const memberByMembershipId = new Map(members.map((member) => [member.id, member]));
  const conversationsByEra = new Map<string, typeof conversations>();
  for (const conversation of conversations) {
    const eraConversations = conversationsByEra.get(conversation.membershipEraId) ?? [];
    eraConversations.push(conversation);
    conversationsByEra.set(conversation.membershipEraId, eraConversations);
  }
  const roundsByConversation = new Map<string, typeof roundRows>();
  for (const round of roundRows) {
    const conversationRounds = roundsByConversation.get(round.conversationId) ?? [];
    conversationRounds.push(round);
    roundsByConversation.set(round.conversationId, conversationRounds);
  }
  const cardsBySession = new Map<string, typeof cardRows>();
  for (const card of cardRows) {
    const sessionCards = cardsBySession.get(card.sessionId) ?? [];
    sessionCards.push(card);
    cardsBySession.set(card.sessionId, sessionCards);
  }
  const answersByRound = new Map<string, typeof answerRows>();
  for (const answer of answerRows) {
    const roundAnswers = answersByRound.get(answer.roundId) ?? [];
    roundAnswers.push(answer);
    answersByRound.set(answer.roundId, roundAnswers);
  }
  const reactionsByRound = new Map<string, typeof reactionRows>();
  for (const reaction of reactionRows) {
    const roundReactions = reactionsByRound.get(reaction.roundId) ?? [];
    roundReactions.push(reaction);
    reactionsByRound.set(reaction.roundId, roundReactions);
  }
  const repliesByRound = new Map<string, typeof replyRows>();
  for (const reply of replyRows) {
    const roundReplies = repliesByRound.get(reply.roundId) ?? [];
    roundReplies.push(reply);
    repliesByRound.set(reply.roundId, roundReplies);
  }

  const projectSession = (session: (typeof allSessions)[number]) => ({
    id: session.id,
    category: session.category,
    startedAt: session.startedAt.toISOString(),
    endedAt: session.endedAt?.toISOString() ?? null,
    questions: (cardsBySession.get(session.id) ?? []).map((card) => ({
      id: card.id,
      position: card.position,
      text: card.text,
      liked: card.likedAt !== null,
      skipped: card.skippedAt !== null,
      advanced: card.advancedAt !== null,
    })),
  });

  const erasWithHistory = eras.map((era) => {
    const firstMember = memberByMembershipId.get(era.firstMembershipId);
    const secondMember = memberByMembershipId.get(era.secondMembershipId);
    const membersForEra = [firstMember, secondMember].filter(
      (member): member is NonNullable<typeof member> => Boolean(member),
    );
    const memberIds = new Set(membersForEra.map((member) => member.participantId));
    const memberNames = new Map(
      membersForEra.map((member) => [member.participantId, member.displayName]),
    );
    const privateConversations = (conversationsByEra.get(era.id) ?? [])
      .map((conversation) => {
        const rounds = (roundsByConversation.get(conversation.id) ?? []).map((round) => {
          const answers = (answersByRound.get(round.id) ?? []).filter((answer) =>
            memberIds.has(answer.participantId),
          );
          const mutuallyAnswered = round.status !== "declined" && answers.length === 2;
          const visibleAnswers = mutuallyAnswered
            ? answers
            : answers.filter((answer) => answer.participantId === input.participantId);
          const reactions = mutuallyAnswered
            ? (reactionsByRound.get(round.id) ?? []).filter((reaction) =>
                memberIds.has(reaction.participantId),
              )
            : [];
          const replies = mutuallyAnswered
            ? (repliesByRound.get(round.id) ?? []).filter((reply) =>
                memberIds.has(reply.participantId),
              )
            : [];
          return {
            id: round.id,
            questionNumber: round.questionNumber,
            question: { text: round.text, category: round.category },
            status: round.status === "declined" ? ("passed" as const) : ("answered" as const),
            answers: visibleAnswers.map((answer) => ({
              participantId: answer.participantId,
              displayName: memberNames.get(answer.participantId) ?? "Participant",
              body: answer.body,
            })),
            reactions: reactions.map((reaction) => ({
              participantId: reaction.participantId,
              displayName: memberNames.get(reaction.participantId) ?? "Participant",
              value: reaction.value,
            })),
            replies: replies.map((reply) => ({
              participantId: reply.participantId,
              displayName: memberNames.get(reply.participantId) ?? "Participant",
              body: reply.body,
            })),
          };
        });
        return { id: conversation.id, category: conversation.category, rounds };
      })
      .filter((conversation) => conversation.rounds.length > 0);
    return {
      privateConversations,
      togetherSessions: sessions
        .filter((session) => session.membershipEraId === era.id)
        .map(projectSession),
    };
  });

  return {
    formerPair: {
      terminatedAt: formerPair.terminatedAt?.toISOString() ?? null,
      intendedPersonName: formerPair.terminatedAt ? formerPair.intendedPersonName : null,
    },
    eras: erasWithHistory,
    preClaimTogetherSessions: preClaimSessions.map(projectSession),
  };
}

export async function submitPrivateAnswer(
  database: Database,
  input: { participantId: string; pairId: string; roundId: string; body: string },
) {
  const body = normalizePrivateText(input.body, 2000, "ANSWER_INVALID");
  await database.transaction(async (transaction) => {
    const tx = transaction as unknown as Database;
    const context = await requireMutablePrivateRoundInTransaction(tx, input);
    if (context.round.status !== "open") throw new CloserDomainError("QUESTION_UNAVAILABLE");
    const inserted = await tx
      .insert(privateAnswer)
      .values({ roundId: input.roundId, participantId: input.participantId, body })
      .onConflictDoNothing()
      .returning({ body: privateAnswer.body });

    if (!inserted[0]) {
      const existing = await tx
        .select({ body: privateAnswer.body })
        .from(privateAnswer)
        .where(
          and(
            eq(privateAnswer.roundId, input.roundId),
            eq(privateAnswer.participantId, input.participantId),
          ),
        )
        .limit(1);
      if (!existing[0]) throw new Error("Private answer submission did not resolve.");
      if (existing[0].body !== body) throw new CloserDomainError("ANSWER_IMMUTABLE");
    }
  });
  return getPrivateRoundForParticipant(database, input);
}

export async function declinePrivateRound(
  database: Database,
  input: { participantId: string; pairId: string; roundId: string },
) {
  await database.transaction(async (transaction) => {
    const tx = transaction as unknown as Database;
    const context = await requireMutablePrivateRoundInTransaction(tx, input);
    if (context.round.status === "declined") {
      if (context.round.declinedByParticipantId === input.participantId) return;
      throw new CloserDomainError("QUESTION_UNAVAILABLE");
    }

    const answers = await tx
      .select({ participantId: privateAnswer.participantId })
      .from(privateAnswer)
      .where(eq(privateAnswer.roundId, input.roundId));
    if (
      answers.some((answer) => answer.participantId === input.participantId) ||
      answers.length >= 2
    ) {
      throw new CloserDomainError("QUESTION_UNAVAILABLE");
    }

    const declined = await tx
      .update(privateRound)
      .set({
        status: "declined",
        declinedByParticipantId: input.participantId,
        declinedAt: new Date(),
      })
      .where(and(eq(privateRound.id, input.roundId), eq(privateRound.status, "open")))
      .returning({ id: privateRound.id });
    if (!declined[0]) throw new CloserDomainError("QUESTION_UNAVAILABLE");

    // The Pair lock held by requireMutablePrivateRoundInTransaction also serializes this
    // selection, so a retry or concurrent reveal/continuation cannot create another candidate.
    await selectPrivateQuestionCandidate(tx, context.conversation, context.pair.relationshipType);
  });
  return getPrivateRoundForParticipant(database, input);
}

export async function markPrivateRevealViewed(
  database: Database,
  input: { participantId: string; pairId: string; roundId: string },
) {
  await database.transaction(async (transaction) => {
    const tx = transaction as unknown as Database;
    const context = await requireMutablePrivateRoundInTransaction(tx, input);
    if (context.round.status !== "open" || (await answerCountForRound(tx, input.roundId)) !== 2) {
      throw new CloserDomainError("REVEAL_NOT_READY");
    }
    await tx
      .insert(privateRevealView)
      .values({ roundId: input.roundId, participantId: input.participantId })
      .onConflictDoNothing();
  });
  return getPrivateRoundForParticipant(database, input);
}

async function requireRevealViewed(
  database: Database,
  input: { participantId: string; pairId: string; roundId: string },
) {
  const view = await getPrivateRoundForParticipant(database, input);
  if (!view.answers || view.state !== "REVEAL_VIEWED")
    throw new CloserDomainError("REVEAL_NOT_READY");
}

export async function setPrivateReaction(
  database: Database,
  input: { participantId: string; pairId: string; roundId: string; value: string },
) {
  assertReactionValue(input.value);
  await database.transaction(async (transaction) => {
    const tx = transaction as unknown as Database;
    await requireMutablePrivateRoundInTransaction(tx, input);
    await requireRevealViewed(tx, input);
    const value = input.value as ReactionValue;
    await tx
      .insert(privateReaction)
      .values({ roundId: input.roundId, participantId: input.participantId, value })
      .onConflictDoUpdate({
        target: [privateReaction.roundId, privateReaction.participantId],
        set: { value, updatedAt: new Date() },
      });
  });
  return getPrivateRoundForParticipant(database, input);
}

export async function removePrivateReaction(
  database: Database,
  input: { participantId: string; pairId: string; roundId: string },
) {
  await database.transaction(async (transaction) => {
    const tx = transaction as unknown as Database;
    await requireMutablePrivateRoundInTransaction(tx, input);
    await requireRevealViewed(tx, input);
    await tx
      .delete(privateReaction)
      .where(
        and(
          eq(privateReaction.roundId, input.roundId),
          eq(privateReaction.participantId, input.participantId),
        ),
      );
  });
  return getPrivateRoundForParticipant(database, input);
}

export async function setPrivateReply(
  database: Database,
  input: { participantId: string; pairId: string; roundId: string; body: string },
) {
  const body = normalizePrivateText(input.body, 500, "REPLY_INVALID");
  await database.transaction(async (transaction) => {
    const tx = transaction as unknown as Database;
    await requireMutablePrivateRoundInTransaction(tx, input);
    await requireRevealViewed(tx, input);
    await tx
      .insert(privateReply)
      .values({ roundId: input.roundId, participantId: input.participantId, body })
      .onConflictDoUpdate({
        target: [privateReply.roundId, privateReply.participantId],
        set: { body, updatedAt: new Date() },
      });
  });
  return getPrivateRoundForParticipant(database, input);
}

export async function removePrivateReply(
  database: Database,
  input: { participantId: string; pairId: string; roundId: string },
) {
  await database.transaction(async (transaction) => {
    const tx = transaction as unknown as Database;
    await requireMutablePrivateRoundInTransaction(tx, input);
    await requireRevealViewed(tx, input);
    await tx
      .delete(privateReply)
      .where(
        and(
          eq(privateReply.roundId, input.roundId),
          eq(privateReply.participantId, input.participantId),
        ),
      );
  });
  return getPrivateRoundForParticipant(database, input);
}

export { INITIAL_INVITE_LIFETIME_MS, normalizeDisplayName };
