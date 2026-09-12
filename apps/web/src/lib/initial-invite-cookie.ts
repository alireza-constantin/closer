const INITIAL_INVITE_COOKIE_PREFIX = "closer-initial-invite-";

export function initialInviteCookieName(pairId: string) {
  return `${INITIAL_INVITE_COOKIE_PREFIX}${pairId}`;
}

export function getInitialInviteCookie(request: Request, pairId: string) {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const name = initialInviteCookieName(pairId);
  const pairCookie = cookieHeader
    .split(";")
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(`${name}=`));

  return pairCookie ? decodeURIComponent(pairCookie.slice(name.length + 1)) : null;
}

export function setInitialInviteCookie(headers: Headers, pairId: string, token: string, expiresAt: Date) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  headers.append(
    "set-cookie",
    `${initialInviteCookieName(pairId)}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Expires=${expiresAt.toUTCString()}${secure}`,
  );
}

export function clearInitialInviteCookie(headers: Headers, pairId: string) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  headers.append(
    "set-cookie",
    `${initialInviteCookieName(pairId)}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`,
  );
}
