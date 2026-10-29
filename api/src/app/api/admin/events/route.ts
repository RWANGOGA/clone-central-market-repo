import { requireAdmin } from '@/lib/catalogue';
import { error } from '@/lib/http';
import { marketFeedFilter, subscribe, type OrderEvent } from '@/lib/orderEvents';

/**
 * Live order feed over Server-Sent Events.
 *
 * SSE rather than WebSockets: it is one-way, which is all a dashboard needs,
 * it streams from an ordinary route handler, it survives the Vite dev proxy,
 * and the browser reconnects on its own.
 *
 * A comment heartbeat goes out every 25 seconds. Without it, proxies and load
 * balancers quietly drop an idle connection and the client stops receiving
 * without any error.
 */

export const dynamic = 'force-dynamic';

const HEARTBEAT_MS = 25_000;

export async function GET(request: Request) {
  const admin = await requireAdmin(request);
  if (!admin) return error('Not signed in', 401);

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;

      const send = (payload: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(payload));
        } catch {
          closed = true;
        }
      };

      // Tell the browser how long to wait before reconnecting, then confirm
      // the stream is open.
      send('retry: 3000\n\n');
      send(`event: ready\ndata: ${JSON.stringify({ connected: true, at: new Date().toISOString() })}\n\n`);

      // Bounded by market, so an account pinned to one market never watches
      // another market's customers check out. The platform tier passes no filter.
      const unsubscribe = subscribe(
        (event: OrderEvent) => {
          send(`event: order\ndata: ${JSON.stringify(event)}\n\n`);
        },
        marketFeedFilter(admin),
      );

      const heartbeat = setInterval(() => {
        if (closed) return;
        send(`: heartbeat ${Date.now()}\n\n`);
      }, HEARTBEAT_MS);

      const stop = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // Already closed by the runtime.
        }
      };

      request.signal.addEventListener('abort', stop);
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      // Nginx buffers text/event-stream by default, which defeats streaming.
      'x-accel-buffering': 'no',
    },
  });
}
