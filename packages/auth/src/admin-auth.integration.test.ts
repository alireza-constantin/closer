import { afterEach, expect, mock, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";

import "@Closer/db/test-env";

mock.module("server-only", () => ({}));

const [{ auth, adminAuth, createAdminAuth }, { db }, schema, closerSchema, { env }, provisioning] =
  await Promise.all([
    import("./index"),
    import("@Closer/db"),
    import("@Closer/db/schema/auth"),
    import("@Closer/db/schema/closer"),
    import("@Closer/env/server"),
    import("./admin-provisioning"),
  ]);

const createdUserIds = new Set<string>();

async function createAdmin(email = `admin-${randomUUID()}@example.com`) {
  const result = await provisioning.bootstrapAdminAccount({
    email,
    password: "closer-admin-password",
  });
  createdUserIds.add(result.userId);
  return { ...result, email, password: "closer-admin-password" };
}

async function createConsumer() {
  const email = `consumer-${randomUUID()}@example.com`;
  const result = await auth.api.signUpEmail({
    body: { email, name: "Closer Consumer", password: "closer-consumer-password" },
  });
  createdUserIds.add(result.user.id);
  await db.delete(schema.session).where(eq(schema.session.userId, result.user.id));
  return { userId: result.user.id, email, password: "closer-consumer-password" };
}

async function signIn(
  email: string,
  password: string,
  ip = `198.51.100.${Math.floor(Math.random() * 200) + 1}`,
) {
  const response = await adminAuth.handler(
    new Request(`${env.BETTER_AUTH_URL}/api/admin-auth/sign-in/email`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": ip,
        origin: new URL(env.BETTER_AUTH_URL).origin,
      },
      body: JSON.stringify({ email, password }),
    }),
  );

  return response;
}

function sessionCookie(response: Response) {
  const values = response.headers.getSetCookie?.() ?? [response.headers.get("set-cookie") ?? ""];
  const cookie = values.find((value) => value.includes("session_token"));
  if (!cookie) throw new Error("Expected Better Auth to set a session cookie.");
  return cookie.split(";")[0]!;
}

afterEach(async () => {
  const userIds = [...createdUserIds];
  if (!userIds.length) return;

  await db
    .delete(closerSchema.participant)
    .where(inArray(closerSchema.participant.authUserId, userIds));
  await db.delete(schema.session).where(inArray(schema.session.userId, userIds));
  await db.delete(schema.account).where(inArray(schema.account.userId, userIds));
  await db.delete(schema.user).where(inArray(schema.user.id, userIds));
  createdUserIds.clear();
});

test("Admin bootstrap is dedicated, retry-safe, and rejects a conflicting email", async () => {
  const email = `admin-${randomUUID()}@example.com`;
  const created = await provisioning.bootstrapAdminAccount({
    email,
    password: "closer-admin-password",
  });
  createdUserIds.add(created.userId);

  expect(created.created).toBe(true);
  expect(
    await db
      .select({ id: closerSchema.participant.id })
      .from(closerSchema.participant)
      .where(eq(closerSchema.participant.authUserId, created.userId)),
  ).toEqual([]);
  expect(
    await db
      .select({ id: schema.session.id })
      .from(schema.session)
      .where(eq(schema.session.userId, created.userId)),
  ).toEqual([]);

  await expect(
    provisioning.bootstrapAdminAccount({
      email,
      password: "ignored-password-value",
      configuredAdminUserId: created.userId,
    }),
  ).resolves.toEqual({ userId: created.userId, created: false });
  await expect(
    provisioning.bootstrapAdminAccount({
      email,
      password: "ignored-password-value",
      configuredAdminUserId: "different-admin-id",
    }),
  ).rejects.toThrow("not the configured Admin");
  await expect(
    provisioning.bootstrapAdminAccount({ email, password: "ignored-password-value" }),
  ).rejects.toThrow("not the configured Admin");

  expect(
    await db.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.email, email)),
  ).toEqual([{ id: created.userId }]);
});

test("Admin recovery changes only ADMIN_USER_ID and revokes its sessions", async () => {
  const admin = await createAdmin();
  const other = await createAdmin();
  const adminLogin = await signIn(admin.email, admin.password);
  const otherLogin = await signIn(other.email, other.password);
  expect(adminLogin.status).toBe(200);
  expect(otherLogin.status).toBe(200);

  const mutableEnv = env as unknown as { ADMIN_USER_ID?: string };
  const priorAdminUserId = mutableEnv.ADMIN_USER_ID;
  mutableEnv.ADMIN_USER_ID = admin.userId;
  try {
    const result = await provisioning.recoverAdminAccountPassword("closer-new-admin-password");
    expect(result.revokedSessionCount).toBe(1);
  } finally {
    mutableEnv.ADMIN_USER_ID = priorAdminUserId;
  }

  expect(
    await db
      .select({ id: schema.session.id })
      .from(schema.session)
      .where(eq(schema.session.userId, admin.userId)),
  ).toEqual([]);
  expect(
    await db
      .select({ id: schema.session.id })
      .from(schema.session)
      .where(eq(schema.session.userId, other.userId)),
  ).toHaveLength(1);
  expect((await signIn(admin.email, admin.password)).status).not.toBe(200);
  expect((await signIn(admin.email, "closer-new-admin-password")).status).toBe(200);
  expect((await signIn(other.email, other.password)).status).toBe(200);
});

