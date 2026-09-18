import { afterEach, describe, expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";

import { createPairRealtimeSubscription } from "./pair-realtime-provider";
import { closerKeys } from "@/lib/closer-query-keys";

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readonly listeners = new Map<string, Array<(event: any) => void>>();
  closed = false;
  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, listener: (event: any) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  close() {
    this.closed = true;
  }
  emit(type: string, data = "") {
    this.listeners.get(type)?.forEach((listener) => listener({ data }));
  }
}

const originalEventSource = globalThis.EventSource;

afterEach(() => {
  FakeEventSource.instances = [];
  Object.assign(globalThis, { EventSource: originalEventSource });
});

function client() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function setFresh(queryClient: QueryClient, key: readonly unknown[]) {
  queryClient.setQueryData(key, { value: true });
  expect(queryClient.getQueryState(key)?.isInvalidated).toBe(false);
}

describe("PairRealtimeProvider transport subscription", () => {
  test("opens one Pair-scoped EventSource, reconciles on open, and closes idempotently", () => {
    Object.assign(globalThis, { EventSource: FakeEventSource });
    const queryClient = client();
    setFresh(queryClient, closerKeys.pairStatus("pair-a"));
    setFresh(queryClient, closerKeys.privateConversations("pair-a"));
    const close = createPairRealtimeSubscription(queryClient, "pair-a");
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0]?.url).toBe("/api/pairs/pair-a/events");
    FakeEventSource.instances[0]?.emit("open");
    expect(queryClient.getQueryState(closerKeys.pairStatus("pair-a"))?.isInvalidated).toBe(true);
    expect(
      queryClient.getQueryState(closerKeys.privateConversations("pair-a"))?.isInvalidated,
    ).toBe(true);
    close();
    close();
    expect(FakeEventSource.instances[0]?.closed).toBe(true);
  });

  test("targets only the query prefix designated by each event and rejects stale Pair data", () => {
    Object.assign(globalThis, { EventSource: FakeEventSource });
    const queryClient = client();
    setFresh(queryClient, closerKeys.pairStatus("pair-a"));
    setFresh(queryClient, closerKeys.privateConversations("pair-a"));
    setFresh(queryClient, closerKeys.together("pair-a"));
    setFresh(queryClient, closerKeys.privateConversations("pair-b"));
    createPairRealtimeSubscription(queryClient, "pair-a");
    const source = FakeEventSource.instances[0]!;

    source.emit(
      "private.changed",
      JSON.stringify({ version: 1, pairId: "pair-a", type: "private.changed" }),
    );
    expect(
      queryClient.getQueryState(closerKeys.privateConversations("pair-a"))?.isInvalidated,
    ).toBe(true);
    expect(queryClient.getQueryState(closerKeys.together("pair-a"))?.isInvalidated).toBe(false);
    expect(
      queryClient.getQueryState(closerKeys.privateConversations("pair-b"))?.isInvalidated,
    ).toBe(false);

    setFresh(queryClient, closerKeys.together("pair-a"));
    source.emit(
      "together.changed",
      JSON.stringify({ version: 1, pairId: "pair-a", type: "together.changed" }),
    );
    expect(queryClient.getQueryState(closerKeys.together("pair-a"))?.isInvalidated).toBe(true);
    setFresh(queryClient, closerKeys.pairStatus("pair-a"));
    source.emit(
      "pair.changed",
      JSON.stringify({ version: 1, pairId: "pair-b", type: "pair.changed" }),
    );
    expect(queryClient.getQueryState(closerKeys.pairStatus("pair-a"))?.isInvalidated).toBe(false);
  });

  test("changing Pair subscriptions closes the old source and stale old events cannot invalidate the new cache", () => {
    Object.assign(globalThis, { EventSource: FakeEventSource });
    const queryClient = client();
    const closeA = createPairRealtimeSubscription(queryClient, "pair-a");
    const sourceA = FakeEventSource.instances[0]!;
    closeA();
    createPairRealtimeSubscription(queryClient, "pair-b");
    setFresh(queryClient, closerKeys.pairStatus("pair-b"));
    sourceA.emit(
      "pair.changed",
      JSON.stringify({ version: 1, pairId: "pair-a", type: "pair.changed" }),
    );
    expect(sourceA.closed).toBe(true);
    expect(FakeEventSource.instances[1]?.url).toBe("/api/pairs/pair-b/events");
    expect(queryClient.getQueryState(closerKeys.pairStatus("pair-b"))?.isInvalidated).toBe(false);
  });
});
