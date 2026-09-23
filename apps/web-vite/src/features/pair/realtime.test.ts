import { afterEach, describe, expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";

import { connectPairRealtime, pairQueryKey } from "@/features/pair/realtime";

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readonly listeners = new Map<string, EventListenerOrEventListenerObject>();
  closed = false;

  constructor(
    readonly url: string,
    readonly options: EventSourceInit,
  ) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    this.listeners.set(type, listener);
  }

  close() {
    this.closed = true;
  }

  emit(type: string, pairId: string) {
    const listener = this.listeners.get(type);
    const event = { data: JSON.stringify({ pairId, type }) } as MessageEvent<string>;
    if (typeof listener === "function") listener(event);
    else listener?.handleEvent(event);
  }
}

describe("Pair realtime lifecycle", () => {
  const original = globalThis.EventSource;
  afterEach(() => {
    globalThis.EventSource = original;
    FakeEventSource.instances = [];
  });

  test("closes and invalidates active caches when this Pair terminates", () => {
    globalThis.EventSource = FakeEventSource as unknown as typeof EventSource;
    const client = new QueryClient();
    client.setQueryData(pairQueryKey("pair-1"), {
      pairId: "pair-1",
      state: "connected",
      members: [{ slot: "first", displayName: "Ari" }],
    });
    client.setQueryData(["private-conversation", "pair-1", "deep"], {
      candidate: { text: "private" },
    });
    client.setQueryData(["private-history", "pair-1"], { rounds: [] });
    client.setQueryData(["together", "pair-1", "session-1"], { question: "active" });

    const dispose = connectPairRealtime("pair-1", client);
    const source = FakeEventSource.instances[0]!;
    expect(source.url).toBe("/api/v1/pairs/pair-1/events");
    source.emit("pair.terminated", "another-pair");
    expect(source.closed).toBe(false);

    source.emit("pair.terminated", "pair-1");

    expect(source.closed).toBe(true);
    expect(client.getQueryData<{ state: string }>(pairQueryKey("pair-1"))?.state).toBe(
      "terminated",
    );
    expect(client.getQueryData(["private-conversation", "pair-1", "deep"])).toBeUndefined();
    expect(client.getQueryData(["together", "pair-1", "session-1"])).toBeUndefined();
    expect(client.getQueryData<{ rounds: unknown[] }>(["private-history", "pair-1"])).toEqual({
      rounds: [],
    });
    dispose();
    client.clear();
  });
});
