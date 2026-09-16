export type PairRelationshipType = "partner" | "friend";

export function togetherPickerPath(pairId: string, relationshipType: PairRelationshipType) {
  return `/pair/${pairId}/together/${relationshipType}`;
}
