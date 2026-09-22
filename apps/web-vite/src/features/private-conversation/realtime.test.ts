import { afterEach, describe, expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";

import { connectPrivateRealtime } from "@/features/private-conversation/realtime";

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readonly listeners = new Map<string, () => void>();
  closed = false;
  constructor(
    readonly url: string,
    readonly options: EventSourceInit,
  ) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    this.listeners.set(type, listener as () => void);
  }
  close() {
    this.closed = true;
  }
  emit(type: string) {
    this.listeners.get(type)?.();
  }
}

describe("Private realtime reconciliation", () => {
  const original = globalThis.EventSource;
  afterEach(() => {
    globalThis.EventSource = original;
    FakeEventSource.instances = [];
  });

  test("invalidates only the Pair's Private query prefix and closes on termination", async () => {
    globalThis.EventSource = FakeEventSource as unknown as typeof EventSource;
    const client = new QueryClient();
    let invalidated = 0;
    const originalInvalidate = client.invalidateQueries.bind(client);
    client.invalidateQueries = (filters) => {
      invalidated += 1;
      return originalInvalidate(filters);
    };
    const dispose = connectPrivateRealtime("pair-1", client);
    const source = FakeEventSource.instances[0]!;
    expect(source.url).toBe("/api/v1/pairs/pair-1/events");
    source.emit("private.changed");
    await Promise.resolve();
    expect(invalidated).toBe(1);
    source.emit("pair.terminated");
    await Promise.resolve();
    expect(invalidated).toBe(2);
    expect(source.closed).toBe(true);
    dispose();
    expect(source.closed).toBe(true);
  });
});
