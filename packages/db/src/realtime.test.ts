import { describe, expect, test } from "bun:test";

import {
  REALTIME_CHANNEL,
  RealtimeBus,
  parseRealtimeEvent,
  publishRealtimeEvent,
} from "./realtime";

type Handler = (value: any) => void;

class FakeListener {
  readonly handlers = new Map<string, Handler[]>();
  readonly queries: unknown[][] = [];
  connected = 0;
  ended = 0;

  async connect() {
    this.connected += 1;
  }
  async query(...args: unknown[]) {
    this.queries.push(args);
  }
  on(event: string, handler: Handler) {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
    return this as never;
  }
  async end() {
    this.ended += 1;
  }
  emit(event: string, value?: unknown) {
    this.handlers.get(event)?.forEach((handler) => handler(value));
  }
}

const changed = { version: 1, pairId: "pair-a", type: "pair.changed" } as const;

describe("Postgres-backed realtime bus", () => {
  test("accepts every allowed metadata-only event and rejects invalid payloads", () => {
    expect(parseRealtimeEvent(changed)).toEqual(changed);
    expect(parseRealtimeEvent({ version: 1, pairId: "pair-a", type: "private.changed" })).toEqual({
      version: 1,
      pairId: "pair-a",
      type: "private.changed",
    });
    expect(parseRealtimeEvent({ version: 1, pairId: "pair-a", type: "together.changed" })).toEqual({
      version: 1,
      pairId: "pair-a",
      type: "together.changed",
    });
    expect(parseRealtimeEvent({ version: 1, pairId: "pair-a", type: "pair.terminated" })).toEqual({
      version: 1,
      pairId: "pair-a",
      type: "pair.terminated",
    });
    expect(parseRealtimeEvent({ version: 1, pairId: "pair-a", type: "answer.leaked" })).toBeNull();
    expect(parseRealtimeEvent({ version: 1, type: "pair.changed" })).toBeNull();
    expect(parseRealtimeEvent({ version: 2, pairId: "pair-a", type: "pair.changed" })).toBeNull();
  });

  test("delivers only matching Pair events to all current local subscribers and cleans up independently", async () => {
    const listener = new FakeListener();
    const bus = new RealtimeBus("postgres://test", () => listener as never);
    const a1: unknown[] = [];
    const a2: unknown[] = [];
    const b: unknown[] = [];
    const unsubscribeA1 = bus.subscribe("pair-a", (event) => a1.push(event));
    const unsubscribeA2 = bus.subscribe("pair-a", (event) => a2.push(event));
    const unsubscribeB = bus.subscribe("pair-b", (event) => b.push(event));
    await Promise.resolve();

    expect(listener.connected).toBe(1);
    expect(listener.queries).toEqual([[`LISTEN ${REALTIME_CHANNEL}`]]);
    listener.emit("notification", { channel: REALTIME_CHANNEL, payload: JSON.stringify(changed) });
    listener.emit("notification", { channel: REALTIME_CHANNEL, payload: "not json" });
    expect(a1).toEqual([changed]);
    expect(a2).toEqual([changed]);
    expect(b).toEqual([]);

    unsubscribeA1();
    listener.emit("notification", { channel: REALTIME_CHANNEL, payload: JSON.stringify(changed) });
    expect(a1).toEqual([changed]);
    expect(a2).toEqual([changed, changed]);
    unsubscribeA2();
    unsubscribeA2();
    listener.emit("notification", { channel: REALTIME_CHANNEL, payload: JSON.stringify(changed) });
    expect(a2).toEqual([changed, changed]);
    unsubscribeB();
  });

  test("does not create duplicate listener connections during repeated subscribe or reconnect delivery", async () => {
    const first = new FakeListener();
    const second = new FakeListener();
    const listeners = [first, second];
    const bus = new RealtimeBus("postgres://test", () => listeners.shift() as never);
    const received: unknown[] = [];
    bus.subscribe("pair-a", (event) => received.push(event));
    bus.subscribe("pair-a", () => undefined);
    await Bun.sleep(0);
    expect(first.connected).toBe(1);

    first.emit("end");
    await new Promise((resolve) => setTimeout(resolve, 1_050));
    await Promise.resolve();
    expect(second.connected).toBe(1);
    second.emit("notification", { channel: REALTIME_CHANNEL, payload: JSON.stringify(changed) });
    expect(received).toEqual([changed]);
  });

  test("serializes exactly the allowed event metadata for fixed-channel publication", async () => {
    const publications: string[] = [];
    const bus = new RealtimeBus(
      "postgres://test",
      () => new FakeListener() as never,
      async (payload) => {
        publications.push(payload);
      },
    );
    await bus.publish({ version: 1, pairId: "pair-a", type: "private.changed" });
    expect(JSON.parse(publications[0]!)).toEqual({
      version: 1,
      pairId: "pair-a",
      type: "private.changed",
    });
    expect(REALTIME_CHANNEL).toBe("closer_realtime");
  });

  test("contains publication failure after a committed command and emits a restrained warning", async () => {
    const globalBus = globalThis as typeof globalThis & {
      __closerRealtimeBus?: { publish: () => Promise<void> };
    };
    const original = globalBus.__closerRealtimeBus;
    const warning = console.warn;
    const warnings: string[] = [];
    globalBus.__closerRealtimeBus = {
      publish: async () => {
        throw new Error("database unavailable");
      },
    };
    console.warn = (message: string) => {
      warnings.push(message);
    };
    try {
      await expect(publishRealtimeEvent("pair-a", "private.changed")).resolves.toBeUndefined();
      expect(warnings).toEqual(["realtime publish failed type=private.changed"]);
    } finally {
      console.warn = warning;
      if (original) globalBus.__closerRealtimeBus = original;
      else delete globalBus.__closerRealtimeBus;
    }
  });
});
