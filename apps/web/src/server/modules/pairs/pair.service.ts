import "server-only";

import * as closer from "@Closer/auth/closer";

export function listParticipantSpaces(participantId: string) {
  return closer.listActivePairsForParticipant(closer.db, participantId);
}

export function getAuthorizedPair(participantId: string, pairId: string) {
  return closer.getPairForParticipant(closer.db, participantId, pairId);
}

export function getPairEntry(participantId: string, pairId: string) {
  return closer.getPairEntryForParticipant(closer.db, participantId, pairId);
}

export function getAuthorizedPairStatus(participantId: string, pairId: string) {
  return closer.getPairStatusForParticipant(closer.db, participantId, pairId);
}

export function listPairPrivateConversations(participantId: string, pairId: string) {
  return closer.listActivePrivateConversations(closer.db, { participantId, pairId });
}

export function createPair(input: Parameters<typeof closer.createPairForParticipant>[1]) {
  return closer.createPairForParticipant(closer.db, input);
}

export function updatePairIntendedPersonName(
  input: Parameters<typeof closer.updateIntendedPersonName>[1],
) {
  return closer.updateIntendedPersonName(closer.db, input);
}

export function endPair(input: Parameters<typeof closer.terminatePair>[1]) {
  return closer.terminatePair(closer.db, input);
}
