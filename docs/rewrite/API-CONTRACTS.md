# Closer API contracts

This document records the current Next route surface and the frozen stable Go
JSON/SSE surface. Current-route tables are evidence only. The REWRITE-01 rules
below supersede any older use of unversioned `/api` or Better Auth endpoints.
Shapes are intentionally projection-oriented: the server derives
actor-relative visibility and the browser never chooses an owner.

## Contract rules

- Cookie-authenticated requests resolve `auth user -> Participant` on the
  server. Admin requests resolve a dedicated Admin identity and never create or
  require a Participant.
- Mutations use `Cache-Control: private, no-store` where the current adapter
  does. Reads of protected state are also no-store.
- Participant-relative unauthorized Pair/Private/Together/history resources
  collapse to `404 {"error":"Not found."}`. Missing authentication is 401.
- `clientRequestId` is a UUID whenever accepted. A retry returns the original
  result, not a new occurrence.
- JSON commands publish a metadata-only Pair event after commit. Publication
  failure does not undo the committed transaction.

## Current HTTP surface

### Auth

| Method/path                         | Auth                       | Request/response                              | Behavior                                                                |
| ----------------------------------- | -------------------------- | --------------------------------------------- | ----------------------------------------------------------------------- |
| `GET,POST /api/auth/[...all]`       | Better Auth session/cookie | Better Auth email/password/anonymous protocol | Consumer sign-in, sign-up, anonymous session, session queries, sign-out |
| `GET,POST /api/admin-auth/[...all]` | Better Auth session/cookie | Same protocol under `/api/admin-auth`         | Dedicated Admin sign-in/out; sign-up disabled; 5/IP/minute rule         |

### Participant, Pair, invite, rejoin, termination

| Method/path                         | Auth                                                                                 | Request                                                  | Success projection / event                                                                       |
| ----------------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `POST /api/onboarding`              | consumer session; no Participant required                                            | `{displayName}`                                          | `{participantId,displayName}`; idempotent mapping                                                |
| `POST /api/pairs`                   | authenticated Participant                                                            | `{intendedPersonName,relationshipType,clientRequestId?}` | `{pairId,intendedPersonName}`; creation request idempotent                                       |
| `PATCH /api/pairs/:pairId`          | active member                                                                        | `{intendedPersonName}`                                   | `{pairId,intendedPersonName}`; only while slot 2 unclaimed                                       |
| `GET /api/pairs/:pairId`            | active or former member through page projection; current API uses page/server module | Pair projection with members/status                      | participant-relative Pair view                                                                   |
| `GET /api/pairs/:pairId/status`     | active member                                                                        | none                                                     | minimal participant-relative status; no unrelated Pair disclosure                                |
| `POST /api/invites/:token/redeem`   | signed-in user; may onboard inline with `displayName`                                | `{displayName}` only if no Participant                   | `{pairId,membershipEraId}`; `pair.changed`                                                       |
| `GET /api/pairs/:pairId/invite`     | sole active slot-1 member                                                            | none                                                     | `none`, `active+expiresAt`, or `local+token+expiresAt`; raw token only to issuing browser cookie |
| `POST /api/pairs/:pairId/invite`    | sole active slot-1 member                                                            | none                                                     | reuse metadata or issue raw token; explicit command                                              |
| `PUT /api/pairs/:pairId/invite`     | sole active slot-1 member                                                            | none                                                     | revoke old and issue new raw token; explicit replacement                                         |
| `POST /api/pairs/:pairId/rejoin`    | other active member                                                                  | none                                                     | raw token, expiry, target display name                                                           |
| `DELETE /api/pairs/:pairId/rejoin`  | other active member                                                                  | none                                                     | 204; revoke usable target invites                                                                |
| `POST /api/rejoin/:token/redeem`    | signed-in user with no existing Participant                                          | `{displayName}`                                          | `{pairId,membershipEraId,participantId}`; `pair.changed`                                         |
| `POST /api/pairs/:pairId/terminate` | active member                                                                        | none                                                     | `{pairId,state:"terminated",terminatedAt}`; `pair.terminated`                                    |

