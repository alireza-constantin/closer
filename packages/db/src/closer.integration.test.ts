import { randomUUID } from "node:crypto";

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import dotenv from "dotenv";

dotenv.config({ path: new URL("../../../apps/web/.env", import.meta.url) });

const { createDb } = await import("./index");
const {
  CloserDomainError,
  createPairForParticipant,
  getPairForParticipant,
  getPairStatusForParticipant,
  getParticipantByAuthUserId,
  getRejoinInviteLanding,
  issueInitialInvite,
  issueRejoinInvite,
  listActivePairsForParticipant,
  redeemRejoinInvite,
  redeemInitialInvite,
  resolveOrCreateParticipant,
  revokeInitialInvites,
} = await import("./closer");
const { initialInvite, pair, pairMembership, participant, rejoinInvite } = await import("./schema/closer");
const { user } = await import("./schema/auth");
const { and, eq, inArray, isNull } = await import("drizzle-orm");

const db = createDb();
const createdAuthUserIds: string[] = [];
const createdPairIds: string[] = [];

async function createAnonymousAuthUser(name = "Anonymous test user") {
  const id = randomUUID();
  createdAuthUserIds.push(id);
  await db.insert(user).values({
    id,
    name,
    email: `${id}@test.closer.invalid`,
    isAnonymous: true,
  });
  return id;
}

async function createParticipant(displayName: string) {
  const authUserId = await createAnonymousAuthUser();
  return resolveOrCreateParticipant(db, { authUserId, displayName });
}

async function createPair(displayName = "Creator", relationshipType: "partner" | "friend" = "partner") {
  const creator = await createParticipant(displayName);
  const result = await createPairForParticipant(db, { participantId: creator.id, relationshipType });
  createdPairIds.push(result.pair.id);
  return { creator, ...result };
}

async function captureError(promise: Promise<unknown>) {
  return promise.then(
    () => null,
    (error: unknown) => error,
  );
}

afterEach(async () => {
  if (createdPairIds.length > 0) {
    await db.delete(initialInvite).where(inArray(initialInvite.pairId, createdPairIds));
    await db.delete(rejoinInvite).where(inArray(rejoinInvite.pairId, createdPairIds));
    await db.delete(pairMembership).where(inArray(pairMembership.pairId, createdPairIds));
    await db.delete(pair).where(inArray(pair.id, createdPairIds));
  }
  if (createdAuthUserIds.length > 0) {
    await db.delete(participant).where(inArray(participant.authUserId, createdAuthUserIds));
    await db.delete(user).where(inArray(user.id, createdAuthUserIds));
  }
  createdPairIds.length = 0;
  createdAuthUserIds.length = 0;
});

afterAll(async () => {
  await db.$client.end();
});

