// Development-only production-build benchmark. It resets only the database
// named by CLOSER_PERF_DATABASE_URL and creates a temporary local fixture.
import { createHash, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { gzipSync } from "node:zlib";

import { auth } from "../../packages/auth/src/index.ts";
import {
  CloserDomainError,
  getFormerEraHistoryForParticipant,
  getInitialInviteLanding,
  getInitialInviteStatus,
  getPairForParticipant,
  getPairStatusForParticipant,
  getParticipantByAuthUserId,
  getPrivateConversationForParticipant,
  getPrivateRoundForParticipant,
  getRejoinInviteLanding,
  getTogetherSessionForParticipant,
  getTogetherSessionPlaybackForParticipant,
  getTogetherQuestionPageForParticipant,
  listActivePairsForParticipant,
  listActivePrivateConversations,
  markPrivateRevealViewed,
  resolveOrCreateParticipant,
  askPrivateQuestionCandidate,
  advanceTogetherSession,
  submitPrivateAnswer,
} from "../../packages/db/src/closer.ts";
import { createDb } from "../../packages/db/src/index.ts";
import {
  pair,
  pairMembership,
  pairMembershipEra,
  participant,
  privateAnswer,
  privateConversation,
  privateQuestionCandidate,
  privateReaction,
  privateReply,
  privateRevealView,
  privateRound,
  question,
  questionRevision,
  rejoinInvite,
  togetherSession,
  togetherSessionQuestion,
  user,
  initialInvite,
} from "../../packages/db/src/schema/index.ts";
import { sql } from "../../packages/db/node_modules/drizzle-orm/index.js";

const database = createDb();
const baseUrl = process.env.CLOSER_PERF_BASE_URL ?? "http://localhost:3100";
const repeats = Number(process.env.CLOSER_PERF_REPEATS ?? "5");

type Fixture = {
  authUserId: string;
  cookie: string;
  participantId: string;
  otherParticipantId: string;
  pairId: string;
  invitePairId: string;
  historyRoundId: string;
  answerRoundId: string;
  revealRoundId: string;
  privateConversationId: string;
  candidateId: string;
  togetherSessionId: string;
  togetherQuestionId: string;
  initialInviteToken: string;
  rejoinInviteToken: string;
};

function median(values: number[]) {
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.floor(ordered.length / 2)] ?? 0;
}

function serializedPayloadSize(value: unknown) {
  const body = Buffer.from(JSON.stringify(value));
  return { jsonBytes: body.byteLength, gzipBytes: gzipSync(body).byteLength };
}

async function measure(
  name: string,
  operation: () => Promise<unknown>,
  count = repeats,
) {
  const durations: number[] = [];
  const queryCounts: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const client = database.$client as unknown as {
      query: (...arguments_: unknown[]) => Promise<unknown>;
    };
    const originalQuery = client.query.bind(database.$client);
    let queryCount = 0;
    client.query = (...arguments_) => {
      queryCount += 1;
      return originalQuery(...arguments_);
    };
    try {
      const started = performance.now();
      await operation();
      durations.push(performance.now() - started);
      queryCounts.push(queryCount);
    } finally {
      client.query = originalQuery;
    }
  }
  return {
    name,
    repeats: count,
    medianMs: Number(median(durations).toFixed(2)),
    minMs: Number(Math.min(...durations).toFixed(2)),
    maxMs: Number(Math.max(...durations).toFixed(2)),
    queryCount: median(queryCounts),
  };
}

async function measureHttp(name: string, path: string, count = repeats) {
  const fixture = currentFixture;
  if (!fixture) throw new Error("fixture is not initialized");
  return measure(name, async () => {
    const response = await fetch(`${baseUrl}${path}`, {
      headers: { cookie: fixture.cookie },
      redirect: "manual",
    });
    await response.text();
    if (response.status >= 500) throw new Error(`${name} returned ${response.status}`);
  }, count);
}

