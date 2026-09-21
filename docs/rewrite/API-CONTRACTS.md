# Closer API contracts

This document records the current Next route surface and the proposed stable
Go JSON/SSE surface. Shapes below are intentionally projection-oriented: the
server derives actor-relative visibility and the browser never chooses an
owner.

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

## Proposed Go API conventions

Keep the current public URLs where they already express a domain resource.
Add safe read endpoints for currently server-only landing/page data:

```text
GET /api/me
GET /api/invites/:token
GET /api/rejoin/:token
GET /api/pairs
GET /api/pairs/:pairId/history
```

`GET /api/me` returns only actor/onboarding state. `GET /api/invites/:token`
returns inviter display name, relationship type, and contextual intended name;
`GET /api/rejoin/:token` returns only target slot/context needed by the page.
Neither endpoint proves authority to redeem. Redemption remains an explicit
POST.

The Go router should be organized by domain-visible resources and commands,
not a generic `/rpc` endpoint. Every command response should be sufficient for
the immediate client update but the client may refetch the authoritative
projection after an SSE event.