test("Admin authorization requires a session and an exact configured user ID", async () => {
  const admin = await createAdmin();
  const ordinary = await createConsumer();
  const adminLogin = await signIn(admin.email, admin.password);
  const ordinaryLogin = await signIn(ordinary.email, ordinary.password);
  const adminHeaders = new Headers({ cookie: sessionCookie(adminLogin) });
  const ordinaryHeaders = new Headers({ cookie: sessionCookie(ordinaryLogin) });

  const { requireAdmin } = await import("../../../apps/web/src/server/auth/admin");
  const mutableEnv = env as unknown as { ADMIN_USER_ID?: string };
  const priorAdminUserId = mutableEnv.ADMIN_USER_ID;
  mutableEnv.ADMIN_USER_ID = admin.userId;
  try {
    await expect(requireAdmin(new Headers())).rejects.toMatchObject({ status: 401 });
    await expect(requireAdmin(ordinaryHeaders)).rejects.toMatchObject({ status: 403 });
    await expect(requireAdmin(adminHeaders)).resolves.toMatchObject({
      user: { id: admin.userId },
    });
  } finally {
    mutableEnv.ADMIN_USER_ID = priorAdminUserId;
  }
  await expect(requireAdmin(adminHeaders)).rejects.toMatchObject({ status: 503 });
});

test("Admin sign-out revokes its Better Auth session", async () => {
  const admin = await createAdmin();
  const login = await signIn(admin.email, admin.password);
  const cookie = sessionCookie(login);
  const logout = await adminAuth.handler(
    new Request(`${env.BETTER_AUTH_URL}/api/admin-auth/sign-out`, {
      method: "POST",
      headers: {
        cookie,
        origin: new URL(env.BETTER_AUTH_URL).origin,
        "x-forwarded-for": `198.51.100.${Math.floor(Math.random() * 200) + 1}`,
      },
    }),
  );

  expect(logout.status).toBe(200);
  const { requireAdmin } = await import("../../../apps/web/src/server/auth/admin");
  const mutableEnv = env as unknown as { ADMIN_USER_ID?: string };
  const priorAdminUserId = mutableEnv.ADMIN_USER_ID;
  mutableEnv.ADMIN_USER_ID = admin.userId;
  try {
    await expect(requireAdmin(new Headers({ cookie }))).rejects.toMatchObject({ status: 401 });
  } finally {
    mutableEnv.ADMIN_USER_ID = priorAdminUserId;
  }
});

test("Admin auth path cannot create users or anonymous consumer sessions", async () => {
  const signUp = await adminAuth.handler(
    new Request(`${env.BETTER_AUTH_URL}/api/admin-auth/sign-up/email`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: new URL(env.BETTER_AUTH_URL).origin,
      },
      body: JSON.stringify({
        email: `blocked-${randomUUID()}@example.com`,
        name: "Not an Admin",
        password: "blocked-password",
      }),
    }),
  );
  const anonymousSession = await adminAuth.handler(
    new Request(`${env.BETTER_AUTH_URL}/api/admin-auth/sign-in/anonymous`, {
      method: "POST",
      headers: { origin: new URL(env.BETTER_AUTH_URL).origin },
    }),
  );

  expect(signUp.status).toBe(400);
  expect(anonymousSession.status).toBe(404);
});

test("Admin sign-in applies a durable five-request per-minute IP limit", async () => {
  const ip = `198.51.100.${Math.floor(Math.random() * 200) + 1}`;
  const request = (authInstance = adminAuth) =>
    authInstance.handler(
      new Request(`${env.BETTER_AUTH_URL}/api/admin-auth/sign-in/email`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": ip,
          origin: new URL(env.BETTER_AUTH_URL).origin,
        },
        body: JSON.stringify({
          email: `missing-${randomUUID()}@example.com`,
          password: "missing-account-password",
        }),
      }),
    );

  const firstFive = await Promise.all(Array.from({ length: 5 }, request));
  expect(firstFive.every((response) => response.status !== 429)).toBe(true);
  const restartedAuth = createAdminAuth();
  expect((await request(restartedAuth)).status).toBe(429);

  const otherIp = await adminAuth.handler(
    new Request(`${env.BETTER_AUTH_URL}/api/admin-auth/sign-in/email`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "192.0.2.8",
        origin: new URL(env.BETTER_AUTH_URL).origin,
      },
      body: JSON.stringify({
        email: `missing-${randomUUID()}@example.com`,
        password: "missing-account-password",
      }),
    }),
  );
  expect(otherIp.status).not.toBe(429);
});

test("Admin mutation requests require the trusted same origin", async () => {
  const { hasTrustedAdminMutationOrigin } =
    await import("../../../apps/web/src/server/http/admin-origin");

  expect(
    hasTrustedAdminMutationOrigin(
      new Request("https://closer.example/admin"),
      "https://closer.example",
    ),
  ).toBe(true);
  expect(
    hasTrustedAdminMutationOrigin(
      new Request("https://closer.example/api/admin/questions", {
        method: "POST",
        headers: { origin: "https://closer.example" },
      }),
      "https://closer.example",
    ),
  ).toBe(true);
  expect(
    hasTrustedAdminMutationOrigin(
      new Request("https://closer.example/api/admin/questions", {
        method: "POST",
        headers: { origin: "https://attacker.example" },
      }),
      "https://closer.example",
    ),
  ).toBe(false);
  expect(
    hasTrustedAdminMutationOrigin(
      new Request("https://closer.example/api/admin/questions", { method: "POST" }),
      "https://closer.example",
    ),
  ).toBe(false);
  expect(
    hasTrustedAdminMutationOrigin(
      new Request("https://closer.example/api/admin/questions", {
        method: "POST",
        headers: { origin: "https://closer.example", "sec-fetch-site": "cross-site" },
      }),
      "https://closer.example",
    ),
  ).toBe(false);
});
