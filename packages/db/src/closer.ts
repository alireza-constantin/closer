import { createHash, randomBytes } from "node:crypto";

import { and, eq, gt, isNull, sql } from "drizzle-orm";

import { createDb } from "./index";
import { initialInvite, pair, pairMembership, participant } from "./schema/closer";

type Database = ReturnType<typeof createDb>;
type RelationshipType = "partner" | "friend";

const INITIAL_INVITE_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

export class CloserDomainError extends Error {
  constructor(
    readonly code:
      | "DISPLAY_NAME_INVALID"
      | "RELATIONSHIP_TYPE_INVALID"
      | "UNAUTHENTICATED"
      | "PAIR_NOT_FOUND"
      | "INVITE_UNAVAILABLE",
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

function assertRelationshipType(value: string): asserts value is RelationshipType {
  if (value !== "partner" && value !== "friend") {
    throw new CloserDomainError("RELATIONSHIP_TYPE_INVALID");
  }
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

async function issueInitialInviteInTransaction(
  tx: Parameters<Parameters<Database["transaction"]>[0]>[0],
  pairId: string,
) {
  await tx.execute(sql`select id from "pair" where id = ${pairId} for update`);
  const occupiedSecondSlot = await tx
    .select({ id: pairMembership.id })
    .from(pairMembership)
    .where(
      and(
        eq(pairMembership.pairId, pairId),
        eq(pairMembership.slot, "second"),
        isNull(pairMembership.endedAt),
      ),
    )
    .limit(1);
  if (occupiedSecondSlot[0]) throw new CloserDomainError("INVITE_UNAVAILABLE");

  const token = createInviteToken();
  const expiresAt = new Date(Date.now() + INITIAL_INVITE_LIFETIME_MS);

  await tx
    .update(initialInvite)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(initialInvite.pairId, pairId),
        isNull(initialInvite.revokedAt),
        isNull(initialInvite.redeemedAt),
      ),
    );

  await tx.insert(initialInvite).values({
    pairId,
    tokenHash: hashInviteToken(token),
    expiresAt,
  });

  return { token, expiresAt };
}

export async function createPairForParticipant(
  database: Database,
  input: { participantId: string; relationshipType: string },
) {
  const relationshipType = input.relationshipType;
  assertRelationshipType(relationshipType);

  return database.transaction(async (tx) => {
    const pairs = await tx.insert(pair).values({ relationshipType }).returning();
    const createdPair = pairs[0];
    if (!createdPair) throw new Error("Pair creation did not return a pair.");

    await tx.insert(pairMembership).values({
      pairId: createdPair.id,
      participantId: input.participantId,
      slot: "first",
    });

    const invite = await issueInitialInviteInTransaction(tx, createdPair.id);
    return { pair: createdPair, invite };
  });
}

export async function issueInitialInvite(
  database: Database,
  input: { participantId: string; pairId: string },
) {
  await requireActivePairAccess(database, input.participantId, input.pairId);
  return database.transaction((tx) => issueInitialInviteInTransaction(tx, input.pairId));
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

    return { pairId: invite.pairId };
  });
}

export async function getPairForParticipant(database: Database, participantId: string, pairId: string) {
  const access = await requireActivePairAccess(database, participantId, pairId);
  const members = await database
    .select({
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

export { INITIAL_INVITE_LIFETIME_MS, normalizeDisplayName };
