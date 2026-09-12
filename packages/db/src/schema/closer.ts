import { relations, sql } from "drizzle-orm";
import {
  check,
  boolean,
  foreignKey,
  integer,
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
export const questionCategory = pgEnum("question_category", ["fun", "deep", "memories", "relationship", "friendship"]);
export const questionRelationshipFit = pgEnum("question_relationship_fit", ["both", "partner", "friend"]);
export const questionModeFit = pgEnum("question_mode_fit", ["both", "together", "private"]);
export const questionDepth = pgEnum("question_depth", ["light", "medium", "deep"]);
export const privateReactionValue = pgEnum("private_reaction_value", ["heart", "laugh", "tender", "surprised"]);

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
  intendedPersonName: text("intended_person_name"),
  creationRequestId: uuid("creation_request_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("pair_creation_request_uidx").on(table.creationRequestId),
  check(
    "pair_intended_person_name_valid",
    sql`${table.intendedPersonName} is null or (char_length(${table.intendedPersonName}) between 1 and 40 and ${table.intendedPersonName} = btrim(${table.intendedPersonName}))`,
  ),
]);

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

/**
 * An internal, stable authorization boundary for a Pair's two active
 * memberships.  The pre-claim period intentionally has no era row.
 */
export const pairMembershipEra = pgTable(
  "pair_membership_era",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    pairId: uuid("pair_id")
      .notNull()
      .references(() => pair.id, { onDelete: "cascade" }),
    startedAt: timestamp("started_at").defaultNow().notNull(),
    endedAt: timestamp("ended_at"),
  },
  (table) => [
    uniqueIndex("pair_membership_era_one_active_uidx")
      .on(table.pairId)
      .where(sql`${table.endedAt} is null`),
    index("pair_membership_era_pair_started_idx").on(table.pairId, table.startedAt),
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

export const question = pgTable(
  "question",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    text: text("text").notNull(),
    category: questionCategory("category").notNull(),
    relationshipFit: questionRelationshipFit("relationship_fit").notNull(),
    modeFit: questionModeFit("mode_fit").notNull(),
    depth: questionDepth("depth").notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("question_private_selection_idx").on(table.isActive, table.category, table.modeFit, table.relationshipFit),
    check("question_text_not_blank", sql`char_length(btrim(${table.text})) > 0`),
    check(
      "question_category_relationship_fit_valid",
      sql`(${table.category} not in ('relationship', 'friendship')) or (${table.category} = 'relationship' and ${table.relationshipFit} = 'partner') or (${table.category} = 'friendship' and ${table.relationshipFit} = 'friend')`,
    ),
  ],
);

export const privateConversation = pgTable(
  "private_conversation",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    pairId: uuid("pair_id")
      .notNull()
      .references(() => pair.id, { onDelete: "cascade" }),
    category: questionCategory("category").notNull(),
    createdByParticipantId: uuid("created_by_participant_id")
      .notNull()
      .references(() => participant.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    endedAt: timestamp("ended_at"),
  },
  (table) => [
    uniqueIndex("private_conversation_one_active_category_uidx")
      .on(table.pairId, table.category)
      .where(sql`${table.endedAt} is null`),
    uniqueIndex("private_conversation_pair_id_id_uidx").on(table.pairId, table.id),
    index("private_conversation_pair_created_idx").on(table.pairId, table.createdAt),
  ],
);

export const privateRound = pgTable(
  "private_round",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    pairId: uuid("pair_id")
      .notNull()
      .references(() => pair.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id").notNull(),
    questionId: uuid("question_id")
      .notNull()
      .references(() => question.id, { onDelete: "restrict" }),
    initiatorParticipantId: uuid("initiator_participant_id")
      .notNull()
      .references(() => participant.id, { onDelete: "restrict" }),
    clientRequestId: uuid("client_request_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.pairId, table.conversationId],
      foreignColumns: [privateConversation.pairId, privateConversation.id],
      name: "private_round_pair_conversation_consistent_fk",
    }).onDelete("cascade"),
    index("private_round_pair_created_idx").on(table.pairId, table.createdAt),
    index("private_round_conversation_created_idx").on(table.conversationId, table.createdAt),
    uniqueIndex("private_round_idempotency_uidx")
      .on(table.pairId, table.initiatorParticipantId, table.clientRequestId)
      .where(sql`${table.clientRequestId} is not null`),
  ],
);

