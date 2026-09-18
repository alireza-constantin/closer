import { env } from "@Closer/env/server";
import { drizzle } from "drizzle-orm/node-postgres";

import * as schema from "./schema";

export function createDb() {
  return drizzle(env.DATABASE_URL, { schema });
}

export const db = createDb();

export {
  getRealtimeBus,
  parseRealtimeEvent,
  publishRealtimeEvent,
  REALTIME_CHANNEL,
  RealtimeBus,
} from "./realtime";
export type { RealtimeEvent, RealtimeEventType } from "./realtime";
