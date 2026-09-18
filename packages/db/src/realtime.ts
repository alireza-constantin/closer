import { sql } from "drizzle-orm";
import { Client } from "pg";

import { env } from "@Closer/env/server";

export const REALTIME_CHANNEL = "closer_realtime";
export const realtimeEventTypes = ["pair.changed", "private.changed", "together.changed", "pair.terminated"] as const;
export type RealtimeEventType = (typeof realtimeEventTypes)[number];
export type RealtimeEvent = { version: 1; pairId: string; type: RealtimeEventType };

type Subscriber = (event: RealtimeEvent) => void;
type ListenerClient = Pick<Client, "connect" | "query" | "on" | "end">;

export function parseRealtimeEvent(value: unknown): RealtimeEvent | null {
  if (!value || typeof value !== "object") return null;
  const event = value as Record<string, unknown>;
  return event.version === 1
    && typeof event.pairId === "string" && event.pairId.length > 0
    && typeof event.type === "string" && (realtimeEventTypes as readonly string[]).includes(event.type)
    ? { version: 1, pairId: event.pairId, type: event.type as RealtimeEventType }
    : null;
}

export class RealtimeBus {
  private readonly subscribers = new Map<string, Set<Subscriber>>();
  private listener: ListenerClient | null = null;
  private starting: Promise<void> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;

  constructor(
    private readonly databaseUrl: string,
    private readonly createListener: () => ListenerClient = () => new Client({ connectionString: databaseUrl }),
    private readonly publishQuery: (payload: string) => Promise<void> = async (payload) => {
      const publisher = new Client({ connectionString: databaseUrl });
      try {
        await publisher.connect();
        await publisher.query("SELECT pg_notify($1, $2)", [REALTIME_CHANNEL, payload]);
      } finally {
        await publisher.end().catch(() => undefined);
      }
    },
  ) {}

  async publish(event: RealtimeEvent) {
    await this.publishQuery(JSON.stringify(event));
  }

  subscribe(pairId: string, subscriber: Subscriber) {
    let pairSubscribers = this.subscribers.get(pairId);
    if (!pairSubscribers) {
      pairSubscribers = new Set();
      this.subscribers.set(pairId, pairSubscribers);
    }
    pairSubscribers.add(subscriber);
    void this.ensureListener();
    return () => {
      const current = this.subscribers.get(pairId);
      current?.delete(subscriber);
      if (current?.size === 0) this.subscribers.delete(pairId);
    };
  }

  private async ensureListener() {
    if (this.listener || this.starting) return this.starting;
    this.starting = this.startListener().finally(() => { this.starting = null; });
    return this.starting;
  }

  private async startListener() {
    const listener = this.createListener();
    listener.on("notification", (message: { channel?: string; payload?: string }) => {
      if (message.channel !== REALTIME_CHANNEL || !message.payload) return;
      let parsed: RealtimeEvent | null = null;
      try { parsed = parseRealtimeEvent(JSON.parse(message.payload)); } catch { return; }
      if (!parsed) return;
      this.subscribers.get(parsed.pairId)?.forEach((subscriber) => subscriber(parsed!));
    });
    listener.on("error", () => this.scheduleReconnect());
    listener.on("end", () => this.scheduleReconnect());
    try {
      await listener.connect();
      await listener.query(`LISTEN ${REALTIME_CHANNEL}`);
      this.listener = listener;
      this.reconnectAttempts = 0;
    } catch {
      await listener.end().catch(() => undefined);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    if (this.listener) this.listener = null;
    if (this.reconnectTimer || this.subscribers.size === 0) return;
    const delay = Math.min(1_000 * 2 ** this.reconnectAttempts++, 30_000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.ensureListener();
    }, delay);
  }
}

const globalRealtime = globalThis as typeof globalThis & { __closerRealtimeBus?: RealtimeBus };

export function getRealtimeBus() {
  return globalRealtime.__closerRealtimeBus ??= new RealtimeBus(
    env.REALTIME_DATABASE_URL ?? env.DATABASE_URL,
    undefined,
    async (payload) => {
      // The listener needs a session-capable Client. Publishing is a normal,
      // one-shot query and deliberately reuses the application's Drizzle pool.
      const { db } = await import("./index");
      await db.execute(sql`SELECT pg_notify(${REALTIME_CHANNEL}, ${payload})`);
    },
  );
}

export async function publishRealtimeEvent(pairId: string, type: RealtimeEventType) {
  try {
    await getRealtimeBus().publish({ version: 1, pairId, type });
  } catch {
    // A committed command remains successful; focus/fallback refetch reconciles.
    console.warn(`realtime publish failed type=${type}`);
  }
}
