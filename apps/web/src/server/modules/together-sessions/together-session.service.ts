import "server-only";

import {
  db,
  getTogetherSessionPlaybackForParticipant,
  startTogetherSession,
} from "@Closer/auth/closer";

export function getTogetherSessionPlayback(
  input: Parameters<typeof getTogetherSessionPlaybackForParticipant>[1],
) {
  return getTogetherSessionPlaybackForParticipant(db, input);
}

export function startSession(input: Parameters<typeof startTogetherSession>[1]) {
  return startTogetherSession(db, input);
}