export const privateAnswer = pgTable(
  "private_answer",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    roundId: uuid("round_id")
      .notNull()
      .references(() => privateRound.id, { onDelete: "cascade" }),
    participantId: uuid("participant_id")
      .notNull()
      .references(() => participant.id, { onDelete: "restrict" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("private_answer_round_participant_uidx").on(table.roundId, table.participantId),
    check(
      "private_answer_body_valid",
      sql`char_length(${table.body}) between 1 and 2000 and ${table.body} = btrim(${table.body})`,
    ),
  ],
);

export const privateRevealView = pgTable(
  "private_reveal_view",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    roundId: uuid("round_id")
      .notNull()
      .references(() => privateRound.id, { onDelete: "cascade" }),
    participantId: uuid("participant_id")
      .notNull()
      .references(() => participant.id, { onDelete: "restrict" }),
    viewedAt: timestamp("viewed_at").defaultNow().notNull(),
  },
  (table) => [uniqueIndex("private_reveal_view_round_participant_uidx").on(table.roundId, table.participantId)],
);

export const privateReaction = pgTable(
  "private_reaction",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    roundId: uuid("round_id")
      .notNull()
      .references(() => privateRound.id, { onDelete: "cascade" }),
    participantId: uuid("participant_id")
      .notNull()
      .references(() => participant.id, { onDelete: "restrict" }),
    value: privateReactionValue("value").notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [uniqueIndex("private_reaction_round_participant_uidx").on(table.roundId, table.participantId)],
);

export const privateReply = pgTable(
  "private_reply",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    roundId: uuid("round_id")
      .notNull()
      .references(() => privateRound.id, { onDelete: "cascade" }),
    participantId: uuid("participant_id")
      .notNull()
      .references(() => participant.id, { onDelete: "restrict" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("private_reply_round_participant_uidx").on(table.roundId, table.participantId),
    check(
      "private_reply_body_valid",
      sql`char_length(${table.body}) between 1 and 500 and ${table.body} = btrim(${table.body})`,
    ),
  ],
);

export const togetherSession = pgTable(
  "together_session",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    pairId: uuid("pair_id")
      .notNull()
      .references(() => pair.id, { onDelete: "cascade" }),
    membershipEraId: uuid("membership_era_id").references(() => pairMembershipEra.id, { onDelete: "restrict" }),
    category: questionCategory("category").notNull(),
    startedByParticipantId: uuid("started_by_participant_id")
      .notNull()
      .references(() => participant.id, { onDelete: "restrict" }),
    startedAt: timestamp("started_at").defaultNow().notNull(),
    endedAt: timestamp("ended_at"),
    startRequestId: uuid("start_request_id"),
  },
  (table) => [
    uniqueIndex("together_session_start_request_uidx")
      .on(table.pairId, table.startedByParticipantId, table.startRequestId)
      .where(sql`${table.startRequestId} is not null`),
    uniqueIndex("together_session_pair_id_id_uidx").on(table.pairId, table.id),
    index("together_session_pair_started_idx").on(table.pairId, table.startedAt),
  ],
);

export const rejoinInvite = pgTable(
  "rejoin_invite",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    pairId: uuid("pair_id")
      .notNull()
      .references(() => pair.id, { onDelete: "cascade" }),
    targetSlot: pairSlot("target_slot").notNull(),
    targetParticipantId: uuid("target_participant_id")
      .notNull()
      .references(() => participant.id, { onDelete: "restrict" }),
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
    uniqueIndex("rejoin_invite_token_hash_uidx").on(table.tokenHash),
    index("rejoin_invite_pair_idx").on(table.pairId),
    index("rejoin_invite_target_idx").on(table.pairId, table.targetSlot, table.targetParticipantId),
  ],
);

