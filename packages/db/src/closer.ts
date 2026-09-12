import { createHash, randomBytes } from "node:crypto";

import { and, asc, desc, eq, gt, gte, inArray, isNull, or, sql } from "drizzle-orm";

import { createDb } from "./index";
import {
  initialInvite,
  pair,
  pairMembershipEra,
  pairMembership,
  participant,
  privateAnswer,
  privateConversation,
  privateReaction,
  privateReply,
  privateRevealView,
  privateRound,
  question,
  rejoinInvite,
  togetherSession,
  togetherSessionQuestion,
} from "./schema/closer";
import { session, user } from "./schema/auth";

type Database = ReturnType<typeof createDb>;
type RelationshipType = "partner" | "friend";
type QuestionCategory = "fun" | "deep" | "memories" | "relationship" | "friendship";
type QuestionModeFit = "both" | "together" | "private";
type ReactionValue = "heart" | "laugh" | "tender" | "surprised";

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

function assertReactionValue(value: string): asserts value is ReactionValue {
  if (!["heart", "laugh", "tender", "surprised"].includes(value)) {
    throw new CloserDomainError("REACTION_INVALID");
  }
}

function normalizePrivateText(value: string, maximumLength: number, errorCode: "ANSWER_INVALID" | "REPLY_INVALID") {
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
      ),
    )
    .limit(1);

  if (!rows[0]) throw new CloserDomainError("PAIR_NOT_FOUND");
  return rows[0];
}

async function requireSoleUnclaimedPairMemberInTransaction(
  tx: Parameters<Parameters<Database["transaction"]>[0]>[0],
  participantId: string,
  pairId: string,
) {
  await tx.execute(sql`select id from "pair" where id = ${pairId} for update`);
  const activeMemberships = await tx
    .select({ participantId: pairMembership.participantId, slot: pairMembership.slot })
    .from(pairMembership)
    .where(
      and(
        eq(pairMembership.pairId, pairId),
        isNull(pairMembership.endedAt),
      ),
    );
  if (
    activeMemberships.length !== 1
    || activeMemberships[0]?.participantId !== participantId
    || activeMemberships[0]?.slot !== "first"
  ) {
    throw new CloserDomainError("INVITE_UNAVAILABLE");
  }
}

