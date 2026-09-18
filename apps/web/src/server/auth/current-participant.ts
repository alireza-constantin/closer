import "server-only";

import { auth } from "@Closer/auth";
import { db, getParticipantByAuthUserId } from "@Closer/auth/closer";
import { headers } from "next/headers";
import { cache } from "react";

const resolveAuthUserIdFromRequest = cache(async (requestHeaders: Headers) => {
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session?.user) return null;
  return session.user.id;
});

export function getAuthUserIdFromRequest(requestHeaders: Headers) {
  return resolveAuthUserIdFromRequest(requestHeaders);
}

const resolveCurrentAuthUserId = cache(async () => {
  return getAuthUserIdFromRequest(await headers());
});

export function getCurrentAuthUserId() {
  return resolveCurrentAuthUserId();
}

const resolveCurrentParticipant = cache(async () => {
  const authUserId = await getCurrentAuthUserId();
  if (!authUserId) return null;
  return getParticipantByAuthUserId(db, authUserId);
});

export function getCurrentParticipant() {
  return resolveCurrentParticipant();
}
