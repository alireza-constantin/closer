import { relations } from "drizzle-orm";
import {
  check,
  customType,
  pgTable,
  text,
  timestamp,
  boolean,
  index,
  uniqueIndex,
  integer,
  bigint,
  uuid,
  primaryKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

export const rateLimit = pgTable("rate_limit", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: bigint("last_request", { mode: "number" }).notNull(),
});

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  isAnonymous: boolean("is_anonymous").default(false).notNull(),
  image: text("image"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("session_userId_idx").on(table.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    issuer: text("issuer").notNull(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("account_issuer_accountId_uidx").on(table.issuer, table.accountId),
    index("account_userId_idx").on(table.userId),
  ],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

// Purpose-built Go authentication tables are additive during the rewrite.
// The Better Auth tables above remain in place until the separately gated
// production cutover.
export const authUser = pgTable(
  "auth_user",
  {
    id: uuid("id").primaryKey(),
    kind: text("kind").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
  },
  (table) => [
    check("auth_user_kind_check", sql`${table.kind} in ('anonymous', 'registered', 'admin')`),
  ],
);

export const authSession = pgTable(
  "auth_session",
  {
    id: uuid("id").primaryKey(),
    authUserId: uuid("auth_user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "restrict" }),
    tokenHash: bytea("token_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("auth_session_token_hash_uidx").on(table.tokenHash),
    index("auth_session_auth_user_id_expires_at_idx").on(table.authUserId, table.expiresAt),
    index("auth_session_expires_at_idx").on(table.expiresAt),
    check("auth_session_token_hash_length_check", sql`octet_length(${table.tokenHash}) = 32`),
  ],
);

export const authCredential = pgTable(
  "auth_credential",
  {
    authUserId: uuid("auth_user_id")
      .primaryKey()
      .references(() => authUser.id, { onDelete: "restrict" }),
    emailNormalized: text("email_normalized").notNull(),
    passwordHash: text("password_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    passwordUpdatedAt: timestamp("password_updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [uniqueIndex("auth_credential_email_normalized_uidx").on(table.emailNormalized)],
);

export const authRateLimit = pgTable(
  "auth_rate_limit",
  {
    scope: text("scope").notNull(),
    subject: text("subject").notNull(),
    windowStartedAt: timestamp("window_started_at", { withTimezone: true }).notNull(),
    count: integer("count").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.scope, table.subject], name: "auth_rate_limit_pkey" }),
    check("auth_rate_limit_count_check", sql`${table.count} >= 0`),
    index("auth_rate_limit_window_started_at_idx").on(table.windowStartedAt),
  ],
);

export const adminUser = pgTable("admin_user", {
  authUserId: uuid("auth_user_id")
    .primaryKey()
    .references(() => authUser.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}));