The current public invite/rejoin landing projections are Server Component calls
to `getInitialInviteLanding` and `getRejoinInviteLanding` from
`apps/web/src/server/modules/invites/invite.service.ts`; they are not current
JSON routes. The Vite client therefore needs explicit read endpoints (below).

### Together

| Method/path                                                                   | Auth                                                          | Request                        | Success projection / event                                                           |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------ |
| `POST /api/pairs/:pairId/together/sessions`                                   | active Pair member; one member is enough, including pre-claim | `{category,clientRequestId?}`  | 201 `{sessionId,questionId,questionRevisionId}`; `together.changed`                  |
| `GET /api/pairs/:pairId/together/sessions/:sessionId`                         | authorized member/era                                         | none                           | current playback/session projection with exact revision, current card, `exhausted`   |
| `GET /api/pairs/:pairId/together/sessions/:sessionId/questions?band=&cursor=` | active session/era                                            | query band and optional cursor | 20-item deterministic page `{items,nextCursor,hasMore}`                              |
| `POST /api/pairs/:pairId/together/sessions/:sessionId/advance`                | authorized member                                             | `{action:"next"                | "skip",clientRequestId?,currentQuestionId?,nextQuestionId?,nextQuestionRevisionId?}` | next Question or exhausted; request idempotent |
| `PUT /api/pairs/:pairId/together/sessions/:sessionId/like`                    | authorized member                                             | `{liked,currentQuestionId?}`   | current session projection; no attribution; `together.changed` is client-reconciled  |
| `POST /api/pairs/:pairId/together/sessions/:sessionId/end`                    | authorized member                                             | none                           | ended session; `together.changed`; repeat end safe                                   |

Errors: malformed input and unavailable Question/action are 400;
`TOGETHER_SESSION_ENDED` and `TOGETHER_SESSION_EXHAUSTED` are 409; resource
authorization is 404.

### Private