let currentFixture: Fixture | null = null;

function userRow(id: string, suffix: string) {
  const now = new Date();
  return {
    id,
    name: `Perf ${suffix}`,
    email: `${id}@example.test`,
    emailVerified: false,
    isAnonymous: false,
    createdAt: now,
    updatedAt: now,
  };
}

async function signUpForBenchmark() {
  const email = `perf-${randomUUID()}@example.test`;
  const response = await fetch(`${baseUrl}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Perf User", email, password: "PerfPass123!" }),
  });
  const body = await response.json() as { user?: { id: string }; token?: string };
  if (!response.ok || !body.user?.id) throw new Error(`benchmark signup failed: ${response.status}`);
  const setCookie = response.headers.get("set-cookie") ?? "";
  const cookie = setCookie.match(/(?:^|,\s*)(better-auth\.session_token=[^;]+)/)?.[1];
  if (!cookie) throw new Error("benchmark signup did not return a session cookie");
  return { authUserId: body.user.id, cookie };
}

async function seedFixture(): Promise<Fixture> {
  await database.execute(sql`
    truncate table
      "private_reply", "private_reaction", "private_reveal_view", "private_answer",
      "private_round", "private_question_candidate", "private_conversation",
      "together_session_question", "together_session", "rejoin_invite", "initial_invite",
      "pair_membership_era", "pair_membership", "pair", "participant", "account", "session", "verification", "user"
      restart identity cascade
  `);

  const signedUp = await signUpForBenchmark();
  const primary = await resolveOrCreateParticipant(database, {
    authUserId: signedUp.authUserId,
    displayName: "Primary User",
  });

  const otherAuthUserId = `perf-other-${randomUUID()}`;
  const otherParticipantId = randomUUID();
  const otherUser = userRow(otherAuthUserId, "Other");
  await database.insert(user).values(otherUser);
  await database.insert(participant).values({ id: otherParticipantId, authUserId: otherAuthUserId, displayName: "Other User" });

  const oldParticipants = Array.from({ length: 8 }, (_, index) => ({
    id: randomUUID(),
    authUserId: `perf-old-${index}-${randomUUID()}`,
    displayName: `Former ${index}`,
  }));
  await database.insert(user).values(oldParticipants.map((item, index) => userRow(item.authUserId, `Former ${index}`)));
  await database.insert(participant).values(oldParticipants);

  const pairId = randomUUID();
  await database.insert(pair).values({ id: pairId, relationshipType: "partner", intendedPersonName: null });

  const historicalMemberships = oldParticipants.flatMap((oldParticipant, index) => {
    const endedAt = new Date(Date.now() - (index + 2) * 86400000);
    return [
      { id: randomUUID(), pairId, participantId: primary.id, slot: "first" as const, startedAt: new Date(endedAt.getTime() - 86400000), endedAt, endedDisplayName: "Primary User" },
      { id: randomUUID(), pairId, participantId: oldParticipant.id, slot: "second" as const, startedAt: new Date(endedAt.getTime() - 86400000), endedAt, endedDisplayName: oldParticipant.displayName },
    ];
  });
  await database.insert(pairMembership).values(historicalMemberships);

  const currentFirstMembershipId = randomUUID();
  const currentSecondMembershipId = randomUUID();
  await database.insert(pairMembership).values([
    { id: currentFirstMembershipId, pairId, participantId: primary.id, slot: "first" as const },
    { id: currentSecondMembershipId, pairId, participantId: otherParticipantId, slot: "second" as const },
  ]);

  const historicalEras = Array.from({ length: 8 }, (_, index) => ({
    id: randomUUID(),
    pairId,
    firstMembershipId: historicalMemberships[index * 2]!.id,
    secondMembershipId: historicalMemberships[index * 2 + 1]!.id,
    startedAt: historicalMemberships[index * 2]!.startedAt,
    endedAt: historicalMemberships[index * 2]!.endedAt,
  }));
  const currentEraId = randomUUID();
  await database.insert(pairMembershipEra).values([
    ...historicalEras,
    { id: currentEraId, pairId, firstMembershipId: currentFirstMembershipId, secondMembershipId: currentSecondMembershipId },
  ]);

  const invitePairId = randomUUID();
  await database.insert(pair).values({ id: invitePairId, relationshipType: "partner", intendedPersonName: "Invite Guest" });
  await database.insert(pairMembership).values({ id: randomUUID(), pairId: invitePairId, participantId: primary.id, slot: "first" });

  const questionRows = Array.from({ length: 240 }, () => ({ id: randomUUID(), isActive: true }));
  await database.insert(question).values(questionRows);
  const revisionRows = questionRows.map((item, index) => ({
    id: randomUUID(),
    questionId: item.id,
    text: `Performance fixture question ${index}`,
    category: (["fun", "deep", "memories", "relationship"] as const)[index % 4],
    relationshipFit: (index % 4 === 3 ? "partner" : "both") as "partner" | "both",
    modeFit: "both" as const,
    intensity: (["light", "medium", "deep"] as const)[index % 3],
  }));
  await database.insert(questionRevision).values(revisionRows);
  await database.execute(sql`
    update question q
    set current_revision_id = r.id
    from question_revision r
    where r.question_id = q.id
  `);

  const initialInviteToken = `initial-${randomUUID()}`;
  const rejoinInviteToken = `rejoin-${randomUUID()}`;
  const hash = (value: string) => createHash("sha256").update(value).digest("base64url");
  await database.insert(initialInvite).values({
    pairId: invitePairId,
    tokenHash: hash(initialInviteToken),
    expiresAt: new Date(Date.now() + 86400000),
  });
  await database.insert(rejoinInvite).values({
    pairId,
    targetSlot: "second",
    targetParticipantId: otherParticipantId,
    tokenHash: hash(rejoinInviteToken),
    expiresAt: new Date(Date.now() + 86400000),
  });

  const revisionFor = (index: number) => revisionRows[index % revisionRows.length]!;
  const historicalConversations: Array<{ id: string; eraId: string; category: "fun" | "deep" | "memories" }> = [];
  const historicalRoundRows: Array<Record<string, unknown>> = [];
  const historicalAnswerRows: Array<Record<string, unknown>> = [];
  const historicalRevealRows: Array<Record<string, unknown>> = [];
  const historicalReactionRows: Array<Record<string, unknown>> = [];
  const historicalReplyRows: Array<Record<string, unknown>> = [];
  for (let eraIndex = 0; eraIndex < historicalEras.length; eraIndex += 1) {
    for (let conversationIndex = 0; conversationIndex < 3; conversationIndex += 1) {
      const conversationId = randomUUID();
      const category = (["fun", "deep", "memories"] as const)[conversationIndex]!;
      historicalConversations.push({ id: conversationId, eraId: historicalEras[eraIndex]!.id, category });
      for (let roundIndex = 1; roundIndex <= 18; roundIndex += 1) {
        const roundId = randomUUID();
        const revision = revisionFor(eraIndex * 30 + conversationIndex * 18 + roundIndex);
        const declined = roundIndex % 9 === 0;
        historicalRoundRows.push({
          id: roundId,
          pairId,
          conversationId,
          questionId: revision.questionId,
          questionRevisionId: revision.id,
          questionNumber: roundIndex,
          initiatorParticipantId: primary.id,
          status: declined ? "declined" : "open",
          declinedByParticipantId: declined ? primary.id : null,
          declinedAt: declined ? new Date() : null,
        });
        historicalAnswerRows.push({ roundId, participantId: primary.id, body: `Historical answer ${eraIndex}-${conversationIndex}-${roundIndex}-one` });
        if (!declined) historicalAnswerRows.push({ roundId, participantId: oldParticipants[eraIndex]!.id, body: `Historical answer ${eraIndex}-${conversationIndex}-${roundIndex}-two` });
        if (!declined) {
          historicalRevealRows.push({ roundId, participantId: primary.id });
          historicalRevealRows.push({ roundId, participantId: oldParticipants[eraIndex]!.id });
          historicalReactionRows.push({ roundId, participantId: primary.id, value: "heart" as const });
          historicalReactionRows.push({ roundId, participantId: oldParticipants[eraIndex]!.id, value: "tender" as const });
          historicalReplyRows.push({ roundId, participantId: primary.id, body: "Historical reply one" });
          historicalReplyRows.push({ roundId, participantId: oldParticipants[eraIndex]!.id, body: "Historical reply two" });
        }
      }
    }
  }
  await database.insert(privateConversation).values(historicalConversations.map((item) => ({ id: item.id, pairId, category: item.category, createdByParticipantId: primary.id, membershipEraId: item.eraId })));
  await database.insert(privateRound).values(historicalRoundRows as never);
  await database.insert(privateAnswer).values(historicalAnswerRows as never);
  await database.insert(privateRevealView).values(historicalRevealRows as never);
  await database.insert(privateReaction).values(historicalReactionRows as never);
  await database.insert(privateReply).values(historicalReplyRows as never);

  const historicalSessions: Array<{ id: string; eraId: string }> = [];
  const historicalCardRows: Array<Record<string, unknown>> = [];
  for (let eraIndex = 0; eraIndex < historicalEras.length; eraIndex += 1) {
    for (let sessionIndex = 0; sessionIndex < 3; sessionIndex += 1) {
      const sessionId = randomUUID();
      historicalSessions.push({ id: sessionId, eraId: historicalEras[eraIndex]!.id });
      for (let position = 1; position <= 18; position += 1) {
        const revision = revisionFor(120 + eraIndex * 30 + sessionIndex * 18 + position);
        historicalCardRows.push({
          sessionId,
          questionId: revision.questionId,
          questionRevisionId: revision.id,
          position,
          skippedAt: position % 7 === 0 ? new Date() : null,
          advancedAt: position < 18 ? new Date() : null,
        });
      }
    }
  }
  await database.insert(togetherSession).values(historicalSessions.map((item) => ({ id: item.id, pairId, membershipEraId: item.eraId, category: "fun" as const, startedByParticipantId: primary.id, endedAt: new Date() })));
  await database.insert(togetherSessionQuestion).values(historicalCardRows as never);

  const currentConversations = ["fun", "deep", "memories", "relationship"] as const;
  const currentConversationRows = currentConversations.map((category, index) => ({ id: randomUUID(), pairId, category, createdByParticipantId: index === 0 ? primary.id : otherParticipantId, membershipEraId: currentEraId }));
  await database.insert(privateConversation).values(currentConversationRows);
  const candidateId = randomUUID();
  const candidateRevision = revisionFor(200);
  await database.insert(privateQuestionCandidate).values({ id: candidateId, conversationId: currentConversationRows[0]!.id, questionId: candidateRevision.questionId, questionRevisionId: candidateRevision.id });

  const answerRoundId = randomUUID();
  const answerRevision = revisionFor(201);
  await database.insert(privateRound).values({ id: answerRoundId, pairId, conversationId: currentConversationRows[3]!.id, questionId: answerRevision.questionId, questionRevisionId: answerRevision.id, questionNumber: 1, initiatorParticipantId: otherParticipantId });
  const revealRoundId = randomUUID();
  const revealRevision = revisionFor(202);
  await database.insert(privateRound).values({ id: revealRoundId, pairId, conversationId: currentConversationRows[1]!.id, questionId: revealRevision.questionId, questionRevisionId: revealRevision.id, questionNumber: 1, initiatorParticipantId: primary.id });
  await database.insert(privateAnswer).values({ roundId: revealRoundId, participantId: primary.id, body: "Reveal answer one" });
  await database.insert(privateAnswer).values({ roundId: revealRoundId, participantId: otherParticipantId, body: "Reveal answer two" });

  const currentSessions = Array.from({ length: 6 }, () => ({ id: randomUUID(), pairId, membershipEraId: currentEraId, category: "fun" as const, startedByParticipantId: primary.id }));
  await database.insert(togetherSession).values(currentSessions);
  const currentCardRows: Array<{ sessionId: string; questionId: string; questionRevisionId: string; position: number; advancedAt: Date | null }> = [];
  for (const [sessionIndex, currentSession] of currentSessions.entries()) {
    const revision = revisionFor(20 + sessionIndex);
    currentCardRows.push({ sessionId: currentSession.id, questionId: revision.questionId, questionRevisionId: revision.id, position: 1, advancedAt: null });
  }
  await database.insert(togetherSessionQuestion).values(currentCardRows);

  const preClaimSessionId = randomUUID();
  const preClaimRevision = revisionFor(230);
  await database.insert(togetherSession).values({ id: preClaimSessionId, pairId, membershipEraId: null, category: "fun", startedByParticipantId: primary.id, endedAt: new Date() });
  await database.insert(togetherSessionQuestion).values({ sessionId: preClaimSessionId, questionId: preClaimRevision.questionId, questionRevisionId: preClaimRevision.id, position: 1, advancedAt: new Date() });

  const activePairStatus = await getPairStatusForParticipant(database, primary.id, pairId);
  if (activePairStatus.state !== "connected") throw new Error("fixture pair was not connected");
  return {
    authUserId: signedUp.authUserId,
    cookie: signedUp.cookie,
    participantId: primary.id,
    otherParticipantId,
    pairId,
    invitePairId,
    historyRoundId: historicalRoundRows[0]!.id as string,
    answerRoundId,
    revealRoundId,
    privateConversationId: currentConversationRows[0]!.id,
    candidateId,
    togetherSessionId: currentSessions[0]!.id,
    togetherQuestionId: currentCardRows[0]!.questionId,
    initialInviteToken,
    rejoinInviteToken,
  };
}

async function run() {
  currentFixture = await seedFixture();
  const f = currentFixture;
  const results = [] as unknown[];

  results.push(await measure("auth.session", async () => {
    const resolved = await auth.api.getSession({ headers: new Headers({ cookie: f.cookie }) });
    if (!resolved?.user?.id) throw new Error("session did not resolve");
  }));
  results.push(await measure("auth.participant", async () => {
    if (!(await getParticipantByAuthUserId(database, f.authUserId))) throw new Error("participant did not resolve");
  }));
  results.push(await measureHttp("root.home.request", "/"));
  results.push(await measureHttp("pair.home.request", `/pair/${f.pairId}`));
  results.push(await measureHttp("private.picker.request", `/pair/${f.pairId}/private`));
  results.push(await measureHttp("history.request", `/pair/${f.pairId}/history`, Math.max(3, Math.min(repeats, 5))));
  results.push(await measure("pair.home.projection", async () => {
    const [pairView, spaces] = await Promise.all([
      getPairForParticipant(database, f.participantId, f.pairId),
      listActivePairsForParticipant(database, f.participantId),
    ]);
    if (pairView.members.length === 2) await listActivePrivateConversations(database, { participantId: f.participantId, pairId: f.pairId });
    if (!spaces.length) throw new Error("spaces projection was empty");
  }));
  results.push(await measure("together.session.load", async () => {
    await getTogetherSessionForParticipant(database, { participantId: f.participantId, pairId: f.pairId, sessionId: f.togetherSessionId });
  }));
  results.push(await measure("together.playback.initial", async () => {
    await getTogetherSessionPlaybackForParticipant(database, { participantId: f.participantId, pairId: f.pairId, sessionId: f.togetherSessionId });
  }));
  results.push(await measure("together.question-page.light", async () => {
    await getTogetherQuestionPageForParticipant(database, { participantId: f.participantId, pairId: f.pairId, sessionId: f.togetherSessionId, band: "light" });
  }));
  results.push(await measure("private.conversation.load", async () => {
    await getPrivateConversationForParticipant(database, { participantId: f.participantId, pairId: f.pairId, conversationId: f.privateConversationId });
  }));
  results.push(await measure("private.round.load", async () => {
    await getPrivateRoundForParticipant(database, { participantId: f.participantId, pairId: f.pairId, roundId: f.revealRoundId });
  }));
  results.push(await measure("history.projection", async () => {
    await getFormerEraHistoryForParticipant(database, { participantId: f.participantId, pairId: f.pairId });
  }, Math.max(3, Math.min(repeats, 5))));
  results.push(await measure("invite.status", async () => {
    await getInitialInviteStatus(database, { participantId: f.participantId, pairId: f.invitePairId });
  }));
  results.push(await measure("join.preview", async () => {
    await getInitialInviteLanding(database, f.initialInviteToken);
  }));
  results.push(await measure("rejoin.preview", async () => {
    await getRejoinInviteLanding(database, f.rejoinInviteToken);
  }));

  const legacyTogetherProjection = await getTogetherSessionForParticipant(database, { participantId: f.participantId, pairId: f.pairId, sessionId: f.togetherSessionId });
  const initialTogetherPlayback = await getTogetherSessionPlaybackForParticipant(database, { participantId: f.participantId, pairId: f.pairId, sessionId: f.togetherSessionId });
  const nextTogetherPage = await getTogetherQuestionPageForParticipant(database, { participantId: f.participantId, pairId: f.pairId, sessionId: f.togetherSessionId, band: "light" });
  const nextTogetherQuestion = nextTogetherPage.items[0];
  if (!nextTogetherQuestion) throw new Error("performance fixture did not produce a next Together Question");
  results.push(await measure("together.next.mutation", async () => {
    await advanceTogetherSession(database, {
      participantId: f.participantId,
      pairId: f.pairId,
      sessionId: f.togetherSessionId,
      action: "next",
      currentQuestionId: f.togetherQuestionId,
      nextQuestionId: nextTogetherQuestion.questionId,
      nextQuestionRevisionId: nextTogetherQuestion.questionRevisionId,
      clientRequestId: randomUUID(),
    });
  }, 1));

  // Mutations are measured once against isolated fixture rows because they advance lifecycle state.
  results.push(await measure("private.answer.mutation+projection", async () => {
    await submitPrivateAnswer(database, { participantId: f.participantId, pairId: f.pairId, roundId: f.answerRoundId, body: "Performance answer" });
  }, 1));
  results.push(await measure("private.reveal.mutation+projection", async () => {
    await markPrivateRevealViewed(database, { participantId: f.participantId, pairId: f.pairId, roundId: f.revealRoundId });
  }, 1));
  results.push(await measure("private.ask.mutation", async () => {
    await askPrivateQuestionCandidate(database, { participantId: f.participantId, pairId: f.pairId, conversationId: f.privateConversationId, candidateId: f.candidateId, clientRequestId: randomUUID() });
  }, 1));

  console.log(JSON.stringify({
    fixture: { pairId: f.pairId, participantId: f.participantId },
    togetherPayloads: {
      legacyInitialProjection: serializedPayloadSize(legacyTogetherProjection),
      initialPlaybackProjection: serializedPayloadSize(initialTogetherPlayback),
      subsequentQuestionPage: serializedPayloadSize(nextTogetherPage),
    },
    results,
  }, null, 2));
  process.exit(0);
}

run().catch((error) => {
  if (error instanceof CloserDomainError) {
    console.error(`${error.code}: benchmark failed`);
  } else {
    console.error(error instanceof Error ? error.message : error);
  }
  process.exitCode = 1;
});
