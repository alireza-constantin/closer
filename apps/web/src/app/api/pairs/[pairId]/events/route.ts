import { db, getRealtimeBus, type RealtimeEvent } from "@Closer/db";
import { getPairForParticipant, getParticipantByAuthUserId } from "@Closer/auth/closer";

import { getAuthUserIdFromRequest } from "@/lib/closer-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const encoder = new TextEncoder();
const headers = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "private, no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};

export async function GET(request: Request, context: { params: Promise<{ pairId: string }> }) {
  const authUserId = await getAuthUserIdFromRequest(request.headers);
  if (!authUserId) return Response.json({ error: "Sign in is required." }, { status: 401 });
  const participant = await getParticipantByAuthUserId(db, authUserId);
  if (!participant) return Response.json({ error: "Not found." }, { status: 404 });
  const { pairId } = await context.params;
  try {
    await getPairForParticipant(db, participant.id, pairId);
  } catch {
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  let unsubscribe: (() => void) | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const close = () => {
        if (heartbeat) clearInterval(heartbeat);
        unsubscribe?.();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      unsubscribe = getRealtimeBus().subscribe(pairId, (event: RealtimeEvent) => {
        controller.enqueue(
          encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`),
        );
      });
      controller.enqueue(encoder.encode(": connected\n\n"));
      heartbeat = setInterval(() => controller.enqueue(encoder.encode(": heartbeat\n\n")), 20_000);
      request.signal.addEventListener("abort", close, { once: true });
    },
    cancel() {
      if (heartbeat) clearInterval(heartbeat);
      unsubscribe?.();
    },
  });
  return new Response(stream, { headers });
}
