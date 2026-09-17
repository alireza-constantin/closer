export type ConnectedPairStatus = {
  state: "connected";
  otherParticipantDisplayName: string;
};

export type WaitingPairStatus = { state: "waiting" };

export type PairStatus = ConnectedPairStatus | WaitingPairStatus;

export function isConnectedPairStatus(value: unknown): value is ConnectedPairStatus {
  return (
    !!value
    && typeof value === "object"
    && "state" in value
    && value.state === "connected"
    && "otherParticipantDisplayName" in value
    && typeof value.otherParticipantDisplayName === "string"
  );
}
