import "server-only";

import {
  db,
  getPrivateConversationForParticipant,
  listActivePrivateConversations,
  startOrResumePrivateConversation,
} from "@Closer/auth/closer";

export function listPrivateConversations(participantId: string, pairId: string) {
  return listActivePrivateConversations(db, { participantId, pairId });
}

export function getPrivateConversation(
  input: Parameters<typeof getPrivateConversationForParticipant>[1],
) {
  return getPrivateConversationForParticipant(db, input);
}

export function startPrivateConversation(
  input: Parameters<typeof startOrResumePrivateConversation>[1],
) {
  return startOrResumePrivateConversation(db, input);
}