async function findUsableInitialInvite(
  database: Pick<Database, "select">,
  pairId: string,
) {
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
  input: { participantId: string; intendedPersonName: string; relationshipType: string; clientRequestId?: string },
) {
  const relationshipType = input.relationshipType;
  assertRelationshipType(relationshipType);
  const intendedPersonName = normalizeIntendedPersonName(input.intendedPersonName);
  if (input.clientRequestId && !isUuid(input.clientRequestId)) throw new CloserDomainError("PAIR_CREATION_REQUEST_INVALID");

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
        .innerJoin(pairMembership, and(eq(pairMembership.pairId, pair.id), eq(pairMembership.participantId, input.participantId), eq(pairMembership.slot, "first"), isNull(pairMembership.endedAt)))
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
    return usable ? { state: "active" as const, expiresAt: usable.expiresAt } : { state: "none" as const };
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
      .where(and(eq(initialInvite.pairId, input.pairId), isNull(initialInvite.revokedAt), isNull(initialInvite.redeemedAt)));
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
      .where(and(eq(initialInvite.pairId, input.pairId), isNull(initialInvite.revokedAt), isNull(initialInvite.redeemedAt)));
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

    await tx.execute(sql`select id from "pair" where id = ${invite.pairId} for update`);

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
      .select({ participantId: pairMembership.participantId })
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
    if (!continuingParticipantId || continuingParticipantId === input.participantId) {
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

    await tx.insert(pairMembership).values({
      pairId: invite.pairId,
      participantId: input.participantId,
      slot: "second",
    });

    const era = await tx
      .insert(pairMembershipEra)
      .values({ pairId: invite.pairId })
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
    const { targetSlot, target } = await findEligibleRejoinTarget(tx, input.participantId, input.pairId);
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
    await tx
      .update(rejoinInvite)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(rejoinInvite.pairId, input.pairId),
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
    .where(
      and(
        eq(rejoinInvite.tokenHash, hashInviteToken(token)),
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
  input: { token: string; participantId: string },
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

    await tx.execute(sql`select id from "pair" where id = ${invite.pairId} for update`);

    const targetMembershipRows = await tx
      .select({ membership: pairMembership })
      .from(pairMembership)
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

    const existingParticipantMembership = await tx
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
    if (existingParticipantMembership[0]) throw new CloserDomainError("REJOIN_UNAVAILABLE");

    const redeemed = await tx
      .update(rejoinInvite)
      .set({ redeemedAt: new Date(), redeemedByParticipantId: input.participantId })
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
      .set({ endedAt })
      .where(eq(pairMembership.id, targetMembershipRows[0].membership.id));
    await tx.insert(pairMembership).values({
      pairId: invite.pairId,
      participantId: input.participantId,
      slot: invite.targetSlot,
    });
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

    return { pairId: invite.pairId };
  });
}

export async function getPairForParticipant(database: Database, participantId: string, pairId: string) {
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

export async function getPairStatusForParticipant(database: Database, participantId: string, pairId: string) {
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

async function requireCompletePairAccess(database: Database, participantId: string, pairId: string) {
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

async function loadTogetherSessionContext(database: Database, participantId: string, pairId: string, sessionId: string) {
  const access = await requireActivePairAccess(database, participantId, pairId);
  const activeEra = await getActiveMembershipEra(database, pairId);
  const rows = await database
    .select({ session: togetherSession })
    .from(togetherSession)
    .where(
      and(
        eq(togetherSession.id, sessionId),
        eq(togetherSession.pairId, pairId),
        or(
          activeEra ? eq(togetherSession.membershipEraId, activeEra.id) : undefined,
          and(isNull(togetherSession.membershipEraId), eq(togetherSession.startedByParticipantId, participantId)),
        ),
      ),
    )
    .limit(1);
  const result = rows[0];
  if (!result) throw new CloserDomainError("TOGETHER_SESSION_NOT_FOUND");
  return { ...access, session: result.session };
}

async function eligibleTogetherQuestions(
  database: Database,
  input: { relationshipType: RelationshipType; category: QuestionCategory },
) {
  return database
    .select({ id: question.id, text: question.text, category: question.category, depth: question.depth })
    .from(question)
    .where(
      and(
        eq(question.isActive, true),
        eq(question.category, input.category),
        inArray(question.relationshipFit, ["both", input.relationshipType]),
        inArray(question.modeFit, ["both", "together"]),
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

async function nextTogetherQuestion(
  database: Database,
  input: { sessionId?: string; relationshipType: RelationshipType; category: QuestionCategory },
) {
  const eligible = await eligibleTogetherQuestions(database, input);
  const shownIds = new Set<string>();
  if (input.sessionId) {
    const shown = await database
      .select({ questionId: togetherSessionQuestion.questionId })
      .from(togetherSessionQuestion)
      .where(eq(togetherSessionQuestion.sessionId, input.sessionId));
    for (const row of shown) shownIds.add(row.questionId);
  }
  return eligible.filter((candidate) => !shownIds.has(candidate.id)).toSorted((left, right) => left.id.localeCompare(right.id))[0] ?? null;
}

async function currentTogetherQuestion(database: Database, sessionId: string) {
  const rows = await database
    .select({ card: togetherSessionQuestion, question })
    .from(togetherSessionQuestion)
    .innerJoin(question, eq(togetherSessionQuestion.questionId, question.id))
    .where(and(eq(togetherSessionQuestion.sessionId, sessionId), isNull(togetherSessionQuestion.advancedAt)))
    .orderBy(asc(togetherSessionQuestion.position))
    .limit(1);
  return rows[0] ?? null;
}

export async function startTogetherSession(
  database: Database,
  input: { participantId: string; pairId: string; category: string; clientRequestId?: string },
) {
  const access = await requireActivePairAccess(database, input.participantId, input.pairId);
  if (input.clientRequestId && !isUuid(input.clientRequestId)) throw new CloserDomainError("TOGETHER_ACTION_INVALID");
  assertCategoryForPair(access, input.category);
  const category = input.category as QuestionCategory;

  return database.transaction(async (transaction) => {
    const tx = transaction as unknown as Database;
    await tx.execute(sql`select id from "pair" where id = ${input.pairId} for update`);
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
        return { sessionId: existing[0].id, questionId: current.question.id };
      }
    }

    const nextQuestion = await nextTogetherQuestion(tx, {
      relationshipType: access.pair.relationshipType,
      category,
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
      })
      .returning({ id: togetherSession.id });
    const session = inserted[0];
    if (!session) throw new Error("Together session creation did not return a session.");

    await tx.insert(togetherSessionQuestion).values({
      sessionId: session.id,
      questionId: nextQuestion.id,
      position: 1,
    });
    return { sessionId: session.id, questionId: nextQuestion.id };
  });
}

export async function getTogetherSessionForParticipant(
  database: Database,
  input: { participantId: string; pairId: string; sessionId: string },
) {
  const context = await loadTogetherSessionContext(database, input.participantId, input.pairId, input.sessionId);
  const current = await currentTogetherQuestion(database, input.sessionId);
  return {
    id: context.session.id,
    pairId: context.session.pairId,
    category: context.session.category,
    startedByParticipantId: context.session.startedByParticipantId,
    startedAt: context.session.startedAt.toISOString(),
    endedAt: context.session.endedAt?.toISOString() ?? null,
    exhausted: current === null,
    question: current
      ? {
          id: current.question.id,
          text: current.question.text,
          category: current.question.category,
          depth: current.question.depth,
          position: current.card.position,
          liked: current.card.likedAt !== null,
        }
      : null,
  };
}

export async function advanceTogetherSession(
  database: Database,
  input: { participantId: string; pairId: string; sessionId: string; action: "next" | "skip"; clientRequestId?: string },
) {
  if (input.clientRequestId && !isUuid(input.clientRequestId)) throw new CloserDomainError("TOGETHER_ACTION_INVALID");
  const access = await loadTogetherSessionContext(database, input.participantId, input.pairId, input.sessionId);

  return database.transaction(async (transaction) => {
    const tx = transaction as unknown as Database;
    await tx.execute(sql`select id from "pair" where id = ${input.pairId} for update`);
    const sessionRows = await tx
      .select()
      .from(togetherSession)
      .where(eq(togetherSession.id, input.sessionId))
      .for("update");
    const session = sessionRows[0];
    if (!session || session.pairId !== input.pairId || session.startedAt < access.membership.startedAt) {
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
        return current
          ? { kind: "QUESTION" as const, sessionId: input.sessionId, questionId: current.question.id }
          : { kind: "EXHAUSTED" as const, sessionId: input.sessionId };
      }
    }

    const current = await currentTogetherQuestion(tx, input.sessionId);
    if (!current) return { kind: "EXHAUSTED" as const, sessionId: input.sessionId };

    const now = new Date();
    await tx
      .update(togetherSessionQuestion)
      .set({
        skippedAt: input.action === "skip" ? now : current.card.skippedAt,
        advancedAt: now,
        advanceRequestId: input.clientRequestId,
      })
      .where(eq(togetherSessionQuestion.id, current.card.id));

    const nextQuestion = await nextTogetherQuestion(tx, {
      sessionId: input.sessionId,
      relationshipType: access.pair.relationshipType,
      category: session.category,
    });
    if (!nextQuestion) return { kind: "EXHAUSTED" as const, sessionId: input.sessionId };

    await tx.insert(togetherSessionQuestion).values({
      sessionId: input.sessionId,
      questionId: nextQuestion.id,
      position: current.card.position + 1,
    });
    return { kind: "QUESTION" as const, sessionId: input.sessionId, questionId: nextQuestion.id };
  });
}

export async function setTogetherSessionLike(
  database: Database,
  input: { participantId: string; pairId: string; sessionId: string; liked: boolean },
) {
  await loadTogetherSessionContext(database, input.participantId, input.pairId, input.sessionId);
  await database.transaction(async (transaction) => {
    const tx = transaction as unknown as Database;
    await tx.execute(sql`select id from "pair" where id = ${input.pairId} for update`);
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
  await loadTogetherSessionContext(database, input.participantId, input.pairId, input.sessionId);
  await database.transaction(async (transaction) => {
    const tx = transaction as unknown as Database;
    await tx.execute(sql`select id from "pair" where id = ${input.pairId} for update`);
    const sessionRows = await tx
      .select({ endedAt: togetherSession.endedAt })
      .from(togetherSession)
      .where(eq(togetherSession.id, input.sessionId))
      .for("update");
    const session = sessionRows[0];
    if (!session) throw new CloserDomainError("TOGETHER_SESSION_NOT_FOUND");
    if (!session.endedAt) {
      await tx.update(togetherSession).set({ endedAt: new Date() }).where(eq(togetherSession.id, input.sessionId));
    }
  });
  return getTogetherSessionForParticipant(database, input);
}

async function loadPrivateRoundContext(database: Database, participantId: string, pairId: string, roundId: string) {
  const access = await requireCompletePairAccess(database, participantId, pairId);
  const rows = await database
    .select({ round: privateRound, question, conversation: privateConversation })
    .from(privateRound)
    .innerJoin(
      privateConversation,
      and(
        eq(privateRound.conversationId, privateConversation.id),
        eq(privateRound.pairId, privateConversation.pairId),
      ),
    )
    .innerJoin(question, eq(privateRound.questionId, question.id))
    .where(
      and(
        eq(privateRound.id, roundId),
        eq(privateRound.pairId, pairId),
        gte(privateRound.createdAt, access.membership.startedAt),
      ),
    )
    .limit(1);
  const result = rows[0];
  if (!result) throw new CloserDomainError("ROUND_NOT_FOUND");
  return { ...access, ...result };
}

function viewerRoundState(
  answerCount: number,
  hasViewerAnswer: boolean,
  revealViewedAt: Date | null,
): "YOUR_TURN" | "WAITING" | "REVEAL_READY" | "REVEAL_VIEWED" {
  if (answerCount === 2) return revealViewedAt ? "REVEAL_VIEWED" : "REVEAL_READY";
  return hasViewerAnswer ? "WAITING" : "YOUR_TURN";
}

export async function listEligiblePrivateQuestions(
  database: Database,
  input: { participantId: string; pairId: string; category: string },
) {
  assertQuestionCategory(input.category);
  const access = await requireCompletePairAccess(database, input.participantId, input.pairId);
  const relationshipCategory = access.pair.relationshipType === "partner" ? "relationship" : "friendship";
  if (input.category === "relationship" || input.category === "friendship") {
    if (input.category !== relationshipCategory) throw new CloserDomainError("QUESTION_UNAVAILABLE");
  }

  const eligibleQuestions = await database
    .select({
      id: question.id,
      text: question.text,
      category: question.category,
      depth: question.depth,
    })
    .from(question)
    .where(
      and(
        eq(question.isActive, true),
        eq(question.category, input.category),
        inArray(question.relationshipFit, ["both", access.pair.relationshipType]),
        inArray(question.modeFit, ["both", "private"]),
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
    const usageDifference = Number(usedQuestionIds.has(left.id)) - Number(usedQuestionIds.has(right.id));
    return usageDifference || left.id.localeCompare(right.id);
  });
}

function assertCategoryForPair(access: { pair: { relationshipType: RelationshipType } }, category: string) {
  assertQuestionCategory(category);
  const relationshipCategory = access.pair.relationshipType === "partner" ? "relationship" : "friendship";
  if ((category === "relationship" || category === "friendship") && category !== relationshipCategory) {
    throw new CloserDomainError("QUESTION_UNAVAILABLE");
  }
}

async function eligiblePrivateQuestions(
  database: Database,
  input: { relationshipType: RelationshipType; category: QuestionCategory },
) {
  return database
    .select({ id: question.id, text: question.text, category: question.category, depth: question.depth })
    .from(question)
    .where(
      and(
        eq(question.isActive, true),
        eq(question.category, input.category),
        inArray(question.relationshipFit, ["both", input.relationshipType]),
        inArray(question.modeFit, ["both", "private"]),
      ),
    );
}

async function latestRoundForConversation(database: Database, conversationId: string) {
  const rows = await database
    .select({ id: privateRound.id, questionId: privateRound.questionId, createdAt: privateRound.createdAt })
    .from(privateRound)
    .where(eq(privateRound.conversationId, conversationId))
    .orderBy(desc(privateRound.createdAt), desc(privateRound.id))
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

async function nextEligibleQuestionForConversation(
  database: Database,
  input: { pairId: string; conversationId: string; relationshipType: RelationshipType; category: QuestionCategory; latestQuestionId?: string },
) {
  // Callers hold a row lock inside one PostgreSQL transaction. This client must
  // execute those reads serially; parallel queries on it trigger driver warnings.
  const eligible = await eligiblePrivateQuestions(database, { relationshipType: input.relationshipType, category: input.category });
  const conversationUsage = await database
    .select({ questionId: privateRound.questionId })
    .from(privateRound)
    .where(eq(privateRound.conversationId, input.conversationId));
  const pairUsage = await database
    .select({ questionId: privateRound.questionId })
    .from(privateRound)
    .where(eq(privateRound.pairId, input.pairId));
  if (!eligible.length) throw new CloserDomainError("QUESTION_UNAVAILABLE");

  const conversationQuestionIds = new Set(conversationUsage.map((row) => row.questionId));
  const pairQuestionIds = new Set(pairUsage.map((row) => row.questionId));
  return eligible.toSorted((left, right) => {
    const conversationUsageDifference = Number(conversationQuestionIds.has(left.id)) - Number(conversationQuestionIds.has(right.id));
    if (conversationUsageDifference) return conversationUsageDifference;
    const pairUsageDifference = Number(pairQuestionIds.has(left.id)) - Number(pairQuestionIds.has(right.id));
    if (pairUsageDifference) return pairUsageDifference;
    // When the whole category has been used, cycle rather than immediately
    // repeating the current question when another eligible prompt exists.
    const currentQuestionDifference = Number(left.id === input.latestQuestionId) - Number(right.id === input.latestQuestionId);
    return currentQuestionDifference || left.id.localeCompare(right.id);
  })[0]!;
}

async function lockPairAndFindConversation(
  database: Database,
  input: { pairId: string; category: QuestionCategory; participantId: string },
) {
  await database.execute(sql`select id from "pair" where id = ${input.pairId} for update`);
  const existing = await database
    .select()
    .from(privateConversation)
    .where(
      and(
        eq(privateConversation.pairId, input.pairId),
        eq(privateConversation.category, input.category),
        isNull(privateConversation.endedAt),
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
        isNull(privateConversation.endedAt),
      ),
    )
    .limit(1);
  if (!resolved[0]) throw new Error("Private conversation creation did not resolve.");
  return resolved[0];
}

async function insertRoundForConversation(
  database: Database,
  input: { pairId: string; conversationId: string; participantId: string; questionId: string; clientRequestId?: string },
) {
  if (input.clientRequestId) {
    const existing = await database
      .select({ id: privateRound.id, conversationId: privateRound.conversationId })
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
      if (existing[0].conversationId !== input.conversationId) throw new CloserDomainError("QUESTION_UNAVAILABLE");
      return { id: existing[0].id };
    }
  }

  const inserted = await database
    .insert(privateRound)
    .values({
      pairId: input.pairId,
      conversationId: input.conversationId,
      questionId: input.questionId,
      initiatorParticipantId: input.participantId,
      clientRequestId: input.clientRequestId,
    })
    .onConflictDoNothing()
    .returning({ id: privateRound.id });
  if (inserted[0]) return { id: inserted[0].id };

  if (!input.clientRequestId) throw new Error("Private round creation did not return a round.");
  const resolved = await database
    .select({ id: privateRound.id, conversationId: privateRound.conversationId })
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
  if (resolved[0].conversationId !== input.conversationId) throw new CloserDomainError("QUESTION_UNAVAILABLE");
  return { id: resolved[0].id };
}

export async function startOrResumePrivateConversation(
  database: Database,
  input: { participantId: string; pairId: string; category: string; clientRequestId?: string },
) {
  const access = await requireCompletePairAccess(database, input.participantId, input.pairId);
  if (input.clientRequestId && !isUuid(input.clientRequestId)) throw new CloserDomainError("QUESTION_UNAVAILABLE");
  assertCategoryForPair(access, input.category);
  const category = input.category as QuestionCategory;

  return database.transaction(async (transaction) => {
    const tx = transaction as unknown as Database;
    const conversation = await lockPairAndFindConversation(tx, {
      pairId: input.pairId,
      category,
      participantId: input.participantId,
    });
    const currentRound = await latestRoundForConversation(tx, conversation.id);
    if (currentRound) return { conversationId: conversation.id, roundId: currentRound.id };

    const nextQuestion = await nextEligibleQuestionForConversation(tx, {
      pairId: input.pairId,
      conversationId: conversation.id,
      relationshipType: access.pair.relationshipType,
      category: conversation.category,
    });
    const round = await insertRoundForConversation(tx, {
      pairId: input.pairId,
      conversationId: conversation.id,
      participantId: input.participantId,
      questionId: nextQuestion.id,
      clientRequestId: input.clientRequestId,
    });
    return { conversationId: conversation.id, roundId: round.id };
  });
}

export async function createNextPrivateRound(
  database: Database,
  input: { participantId: string; pairId: string; conversationId: string; clientRequestId?: string },
) {
  const access = await requireCompletePairAccess(database, input.participantId, input.pairId);
  if (input.clientRequestId && !isUuid(input.clientRequestId)) throw new CloserDomainError("QUESTION_UNAVAILABLE");

  return database.transaction(async (transaction) => {
    const tx = transaction as unknown as Database;
    await tx.execute(sql`select id from "pair" where id = ${input.pairId} for update`);
    const conversations = await tx
      .select()
      .from(privateConversation)
      .where(
        and(
          eq(privateConversation.id, input.conversationId),
          eq(privateConversation.pairId, input.pairId),
          isNull(privateConversation.endedAt),
        ),
      )
      .limit(1);
    const conversation = conversations[0];
    if (!conversation) throw new CloserDomainError("CONVERSATION_NOT_FOUND");
    await tx.execute(sql`select id from "private_conversation" where id = ${conversation.id} for update`);

    const currentRound = await latestRoundForConversation(tx, conversation.id);
    if (!currentRound) throw new CloserDomainError("CONVERSATION_NOT_FOUND");
    if (await answerCountForRound(tx, currentRound.id) < 2) {
      // The first successful Next request may already have made this the new
      // current round; returning it makes retries and double-clicks safe.
      return { conversationId: conversation.id, roundId: currentRound.id };
    }

    const nextQuestion = await nextEligibleQuestionForConversation(tx, {
      pairId: input.pairId,
      conversationId: conversation.id,
      relationshipType: access.pair.relationshipType,
      category: conversation.category,
      latestQuestionId: currentRound.questionId,
    });
    const nextRound = await insertRoundForConversation(tx, {
      pairId: input.pairId,
      conversationId: conversation.id,
      participantId: input.participantId,
      questionId: nextQuestion.id,
      clientRequestId: input.clientRequestId,
    });
    return { conversationId: conversation.id, roundId: nextRound.id };
  });
}

/** @deprecated Use startOrResumePrivateConversation so category flow cannot bypass conversation sequencing. */
export async function createPrivateRound(
  database: Database,
  input: { participantId: string; pairId: string; questionId: string; clientRequestId?: string },
) {
  const selectedQuestion = await database
    .select({ category: question.category })
    .from(question)
    .where(eq(question.id, input.questionId))
    .limit(1);
  if (!selectedQuestion[0]) throw new CloserDomainError("QUESTION_UNAVAILABLE");
  const result = await startOrResumePrivateConversation(database, {
    participantId: input.participantId,
    pairId: input.pairId,
    category: selectedQuestion[0].category,
    clientRequestId: input.clientRequestId,
  });
  return { id: result.roundId };
}

export async function getPrivateRoundForParticipant(
  database: Database,
  input: { participantId: string; pairId: string; roundId: string },
) {
  const context = await loadPrivateRoundContext(database, input.participantId, input.pairId, input.roundId);
  const [answers, viewerReveal] = await Promise.all([
    database.select().from(privateAnswer).where(eq(privateAnswer.roundId, input.roundId)),
    database
      .select({ viewedAt: privateRevealView.viewedAt })
      .from(privateRevealView)
      .where(and(eq(privateRevealView.roundId, input.roundId), eq(privateRevealView.participantId, input.participantId)))
      .limit(1),
  ]);
  const viewerAnswer = answers.find((answer) => answer.participantId === input.participantId) ?? null;
  const isRevealReady = answers.length === 2;
  const revealViewedAt = viewerReveal[0]?.viewedAt ?? null;
  const otherMember = context.members.find((member) => member.participantId !== input.participantId);
  if (!otherMember) throw new CloserDomainError("ROUND_NOT_FOUND");

  const result = {
    id: context.round.id,
    pairId: context.round.pairId,
    conversation: {
      id: context.conversation.id,
      category: context.conversation.category,
      questionNumber: 0,
    },
    question: {
      id: context.question.id,
      text: context.question.text,
      category: context.question.category,
      depth: context.question.depth,
    },
    otherParticipant: { id: otherMember.participantId, displayName: otherMember.displayName },
    yourAnswer: viewerAnswer?.body ?? null,
    state: viewerRoundState(answers.length, viewerAnswer !== null, revealViewedAt),
    revealViewedAt: revealViewedAt?.toISOString() ?? null,
  } as {
    id: string;
    pairId: string;
    conversation: { id: string; category: QuestionCategory; questionNumber: number };
    question: { id: string; text: string; category: QuestionCategory; depth: "light" | "medium" | "deep" };
    otherParticipant: { id: string; displayName: string };
    yourAnswer: string | null;
    state: "YOUR_TURN" | "WAITING" | "REVEAL_READY" | "REVEAL_VIEWED";
    revealViewedAt: string | null;
    answers?: Array<{ participantId: string; displayName: string; body: string }>;
    reactions?: Array<{ participantId: string; displayName: string; value: ReactionValue }>;
    replies?: Array<{ participantId: string; displayName: string; body: string; isOwner: boolean }>;
  };

  const conversationRounds = await database
    .select({ id: privateRound.id })
    .from(privateRound)
    .where(eq(privateRound.conversationId, context.conversation.id))
    .orderBy(asc(privateRound.createdAt), asc(privateRound.id));
  result.conversation.questionNumber = conversationRounds.findIndex((round) => round.id === input.roundId) + 1;

  // Deliberately do not put another participant's answer anywhere in this projection until this exact round is ready.
  if (!isRevealReady) return result;

  const memberNames = new Map(context.members.map((member) => [member.participantId, member.displayName]));
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
): Promise<Array<{
  id: string;
  category: QuestionCategory;
  questionCount: number;
  currentRound: { id: string; question: { id: string; text: string; category: QuestionCategory; depth: "light" | "medium" | "deep" } };
  otherParticipantDisplayName: string;
  state: "YOUR_TURN" | "WAITING" | "REVEAL_READY" | "READY_FOR_NEXT";
}>> {
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
        isNull(privateConversation.endedAt),
        gte(privateConversation.createdAt, access.membership.startedAt),
      ),
    )
    .orderBy(desc(privateConversation.createdAt));
  if (!conversations.length) return [];

  // Pair Home intentionally reads a conversation summary, never answer/reaction/reply
  // payloads. Answer positions for each current round are sufficient to derive state.
  const conversationIds = conversations.map((conversation) => conversation.id);
  const rounds = await database
    .select({
      id: privateRound.id,
      conversationId: privateRound.conversationId,
      question: { id: question.id, text: question.text, category: question.category, depth: question.depth },
      createdAt: privateRound.createdAt,
    })
    .from(privateRound)
    .innerJoin(question, eq(privateRound.questionId, question.id))
    .where(inArray(privateRound.conversationId, conversationIds))
    .orderBy(desc(privateRound.createdAt), desc(privateRound.id));
  if (!rounds.length) return [];

  const currentRoundByConversation = new Map<string, typeof rounds[number]>();
  const questionCountByConversation = new Map<string, number>();
  for (const round of rounds) {
    questionCountByConversation.set(round.conversationId, (questionCountByConversation.get(round.conversationId) ?? 0) + 1);
    if (!currentRoundByConversation.has(round.conversationId)) currentRoundByConversation.set(round.conversationId, round);
  }
  const currentRoundIds = [...currentRoundByConversation.values()].map((round) => round.id);
  const [answerPositions, revealViews] = await Promise.all([
    database
      .select({ roundId: privateAnswer.roundId, participantId: privateAnswer.participantId })
      .from(privateAnswer)
      .where(inArray(privateAnswer.roundId, currentRoundIds)),
    database
      .select({ roundId: privateRevealView.roundId, viewedAt: privateRevealView.viewedAt })
      .from(privateRevealView)
      .where(and(inArray(privateRevealView.roundId, currentRoundIds), eq(privateRevealView.participantId, input.participantId))),
  ]);
  const answersByRound = new Map<string, Array<{ participantId: string }>>();
  for (const answer of answerPositions) {
    const positions = answersByRound.get(answer.roundId) ?? [];
    positions.push(answer);
    answersByRound.set(answer.roundId, positions);
  }
  const viewedRoundIds = new Set(revealViews.map((view) => view.roundId));
  const otherMember = access.members.find((member) => member.participantId !== input.participantId);
  if (!otherMember) throw new CloserDomainError("ROUND_NOT_FOUND");

  return conversations.flatMap((conversation) => {
    const currentRound = currentRoundByConversation.get(conversation.id);
    if (!currentRound) return [];
    const answerPositionsForRound = answersByRound.get(currentRound.id) ?? [];
    const currentState = viewerRoundState(
      answerPositionsForRound.length,
      answerPositionsForRound.some((answer) => answer.participantId === input.participantId),
      viewedRoundIds.has(currentRound.id) ? new Date() : null,
    );
    return [{
      id: conversation.id,
      category: conversation.category,
      questionCount: questionCountByConversation.get(conversation.id) ?? 0,
      currentRound: { id: currentRound.id, question: currentRound.question },
      otherParticipantDisplayName: otherMember.displayName,
      state: currentState === "REVEAL_VIEWED" ? "READY_FOR_NEXT" : currentState,
    }];
  });
}

/** @deprecated Pair Home must use conversation summaries. */
export const listActivePrivateRounds = listActivePrivateConversations;

export async function submitPrivateAnswer(
  database: Database,
  input: { participantId: string; pairId: string; roundId: string; body: string },
) {
  const body = normalizePrivateText(input.body, 2000, "ANSWER_INVALID");
  await loadPrivateRoundContext(database, input.participantId, input.pairId, input.roundId);
  const inserted = await database
    .insert(privateAnswer)
    .values({ roundId: input.roundId, participantId: input.participantId, body })
    .onConflictDoNothing()
    .returning({ body: privateAnswer.body });

  if (!inserted[0]) {
    const existing = await database
      .select({ body: privateAnswer.body })
      .from(privateAnswer)
      .where(and(eq(privateAnswer.roundId, input.roundId), eq(privateAnswer.participantId, input.participantId)))
      .limit(1);
    if (!existing[0]) throw new Error("Private answer submission did not resolve.");
    if (existing[0].body !== body) throw new CloserDomainError("ANSWER_IMMUTABLE");
  }
  return getPrivateRoundForParticipant(database, input);
}

export async function markPrivateRevealViewed(
  database: Database,
  input: { participantId: string; pairId: string; roundId: string },
) {
  const view = await getPrivateRoundForParticipant(database, input);
  if (!view.answers) throw new CloserDomainError("REVEAL_NOT_READY");
  await database
    .insert(privateRevealView)
    .values({ roundId: input.roundId, participantId: input.participantId })
    .onConflictDoNothing();
  return getPrivateRoundForParticipant(database, input);
}

async function requireRevealViewed(database: Database, input: { participantId: string; pairId: string; roundId: string }) {
  const view = await getPrivateRoundForParticipant(database, input);
  if (!view.answers || view.state !== "REVEAL_VIEWED") throw new CloserDomainError("REVEAL_NOT_READY");
}

export async function setPrivateReaction(
  database: Database,
  input: { participantId: string; pairId: string; roundId: string; value: string },
) {
  assertReactionValue(input.value);
  await requireRevealViewed(database, input);
  await database
    .insert(privateReaction)
    .values({ roundId: input.roundId, participantId: input.participantId, value: input.value })
    .onConflictDoUpdate({
      target: [privateReaction.roundId, privateReaction.participantId],
      set: { value: input.value, updatedAt: new Date() },
    });
  return getPrivateRoundForParticipant(database, input);
}

export async function removePrivateReaction(
  database: Database,
  input: { participantId: string; pairId: string; roundId: string },
) {
  await requireRevealViewed(database, input);
  await database
    .delete(privateReaction)
    .where(and(eq(privateReaction.roundId, input.roundId), eq(privateReaction.participantId, input.participantId)));
  return getPrivateRoundForParticipant(database, input);
}

export async function setPrivateReply(
  database: Database,
  input: { participantId: string; pairId: string; roundId: string; body: string },
) {
  const body = normalizePrivateText(input.body, 500, "REPLY_INVALID");
  await requireRevealViewed(database, input);
  await database
    .insert(privateReply)
    .values({ roundId: input.roundId, participantId: input.participantId, body })
    .onConflictDoUpdate({
      target: [privateReply.roundId, privateReply.participantId],
      set: { body, updatedAt: new Date() },
    });
  return getPrivateRoundForParticipant(database, input);
}

export async function removePrivateReply(
  database: Database,
  input: { participantId: string; pairId: string; roundId: string },
) {
  await requireRevealViewed(database, input);
  await database
    .delete(privateReply)
    .where(and(eq(privateReply.roundId, input.roundId), eq(privateReply.participantId, input.participantId)));
  return getPrivateRoundForParticipant(database, input);
}

export { INITIAL_INVITE_LIFETIME_MS, normalizeDisplayName };
