# ADR 001: Stable domain participant identity

**Status:** Accepted

## Context

Closer is guest-first, but product ownership must survive optional registration. Better Auth 1.7.x anonymous linking may expose an `anonymousUser` and `newUser`, change the relevant Better Auth user ID, and delete the anonymous auth user after linking. If pair membership and private data were owned directly by `better_auth.user.id`, linking could orphan data, require broad ownership rewrites, or silently create a second product identity.

## Decision

Closer will use a stable domain `participant.id` that is distinct from the Better Auth user ID:

```text
participant.id != better_auth.user.id
```

The participant maps to the currently authoritative Better Auth user for authentication, but pair memberships, answers, reactions, replies, history, and behavioral events reference `participant.id`.

When an anonymous guest registers, the same participant remains authoritative. The eventual `participant.auth_user_id` repoint from the anonymous auth user to the new auth user must be transaction-sensitive and idempotent. Retried or duplicate linking callbacks must converge on the same participant and must not copy domain records to a new participant.

This ADR establishes the invariant only; it does not implement the Better Auth anonymous plugin or linking flow.

## Consequences

- Authentication identity and domain ownership must be resolved explicitly on the server.
- Client-supplied auth-user or participant IDs cannot establish ownership.
- The auth-user mapping needs uniqueness and conflict handling appropriate to linking retries.
- Linking integration tests must cover auth-user replacement and deletion of the anonymous auth user.
- Domain history remains stable across registration without rewriting every owned record.

## Alternatives considered

- **Use the Better Auth user as the participant:** rejected because anonymous linking may change or delete that identity.
- **Create a new participant on registration and copy ownership:** rejected because copying is failure-prone, complicates idempotency, and changes the user's domain identity.
- **Keep the anonymous Better Auth user permanently:** rejected because it conflicts with the authentication provider's linking lifecycle and leaves two auth identities for one participant.
