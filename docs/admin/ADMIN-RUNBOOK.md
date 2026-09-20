# Closer Admin access runbook

Admin uses a dedicated Better Auth email/password account. It does not require
or create a Closer Participant.

## Initial bootstrap

1. Add `ADMIN_BOOTSTRAP_EMAIL` and `ADMIN_BOOTSTRAP_PASSWORD` as protected
   environment values for the database-backed local or deployment environment.
   Use a unique password that satisfies Better Auth's 8–128 character limit.
2. Run `bun run admin:bootstrap` from the repository root.
3. Copy the printed Admin user ID into `ADMIN_USER_ID` in the same environment.
4. Remove `ADMIN_BOOTSTRAP_PASSWORD` and `ADMIN_BOOTSTRAP_EMAIL` from the
   environment after the initial provisioning.
5. Deploy/restart the web application, then open `/admin/login` directly.

The command is manual and is never part of build or deployment. If the email
already exists, it is a no-op only when that user's ID equals `ADMIN_USER_ID`;
all other existing-email cases fail without changing the account. The command
prints the resulting user ID but never prints a password.

## Password recovery

Set the temporary `ADMIN_RECOVERY_PASSWORD` in a protected environment, run
`bun run admin:recover` from the repository root, then remove the variable. The
command reads its target only from `ADMIN_USER_ID`, updates that account using
Better Auth's password hasher, and revokes its existing sessions. It accepts no
user ID argument.

## Runtime configuration

- `ADMIN_USER_ID` — required to authorize an Admin; unset means no account is
  authorized.
- `ADMIN_BOOTSTRAP_EMAIL` and `ADMIN_BOOTSTRAP_PASSWORD` — temporary bootstrap
  inputs; remove after provisioning.
- `ADMIN_RECOVERY_PASSWORD` — temporary recovery input; remove after recovery.

Admin email/password requests use `/api/admin-auth/*` and a database-backed
limit of five requests per minute per IP. Better Auth origin and CSRF checks
remain enabled. `ADMIN_USER_ID` is the sole authorization source.
