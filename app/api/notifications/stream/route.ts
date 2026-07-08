import { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { createDueScheduledCallNotifications } from '@/lib/scheduled-call-notifications';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Hard cap on how long a single SSE connection stays open. Browsers don't
// always signal disconnection promptly (e.g. the tab's process is killed
// rather than gracefully closed), which can otherwise leave a tick() loop
// polling forever. The client auto-reconnects on close, so this just bounds
// the worst case rather than changing normal behavior.
const MAX_CONNECTION_MS = 30 * 60 * 1000;

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return new Response('Unauthorized', { status: 401 });

  const userId = session.user.id;
  const encoder = new TextEncoder();
  let closed = false;
  // Look back 5 s on connect so notifications that arrived just before the
  // stream opened (or while reconnecting) aren't missed
  let lastCheck = new Date(Date.now() - 5_000);

  const stream = new ReadableStream({
    start(controller) {
      function send(event: string, data: unknown) {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      }

      // Confirm connection established
      send('ping', { ts: Date.now() });

      async function tick() {
        if (closed) return;
        try {
          const now = new Date();

          // Create any due CALL_REMINDER / CALL_NOW notifications, then push
          // everything new since last poll — covers those plus notifications
          // created by other routes (e.g. lead assignment) in the meantime.
          await createDueScheduledCallNotifications(userId);
          const newNotifs = await prisma.notification.findMany({
            where:   { userId, read: false, createdAt: { gt: lastCheck } },
            orderBy: { createdAt: 'desc' },
          });
          if (newNotifs.length > 0) send('notification', newNotifs);

          lastCheck = now;
        } catch {
          // DB hiccup — skip tick, will retry
        }
      }

      function teardown() {
        closed = true;
        clearInterval(interval);
        clearTimeout(maxLifetimeTimer);
        try { controller.close(); } catch { /* already closed */ }
      }

      // Run immediately on connect, then every 20 s
      tick();
      const interval = setInterval(tick, 20_000);
      const maxLifetimeTimer = setTimeout(teardown, MAX_CONNECTION_MS);

      req.signal.addEventListener('abort', teardown);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type':      'text/event-stream',
      'Cache-Control':     'no-cache, no-transform',
      'Connection':        'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
