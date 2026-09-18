import "server-only";

import { db, getInitialInviteLanding, getRejoinInviteLanding } from "@Closer/auth/closer";

export function getInitialInvite(token: string) {
  return getInitialInviteLanding(db, token);
}

export function getRejoinInvite(token: string) {
  return getRejoinInviteLanding(db, token);
}
