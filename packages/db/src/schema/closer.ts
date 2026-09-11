import { relations, sql } from "drizzle-orm";
import {
  check,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { user } from "./auth";

export const pairRelationshipType = pgEnum("pair_relationship_type", ["partner", "friend"]);
export const pairSlot = pgEnum("pair_slot", ["first", "second"]);

export const participant = pgTable(
  "participant",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    authUserId: text("auth_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    displayName: text("display_name").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("participant_auth_user_id_uidx").on(table.authUserId),
    check(
      "participant_display_name_valid",
      sql`char_length(${table.displayName}) between 1 and 40 and ${table.displayName} = btrim(${table.displayName})`,
    ),
  ],
);

export const pair = pgTable("pair", {
  id: uuid("id").defaultRandom().primaryKey(),
  relationshipType: pairRelationshipType("relationship_type").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const pairMembership = pgTable(
  "pair_membership",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    pairId: uuid("pair_id")
      .notNull()
      .references(() => pair.id, { onDelete: "cascade" }),
    participantId: uuid("participant_id")
      .notNull()
      .references(() => participant.id, { onDelete: "restrict" }),
    slot: pairSlot("slot").notNull(),
    startedAt: timestamp("started_at").defaultNow().notNull(),
    endedAt: timestamp("ended_at"),
  },
  (table) => [
    uniqueIndex("pair_membership_one_active_slot_uidx")
      .on(table.pairId, table.slot)
      .where(sql`${table.endedAt} is null`),
    uniqueIndex("pair_membership_one_active_participant_uidx")
      .on(table.pairId, table.participantId)
      .where(sql`${table.endedAt} is null`),
    index("pair_membership_active_participant_idx")
      .on(table.participantId, table.pairId)
      .where(sql`${table.endedAt} is null`),
  ],
);

export const initialInvite = pgTable(
  "initial_invite",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    pairId: uuid("pair_id")
      .notNull()
      .references(() => pair.id, { onDelete: "cascade" }),
    slot: pairSlot("slot").notNull().default("second"),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    revokedAt: timestamp("revoked_at"),
    redeemedAt: timestamp("redeemed_at"),
    redeemedByParticipantId: uuid("redeemed_by_participant_id").references(() => participant.id, {
      onDelete: "restrict",
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("initial_invite_token_hash_uidx").on(table.tokenHash),
    index("initial_invite_pair_idx").on(table.pairId),
    check("initial_invite_second_slot_only", sql`${table.slot} = 'second'`),
  ],
);

export const participantRelations = relations(participant, ({ many }) => ({
  memberships: many(pairMembership),
  redeemedInitialInvites: many(initialInvite),
}));

export const pairRelations = relations(pair, ({ many }) => ({
  memberships: many(pairMembership),
  initialInvites: many(initialInvite),
}));

export const pairMembershipRelations = relations(pairMembership, ({ one }) => ({
  pair: one(pair, { fields: [pairMembership.pairId], references: [pair.id] }),
  participant: one(participant, {
    fields: [pairMembership.participantId],
    references: [participant.id],
  }),
}));

export const initialInviteRelations = relations(initialInvite, ({ one }) => ({
  pair: one(pair, { fields: [initialInvite.pairId], references: [pair.id] }),
  redeemedByParticipant: one(participant, {
    fields: [initialInvite.redeemedByParticipantId],
    references: [participant.id],
  }),
}));