| Method/path                                                                                    | Auth                                           | Request                       | Success projection / event                                                                                                       |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/pairs/:pairId/questions?category=`                                                   | complete Pair                                  | category                      | compatible current Question list; read-only                                                                                      |
| `GET /api/pairs/:pairId/private-conversations`                                                 | complete Pair                                  | none                          | active era summaries, participant-relative                                                                                       |
| `POST /api/pairs/:pairId/private-conversations`                                                | complete Pair                                  | `{category,clientRequestId?}` | 201 conversation projection; creator candidate only; `private.changed`                                                           |
| `GET /api/pairs/:pairId/private-conversations/:conversationId`                                 | complete current-era member                    | none                          | `CURRENT_ROUND`, `CANDIDATE`, `WAITING_FOR_CREATOR`, `READY_FOR_NEXT`, or `EXHAUSTED`; non-creator candidate is never serialized |
| `POST /api/pairs/:pairId/private-conversations/:conversationId/candidates/:candidateId/select` | creator only                                   | `{clientRequestId?}`          | `{conversationId,roundId}`; `private.changed`                                                                                    |
| `POST /api/pairs/:pairId/private-conversations/:conversationId/candidates/:candidateId/skip`   | creator only                                   | `{clientRequestId}`           | next candidate projection or exhausted; same request replays same result                                                         |
| `PUT /api/pairs/:pairId/private-conversations/:conversationId/candidates/:candidateId/like`    | creator only                                   | `{liked}`                     | `{liked}`; unresolved only; final state freezes on Ask/Skip                                                                      |
| `GET /api/pairs/:pairId/private-rounds`                                                        | complete Pair                                  | none                          | legacy alias of active conversation list; prefer removing ambiguity in Go                                                        |
| `GET /api/pairs/:pairId/private-rounds/:roundId`                                               | current-era member or authorized former member | none                          | round projection; before Reveal, hide `answers`, `reactions`, and `replies`                                                      |
| `GET /api/pairs/:pairId/private-rounds/:roundId/status`                                        | same                                           | none                          | minimal viewer-relative state                                                                                                    |
| `POST /api/pairs/:pairId/private-rounds/:roundId/answer`                                       | current-era member                             | `{body}`                      | updated round projection; answer immutable; `private.changed`                                                                    |
| `POST /api/pairs/:pairId/private-rounds/:roundId/retire`                                       | current-era member                             | none                          | retired round projection; eligible only before viewer answer / two answers; `private.changed`                                    |
| `POST /api/pairs/:pairId/private-rounds/:roundId/reveal`                                       | current-era member with two answers present    | none                          | updated viewer projection; `private.changed`                                                                                     |
| `PUT /api/pairs/:pairId/private-rounds/:roundId/reaction`                                      | viewer after own Reveal                        | `{value}`                     | updated projection; upsert; `private.changed`                                                                                    |
| `DELETE /api/pairs/:pairId/private-rounds/:roundId/reaction`                                   | viewer after own Reveal                        | none                          | updated projection; `private.changed`                                                                                            |
| `PUT /api/pairs/:pairId/private-rounds/:roundId/reply`                                         | viewer after own Reveal                        | `{body}`                      | updated projection; editable; `private.changed`                                                                                  |
| `DELETE /api/pairs/:pairId/private-rounds/:roundId/reply`                                      | viewer after own Reveal                        | none                          | updated projection; `private.changed`                                                                                            |

Private errors currently expose `QUESTION_UNAVAILABLE`, `ANSWER_INVALID`,
`REPLY_INVALID`, `REACTION_INVALID` as 400 and `ANSWER_IMMUTABLE` as 409;
other authorization/state failures collapse to 404. Preserve candidate and
answer projection rules even if the Go API chooses more granular internal codes.

### Realtime

| Method/path                     | Auth                                       | Wire format                                                                                                   |
| ------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `GET /api/pairs/:pairId/events` | authenticated Participant with Pair access | `text/event-stream`; `event: <type>`, `data: {version:1,pairId,type}`; `: connected`; `: heartbeat` every 20s |

Allowed event types are exactly `pair.changed`, `private.changed`,
`together.changed`, and `pair.terminated`. The stream is Pair-scoped and closes
on abort. The client reconciles on open, invalidates the appropriate React
Query key, closes on termination, and relies on EventSource reconnect otherwise.

### Admin

All `/api/admin/*` endpoints independently require a Better Auth session whose
user ID equals `ADMIN_USER_ID`, validate trusted mutation origin, parse Zod, and
return no-store responses. Admin does not resolve a Participant.

| Method/path                                                    | Request/query                                                                                   | Success                                                                                    |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `GET /api/admin/questions`                                     | page, pageSize, search, category, intensity, relationshipFit, modeFit, activity, revisionHealth | paginated current Question list with revision metadata and `Pre-Admin catalog` actor label |
| `POST /api/admin/questions`                                    | revision fields: text, category, relationshipFit, modeFit, intensity                            | 201 Question + revision 1; starts inactive                                                 |
| `GET /api/admin/questions/duplicates?text=&excludeQuestionId=` | normalized wording                                                                              | matches; warning only                                                                      |
| `GET /api/admin/questions/:id`                                 | none                                                                                            | detail, current revision, recent 20 editorial events                                       |
| `GET /api/admin/questions/:id/revisions`                       | page/pageSize                                                                                   | revision history, actor, current/withdrawn markers                                         |
| `POST /api/admin/questions/:id/revisions`                      | revision fields + `expectedCurrentRevisionId`                                                   | 201 later revision; activity preserved                                                     |
| `POST /api/admin/questions/:id/revisions/:revisionId/restore`  | `expectedCurrentRevisionId`                                                                     | 201 restore-as-new-revision                                                                |
| `POST /api/admin/questions/:id/revisions/:revisionId/withdraw` | `{reason}`                                                                                      | withdrawal timestamp; idempotent first facts preserved                                     |
| `POST /api/admin/questions/:id/lifecycle/activate`             | optional `{reason}`                                                                             | `{questionId,isActive}`                                                                    |
| `POST /api/admin/questions/:id/lifecycle/reactivate`           | optional `{reason}`                                                                             | same                                                                                       |
| `POST /api/admin/questions/:id/lifecycle/deactivate`           | optional `{reason}`                                                                             | same                                                                                       |

Admin revision conflicts map to 409; withdrawal reason is 400; unavailable
Question is 404. Analytics and inventory are currently Server Component
service projections rather than route handlers. The Go API should add:

```text
GET /api/admin/overview
GET /api/admin/questions/coverage
GET /api/admin/questions/analytics?mode=private|together&revisionScope=current|all
GET /api/admin/questions/:id/analytics?revisionScope=current|revision|all&revisionId=...
```

These endpoints must retain current-revision default, historical labelling, and
five-distinct-Pair suppression.

## REWRITE-01 frozen Go API conventions

Every Go endpoint begins `/api/v1`. The Go router is organized by
domain-visible resources and commands, not `/rpc`. JSON is UTF-8,
`application/json`; all protected reads and every response that can contain
participant-relative state use `Cache-Control: private, no-store`. An error is
always `{"error":{"code","message","requestId"}}`; clients branch on
`code`, not on `message`.

The final auth surface is deliberately small:

```text
GET  /api/v1/me                         safe actor/onboarding/Admin-neutral state
POST /api/v1/auth/anonymous             explicit anonymous user + session creation
POST /api/v1/auth/register              direct registered auth user + session, no Participant
POST /api/v1/auth/upgrade               attach credential to current anonymous auth user
POST /api/v1/auth/login                 generic invalid-credential failure
POST /api/v1/auth/logout                revoke current session
POST /api/v1/auth/logout-all            revoke all sessions for current auth user
POST /api/v1/admin/login                Admin credential login with durable limit
POST /api/v1/admin/logout               revoke current Admin session
```

There is no anonymous creation on `GET /me`, no Better Auth catch-all route,
no client-chosen actor ID, no JWT endpoint, and no consumer password-reset
endpoint in V1. All cookie mutations require an allow-listed Origin.

Canonical public/participant reads are:

```text
GET /api/v1/invites/:token
GET /api/v1/rejoin/:token
GET /api/v1/pairs
GET /api/v1/pairs/:pairId
GET /api/v1/pairs/:pairId/history
GET /api/v1/pairs/:pairId/events
```

`GET /api/v1/me` returns only actor/onboarding state. `GET /api/v1/invites/:token`
returns inviter display name, relationship type, and contextual intended name;
`GET /api/v1/rejoin/:token` returns only target slot/context needed by the page.
Neither endpoint proves authority to redeem. Redemption remains an explicit
POST.

Resource routes in the existing tables retain their resource/command shape with
the `/api/v1` prefix. The canonical Private collection is
`/pairs/:pairId/private-conversations`; no new `/private-rounds` collection
alias is created. A command response is enough for the immediate client update,
but the client may refetch the authoritative projection after SSE.

### Projection and contract synchronization rules

- A `WAITING_FOR_CREATOR` Private projection may contain only the safe state,
  the already-selected category lane, and a version/refresh marker. It contains
  no candidate ID, Question ID, revision ID, text, intensity, Like state,
  timestamp, rank, seed, or selection metadata.
- Before the current viewer persists Reveal, a private Round projection omits
  the other answer and all reactions/replies. Omitting a field is mandatory;
  sending it as a hidden value is a leak.
- SSE is `text/event-stream` at `/api/v1/pairs/:pairId/events`, with only
  `{version:1,pairId,type}` and the four fixed event names. It has no replay
  cursor and no content payload; reconnect/focus refetch makes delivery loss
  harmless.
- `apps/api/openapi.yaml` is the source contract. Go handler/DTO tests validate
  it; TypeScript transport types/client are generated from it; CI fails when
  generated output differs. React Hook Form/Zod stays at the client boundary
  for forms and response hardening, but it does not become a second server
  domain implementation.