describe("Closer Slice 01A", () => {
  test("an anonymous Better Auth user resolves once to one stable trimmed participant", async () => {
    const authUserId = await createAnonymousAuthUser();

    const first = await resolveOrCreateParticipant(db, { authUserId, displayName: "  Ari  " });
    const second = await resolveOrCreateParticipant(db, { authUserId, displayName: "Other value is ignored" });

    expect(first.id).toBe(second.id);
    expect(first.id).not.toBe(authUserId);
    expect(first.displayName).toBe("Ari");
    expect((await getParticipantByAuthUserId(db, authUserId))?.id).toBe(first.id);
  });

  test("creates partner and friend pairs with their creator in the first logical slot", async () => {
    const partnerPair = await createPair("Partner creator", "partner");
    const friendPair = await createPair("Friend creator", "friend");

    expect(partnerPair.pair.relationshipType).toBe("partner");
    expect(friendPair.pair.relationshipType).toBe("friend");

    const memberships = await db.select().from(pairMembership).where(inArray(pairMembership.pairId, [partnerPair.pair.id, friendPair.pair.id]));
    expect(memberships).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ pairId: partnerPair.pair.id, participantId: partnerPair.creator.id, slot: "first", endedAt: null }),
        expect.objectContaining({ pairId: friendPair.pair.id, participantId: friendPair.creator.id, slot: "first", endedAt: null }),
      ]),
    );
  });

  test("retries the same pair-creation request without creating a duplicate pair", async () => {
    const creator = await createParticipant("Retry creator");
    const clientRequestId = randomUUID();
    const first = await createPairForParticipant(db, { participantId: creator.id, relationshipType: "partner", clientRequestId });
    createdPairIds.push(first.pair.id);
    const second = await createPairForParticipant(db, { participantId: creator.id, relationshipType: "partner", clientRequestId });

    expect(second.pair.id).toBe(first.pair.id);
    expect(await db.select().from(pair).where(eq(pair.id, first.pair.id))).toHaveLength(1);
  });

  test("lists zero, one, and multiple active spaces without choosing one", async () => {
    const participantWithoutPair = await createParticipant("Not paired yet");
    expect(await listActivePairsForParticipant(db, participantWithoutPair.id)).toEqual([]);

    const created = await createPair();
    expect(await listActivePairsForParticipant(db, created.creator.id)).toEqual([
      expect.objectContaining({
        pairId: created.pair.id,
        relationshipType: "partner",
        state: "waiting",
        otherParticipantDisplayName: null,
      }),
    ]);

    const invitee = await createParticipant("Invitee");
    await redeemInitialInvite(db, { token: created.invite.token, participantId: invitee.id });
    expect(await listActivePairsForParticipant(db, invitee.id)).toEqual([
      expect.objectContaining({
        pairId: created.pair.id,
        relationshipType: "partner",
        state: "connected",
        otherParticipantDisplayName: "Creator",
      }),
    ]);
  });

  test("one participant can keep Partner, Friend, and multiple Friend spaces active", async () => {
    const creator = await createParticipant("Ali");
    const partner = await createPairForParticipant(db, { participantId: creator.id, relationshipType: "partner" });
    const friend = await createPairForParticipant(db, { participantId: creator.id, relationshipType: "friend" });
    const anotherFriend = await createPairForParticipant(db, { participantId: creator.id, relationshipType: "friend" });
    createdPairIds.push(partner.pair.id, friend.pair.id, anotherFriend.pair.id);

    const friendSpaces = await listActivePairsForParticipant(db, creator.id);
    expect(friendSpaces).toHaveLength(3);
    expect(friendSpaces).toEqual(expect.arrayContaining([
      expect.objectContaining({ pairId: partner.pair.id, relationshipType: "partner", state: "waiting" }),
      expect.objectContaining({ pairId: friend.pair.id, relationshipType: "friend", state: "waiting" }),
      expect.objectContaining({ pairId: anotherFriend.pair.id, relationshipType: "friend", state: "waiting" }),
    ]));

    const membershipRows = await db
      .select()
      .from(pairMembership)
      .where(and(eq(pairMembership.participantId, creator.id), isNull(pairMembership.endedAt)));
    expect(membershipRows).toHaveLength(3);
  });

  test("an existing participant can redeem a new invite without losing another space", async () => {
    const existingSpace = await createPair("Existing creator", "partner");
    const existingParticipant = await createParticipant("Ali");
    await redeemInitialInvite(db, { token: existingSpace.invite.token, participantId: existingParticipant.id });

    const newSpaceOwner = await createPair("New friend", "friend");
    await redeemInitialInvite(db, { token: newSpaceOwner.invite.token, participantId: existingParticipant.id });

    const spaces = await listActivePairsForParticipant(db, existingParticipant.id);
    expect(spaces).toHaveLength(2);
    expect(spaces).toEqual(expect.arrayContaining([
      expect.objectContaining({ pairId: existingSpace.pair.id, relationshipType: "partner", otherParticipantDisplayName: "Existing creator" }),
      expect.objectContaining({ pairId: newSpaceOwner.pair.id, relationshipType: "friend", otherParticipantDisplayName: "New friend" }),
    ]));
  });

  test("a pending space coexists with a completed space", async () => {
    const completedSpace = await createPair("Partner owner", "partner");
    const participant = await createParticipant("Ali");
    await redeemInitialInvite(db, { token: completedSpace.invite.token, participantId: participant.id });

    const pendingSpace = await createPairForParticipant(db, { participantId: participant.id, relationshipType: "friend" });
    createdPairIds.push(pendingSpace.pair.id);

    expect(await listActivePairsForParticipant(db, participant.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({ pairId: completedSpace.pair.id, state: "connected", otherParticipantDisplayName: "Partner owner" }),
      expect.objectContaining({ pairId: pendingSpace.pair.id, state: "waiting", otherParticipantDisplayName: null }),
    ]));
  });

  test("redeems an opaque initial invite into the empty second slot and authorizes both members", async () => {
    const created = await createPair();
    const invitee = await createParticipant("Invitee");

    const redemption = await redeemInitialInvite(db, { token: created.invite.token, participantId: invitee.id });
    expect(redemption.pairId).toBe(created.pair.id);

    const storedInvite = await db.select().from(initialInvite).where(eq(initialInvite.pairId, created.pair.id));
    expect(storedInvite[0]?.tokenHash).not.toBe(created.invite.token);
    expect(storedInvite[0]?.redeemedByParticipantId).toBe(invitee.id);

    const creatorView = await getPairForParticipant(db, created.creator.id, created.pair.id);
    const inviteeView = await getPairForParticipant(db, invitee.id, created.pair.id);
    expect(creatorView.members).toHaveLength(2);
    expect(inviteeView.members).toHaveLength(2);
  });

  test("does not redeem an initial invitation twice", async () => {
    const created = await createPair();
    const firstInvitee = await createParticipant("First invitee");
    const replayingInvitee = await createParticipant("Replay invitee");

    await redeemInitialInvite(db, { token: created.invite.token, participantId: firstInvitee.id });
    const replayError = await captureError(
      redeemInitialInvite(db, { token: created.invite.token, participantId: replayingInvitee.id }),
    );
    expect(replayError).toMatchObject({ code: "INVITE_UNAVAILABLE" });
    expect(
      await captureError(issueInitialInvite(db, { participantId: created.creator.id, pairId: created.pair.id })),
    ).toMatchObject({ code: "INVITE_UNAVAILABLE" });
  });

  test("does not let the creator redeem their own invite, while preserving it for a second participant", async () => {
    const created = await createPair();

    const selfRedemptionError = await captureError(
      redeemInitialInvite(db, { token: created.invite.token, participantId: created.creator.id }),
    );
    expect(selfRedemptionError).toMatchObject({ code: "INVITE_UNAVAILABLE" });

    const creatorMemberships = await db
      .select()
      .from(pairMembership)
      .where(
        and(
          eq(pairMembership.pairId, created.pair.id),
          eq(pairMembership.participantId, created.creator.id),
          isNull(pairMembership.endedAt),
        ),
      );
    expect(creatorMemberships).toHaveLength(1);
    expect(creatorMemberships[0]?.slot).toBe("first");

    const activeSecondSlot = await db
      .select()
      .from(pairMembership)
      .where(
        and(
          eq(pairMembership.pairId, created.pair.id),
          eq(pairMembership.slot, "second"),
          isNull(pairMembership.endedAt),
        ),
      );
    expect(activeSecondSlot).toHaveLength(0);

    const inviteAfterSelfRedemption = await db
      .select()
      .from(initialInvite)
      .where(eq(initialInvite.pairId, created.pair.id));
    expect(inviteAfterSelfRedemption[0]?.redeemedAt).toBeNull();
    expect(inviteAfterSelfRedemption[0]?.revokedAt).toBeNull();

    const legitimateInvitee = await createParticipant("Legitimate invitee");
    await redeemInitialInvite(db, { token: created.invite.token, participantId: legitimateInvitee.id });

    const allActiveMemberships = await db
      .select()
      .from(pairMembership)
      .where(and(eq(pairMembership.pairId, created.pair.id), isNull(pairMembership.endedAt)));
    expect(allActiveMemberships).toHaveLength(2);
    expect(allActiveMemberships).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ participantId: created.creator.id, slot: "first" }),
        expect.objectContaining({ participantId: legitimateInvitee.id, slot: "second" }),
      ]),
    );
  });

  test("rejects expired and revoked invitations", async () => {
    const expired = await createPair();
    const expiredInvitee = await createParticipant("Expired invitee");
    await db
      .update(initialInvite)
      .set({ expiresAt: new Date(Date.now() - 1) })
      .where(eq(initialInvite.pairId, expired.pair.id));
    expect(
      await captureError(redeemInitialInvite(db, { token: expired.invite.token, participantId: expiredInvitee.id })),
    ).toMatchObject({ code: "INVITE_UNAVAILABLE" });

    const revoked = await createPair();
    const revokedInvitee = await createParticipant("Revoked invitee");
    await revokeInitialInvites(db, { participantId: revoked.creator.id, pairId: revoked.pair.id });
    expect(
      await captureError(redeemInitialInvite(db, { token: revoked.invite.token, participantId: revokedInvitee.id })),
    ).toMatchObject({ code: "INVITE_UNAVAILABLE" });
  });

  test("serializes concurrent redemption so one slot has one active occupant", async () => {
    const created = await createPair();
    const firstInvitee = await createParticipant("Concurrent one");
    const secondInvitee = await createParticipant("Concurrent two");

    const results = await Promise.allSettled([
      redeemInitialInvite(db, { token: created.invite.token, participantId: firstInvitee.id }),
      redeemInitialInvite(db, { token: created.invite.token, participantId: secondInvitee.id }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);

    const secondSlotMembers = await db
      .select()
      .from(pairMembership)
      .where(and(eq(pairMembership.pairId, created.pair.id), eq(pairMembership.slot, "second")));
    expect(secondSlotMembers).toHaveLength(1);
    expect(secondSlotMembers[0]?.endedAt).toBeNull();
  });

  test("does not authorize an unrelated participant from a supplied pair ID", async () => {
    const created = await createPair();
    const unrelated = await createParticipant("Unrelated");

    expect(await captureError(getPairForParticipant(db, unrelated.id, created.pair.id))).toBeInstanceOf(CloserDomainError);
  });

  test("returns an authorized minimal status that changes when the second slot is occupied", async () => {
    const created = await createPair();
    const invitee = await createParticipant("Invitee");

    expect(await getPairStatusForParticipant(db, created.creator.id, created.pair.id)).toEqual({ state: "waiting" });

    await redeemInitialInvite(db, { token: created.invite.token, participantId: invitee.id });

    expect(await getPairStatusForParticipant(db, created.creator.id, created.pair.id)).toEqual({
      state: "connected",
      otherParticipantDisplayName: "Invitee",
    });
    expect(await getPairStatusForParticipant(db, invitee.id, created.pair.id)).toEqual({
      state: "connected",
      otherParticipantDisplayName: "Creator",
    });
  });

  test("does not disclose pair status to an unrelated participant", async () => {
    const created = await createPair();
    const unrelated = await createParticipant("Unrelated");

    expect(await captureError(getPairStatusForParticipant(db, unrelated.id, created.pair.id))).toBeInstanceOf(CloserDomainError);
  });

  test("rejoin links are slot-bound, single-use, and symmetric for guest members", async () => {
    const created = await createPair();
    const invitee = await createParticipant("Invitee");
    await redeemInitialInvite(db, { token: created.invite.token, participantId: invitee.id });

    const replacement = await createParticipant("Replacement");
    const rejoin = await issueRejoinInvite(db, { participantId: created.creator.id, pairId: created.pair.id });
    expect(rejoin.targetSlot).toBe("second");
    expect((await getRejoinInviteLanding(db, rejoin.token))?.targetSlot).toBe("second");

    await redeemRejoinInvite(db, { token: rejoin.token, participantId: replacement.id });
    const activeMembers = await db
      .select()
      .from(pairMembership)
      .where(and(eq(pairMembership.pairId, created.pair.id), isNull(pairMembership.endedAt)));
    expect(activeMembers).toEqual(expect.arrayContaining([
      expect.objectContaining({ participantId: created.creator.id, slot: "first" }),
      expect.objectContaining({ participantId: replacement.id, slot: "second" }),
    ]));
    expect(activeMembers).not.toEqual(expect.arrayContaining([expect.objectContaining({ participantId: invitee.id })]));
    expect(await captureError(redeemRejoinInvite(db, { token: rejoin.token, participantId: invitee.id }))).toMatchObject({ code: "REJOIN_UNAVAILABLE" });

    const reverse = await issueRejoinInvite(db, { participantId: replacement.id, pairId: created.pair.id });
    expect(reverse.targetSlot).toBe("first");
  });

  test("concurrent first-time resolution maps one auth user to one participant", async () => {
    const authUserId = await createAnonymousAuthUser();

    const results = await Promise.all([
      resolveOrCreateParticipant(db, { authUserId, displayName: "Concurrent Ari" }),
      resolveOrCreateParticipant(db, { authUserId, displayName: "Concurrent Bea" }),
    ]);

    expect(results[0]?.id).toBe(results[1]?.id);
    const rows = await db.select().from(participant).where(eq(participant.authUserId, authUserId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(results[0]?.id);
  });
});
