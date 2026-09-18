import "server-only";

import {
  db,
  getPrivateRoundForParticipant,
  getPrivateRoundStatusForParticipant,
  markPrivateRevealViewed,
  submitPrivateAnswer,
} from "@Closer/auth/closer";

export function getPrivateRound(input: Parameters<typeof getPrivateRoundForParticipant>[1]) {
  return getPrivateRoundForParticipant(db, input);
}

export function getPrivateRoundStatus(
  input: Parameters<typeof getPrivateRoundStatusForParticipant>[1],
) {
  return getPrivateRoundStatusForParticipant(db, input);
}

export function submitAnswer(input: Parameters<typeof submitPrivateAnswer>[1]) {
  return submitPrivateAnswer(db, input);
}

export function markRevealViewed(input: Parameters<typeof markPrivateRevealViewed>[1]) {
  return markPrivateRevealViewed(db, input);
}