export const togetherSessionQuestion = pgTable(
  "together_session_question",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => togetherSession.id, { onDelete: "cascade" }),
    questionId: uuid("question_id")
      .notNull()
      .references(() => question.id, { onDelete: "restrict" }),
    position: integer("position").notNull(),
    shownAt: timestamp("shown_at").defaultNow().notNull(),
    likedAt: timestamp("liked_at"),
    skippedAt: timestamp("skipped_at"),
    advancedAt: timestamp("advanced_at"),
    advanceRequestId: uuid("advance_request_id"),
  },
  (table) => [
    uniqueIndex("together_session_question_once_uidx").on(table.sessionId, table.questionId),
    uniqueIndex("together_session_question_position_uidx").on(table.sessionId, table.position),
    uniqueIndex("together_session_question_advance_request_uidx")
      .on(table.sessionId, table.advanceRequestId)
      .where(sql`${table.advanceRequestId} is not null`),
    index("together_session_question_current_idx").on(table.sessionId, table.advancedAt),
    check("together_session_question_position_positive", sql`${table.position} > 0`),
  ],
);

export const participantRelations = relations(participant, ({ many }) => ({
  memberships: many(pairMembership),
  redeemedInitialInvites: many(initialInvite),
  targetRejoinInvites: many(rejoinInvite, { relationName: "rejoinTarget" }),
  redeemedRejoinInvites: many(rejoinInvite, { relationName: "rejoinRedeemer" }),
}));

export const pairRelations = relations(pair, ({ many }) => ({
  memberships: many(pairMembership),
  initialInvites: many(initialInvite),
  rejoinInvites: many(rejoinInvite),
  privateConversations: many(privateConversation),
  togetherSessions: many(togetherSession),
  membershipEras: many(pairMembershipEra),
}));

export const pairMembershipEraRelations = relations(pairMembershipEra, ({ one, many }) => ({
  pair: one(pair, { fields: [pairMembershipEra.pairId], references: [pair.id] }),
  togetherSessions: many(togetherSession),
}));

export const togetherSessionRelations = relations(togetherSession, ({ one, many }) => ({
  pair: one(pair, { fields: [togetherSession.pairId], references: [pair.id] }),
  startedByParticipant: one(participant, {
    fields: [togetherSession.startedByParticipantId],
    references: [participant.id],
  }),
  membershipEra: one(pairMembershipEra, {
    fields: [togetherSession.membershipEraId],
    references: [pairMembershipEra.id],
  }),
  questions: many(togetherSessionQuestion),
}));

export const togetherSessionQuestionRelations = relations(togetherSessionQuestion, ({ one }) => ({
  session: one(togetherSession, {
    fields: [togetherSessionQuestion.sessionId],
    references: [togetherSession.id],
  }),
  question: one(question, {
    fields: [togetherSessionQuestion.questionId],
    references: [question.id],
  }),
}));

export const privateConversationRelations = relations(privateConversation, ({ one, many }) => ({
  pair: one(pair, { fields: [privateConversation.pairId], references: [pair.id] }),
  createdByParticipant: one(participant, {
    fields: [privateConversation.createdByParticipantId],
    references: [participant.id],
  }),
  rounds: many(privateRound),
}));

export const privateRoundRelations = relations(privateRound, ({ one }) => ({
  conversation: one(privateConversation, {
    fields: [privateRound.conversationId],
    references: [privateConversation.id],
  }),
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

export const rejoinInviteRelations = relations(rejoinInvite, ({ one }) => ({
  pair: one(pair, { fields: [rejoinInvite.pairId], references: [pair.id] }),
  targetParticipant: one(participant, {
    relationName: "rejoinTarget",
    fields: [rejoinInvite.targetParticipantId],
    references: [participant.id],
  }),
  redeemedByParticipant: one(participant, {
    relationName: "rejoinRedeemer",
    fields: [rejoinInvite.redeemedByParticipantId],
    references: [participant.id],
  }),
}));
