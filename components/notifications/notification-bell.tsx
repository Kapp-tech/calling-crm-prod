'use client';

import { useState, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, UserPlus, CalendarClock, PhoneCall, CheckCheck, X, ArrowRight, Receipt, CheckCircle2, XCircle } from 'lucide-react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { toast } from '@/components/ui/use-toast';
import { ToastAction } from '@/components/ui/toast';

type NotificationKind =
  | 'LEAD_ASSIGNED' | 'CALL_REMINDER' | 'CALL_NOW'
  | 'RECEIPT_SUBMITTED' | 'RECEIPT_APPROVED' | 'RECEIPT_DISAPPROVED';

interface NotificationItem {
  id: string;
  type: NotificationKind;
  title: string;
  body: string;
  leadId?: string | null;
  read: boolean;
  createdAt: string;
}

// Where clicking a notification should take you, and the label on its action
// button/link. Returns null for types with no obvious destination (e.g. call
// reminders, which are actioned from the lead itself, not a dedicated page).
function notificationTarget(n: NotificationItem): { href: string; label: string } | null {
  switch (n.type) {
    case 'LEAD_ASSIGNED':
      return { href: `/dashboard/notifications/${n.id}/leads`, label: 'View leads' };
    case 'RECEIPT_SUBMITTED':
      return { href: '/dashboard/super-admin/receipt-approvals', label: 'Review' };
    case 'RECEIPT_APPROVED':
    case 'RECEIPT_DISAPPROVED':
      return n.leadId ? { href: `/leads/${n.leadId}/profile`, label: 'View lead' } : null;
    default:
      return null;
  }
}

// Pleasant ascending C-E-G chime using Web Audio API — no audio file needed
function playChime() {
  try {
    const ctx  = new AudioContext();
    const now  = ctx.currentTime;
    [523.25, 659.25, 783.99].forEach((freq, i) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.value = freq;
      const t = now + i * 0.16;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.28, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
      osc.start(t);
      osc.stop(t + 0.55);
    });
  } catch { /* AudioContext blocked by browser policy — silent */ }
}

const TYPE_META = {
  LEAD_ASSIGNED:       { Icon: UserPlus,      color: 'bg-blue-100 text-blue-600 dark:bg-blue-950 dark:text-blue-400' },
  CALL_REMINDER:       { Icon: CalendarClock, color: 'bg-amber-100 text-amber-600 dark:bg-amber-950 dark:text-amber-400' },
  CALL_NOW:            { Icon: PhoneCall,     color: 'bg-green-100 text-green-600 dark:bg-green-950 dark:text-green-400' },
  RECEIPT_SUBMITTED:   { Icon: Receipt,       color: 'bg-indigo-100 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-400' },
  RECEIPT_APPROVED:    { Icon: CheckCircle2,  color: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400' },
  RECEIPT_DISAPPROVED: { Icon: XCircle,       color: 'bg-red-100 text-red-600 dark:bg-red-950 dark:text-red-400' },
} as const;

// How many notifications the dropdown previews. The panel is a glance, not an
// archive — anything beyond this is one click away on /dashboard/notifications,
// and the footer says how many there are in total.
const PREVIEW_COUNT = 6;

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m    = Math.floor(diff / 60_000);
  if (m < 1)  return 'Just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function NotificationBell() {
  const { data: session } = useSession();
  const qc                = useQueryClient();
  const router            = useRouter();
  const [open, setOpen]   = useState(false);
  const [shake, setShake] = useState(false);
  const prevUnreadRef     = useRef(0);
  const hasSeededRef      = useRef(false);
  const seenIdsRef        = useRef<Set<string>>(new Set());
  const dropdownRef       = useRef<HTMLDivElement>(null);

  // Poll every 10 s as fallback — also refetches on window focus.
  // Seeding (below) happens inside queryFn, which only ever runs for a real
  // network fetch — never for the SSE handler's qc.setQueryData calls. This
  // matters: setQueryData can make the query "succeed" with a tiny SSE-pushed
  // dataset before the real fetch resolves, which would otherwise seed the
  // "already seen" set from the wrong (incomplete) snapshot and cause stale
  // pre-existing notifications to incorrectly pop a toast/chime on page load.
  const { data: notifications = [] } = useQuery<NotificationItem[]>({
    queryKey: ['notifications'],
    queryFn: () =>
      fetch('/api/notifications')
        .then((r) => r.json())
        .then((d) => {
          const list: NotificationItem[] = Array.isArray(d) ? d : [];
          if (!hasSeededRef.current) {
            hasSeededRef.current = true;
            seenIdsRef.current = new Set(list.map((n) => n.id));
            prevUnreadRef.current = list.filter((n) => !n.read).length;
          }
          return list;
        }),
    enabled:                    !!session,
    refetchInterval:            10_000,
    refetchIntervalInBackground: true,
    staleTime:                  0,
  });

  const unread = notifications.filter((n) => !n.read).length;

  // SSE subscription for real-time push delivery
  useEffect(() => {
    if (!session) return;

    let es: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      es = new EventSource('/api/notifications/stream');

      es.addEventListener('notification', (e) => {
        try {
          const incoming: NotificationItem[] = JSON.parse(e.data);
          if (!Array.isArray(incoming) || incoming.length === 0) return;
          qc.setQueryData<NotificationItem[]>(['notifications'], (prev) => {
            const existing = prev ?? [];
            const existingIds = new Set(existing.map((n) => n.id));
            const fresh = incoming.filter((n) => !existingIds.has(n.id));
            if (fresh.length === 0) return existing;
            return [...fresh, ...existing];
          });
        } catch { /* ignore malformed SSE data */ }
      });

      es.onerror = () => {
        es?.close();
        es = null;
        retryTimer = setTimeout(connect, 5_000);
      };
    }

    connect();

    return () => {
      es?.close();
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [session, qc]);

  // Play chime + shake bell when unread count goes up. Gated on hasSeededRef
  // (set inside queryFn above) so stale unread notifications already sitting
  // in the DB at page load don't falsely trigger the chime.
  useEffect(() => {
    if (!hasSeededRef.current) return;
    if (unread > prevUnreadRef.current) {
      playChime();
      setShake(true);
      setTimeout(() => setShake(false), 800);
    }
    prevUnreadRef.current = unread;
  }, [unread]);

  // Pop up a dismissable toast for every notification we haven't shown yet —
  // covers both SSE pushes and the 10s fallback poll. Gated on hasSeededRef so
  // pre-existing notifications don't all pop on load (see comment above).
  useEffect(() => {
    if (!hasSeededRef.current) return;
    const fresh = notifications.filter((n) => !n.read && !seenIdsRef.current.has(n.id));
    for (const n of notifications) seenIdsRef.current.add(n.id);
    fresh.forEach((n) => {
      const target = notificationTarget(n);
      toast({
        title: n.title,
        description: n.body,
        action: target ? (
          <ToastAction
            altText={target.label}
            onClick={() => {
              markRead(n.id);
              router.push(target.href);
            }}
          >
            {target.label}
          </ToastAction>
        ) : undefined,
      });
    });
  }, [notifications]);

  // Close dropdown on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  async function markAllRead() {
    await fetch('/api/notifications', { method: 'PATCH' });
    qc.setQueryData<NotificationItem[]>(['notifications'], (prev) =>
      (prev ?? []).map((n) => ({ ...n, read: true }))
    );
  }

  async function markRead(id: string) {
    // Optimistic update
    qc.setQueryData<NotificationItem[]>(['notifications'], (prev) =>
      (prev ?? []).map((n) => (n.id === id ? { ...n, read: true } : n))
    );
    await fetch(`/api/notifications/${id}`, { method: 'PATCH' });
  }

  if (!session) return null;

  return (
    <div className="relative" ref={dropdownRef}>

      {/* Bell button */}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Notifications"
        className={cn(
          'relative flex h-9 w-9 items-center justify-center rounded-full border border-border bg-background transition-colors hover:bg-muted',
          open  && 'bg-muted',
          shake && 'animate-bell-shake',
        )}
      >
        <Bell className={cn('h-[18px] w-[18px]', unread > 0 ? 'text-foreground' : 'text-muted-foreground')} />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {open && (
        // A bounded, three-part panel: fixed header, scrolling list, pinned
        // footer. Previously the list simply grew — ten notifications with
        // wrapping bodies made the panel taller than the viewport, so the
        // "See all notifications" link at the bottom was pushed off-screen and
        // could never be reached. Capping the height keeps both ends visible
        // and confines the overflow to the list itself.
        <div className="fixed inset-x-3 top-16 z-50 flex max-h-[min(75vh,32rem)] flex-col sm:absolute sm:inset-x-auto sm:right-0 sm:top-11 sm:w-[380px] overflow-hidden rounded-xl border border-border bg-background shadow-2xl ring-1 ring-black/5 dark:ring-white/5">

          {/* Header */}
          <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">Notifications</span>
              {unread > 0 && (
                <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-600 dark:bg-red-950 dark:text-red-400">
                  {unread} new
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              {unread > 0 && (
                <button
                  onClick={markAllRead}
                  className="flex items-center gap-1 text-[11px] text-primary hover:underline"
                >
                  <CheckCheck className="h-3 w-3" /> Mark all read
                </button>
              )}
              <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground transition-colors">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Notification list — scrolls within the panel; overscroll-contain
              stops the page behind it scrolling once the list hits its end. */}
          <div className="min-h-0 flex-1 divide-y divide-border/50 overflow-y-auto overscroll-contain">
            {notifications.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-10 text-center">
                <Bell className="h-8 w-8 text-muted-foreground/25" />
                <p className="text-sm text-muted-foreground">No notifications yet</p>
                <p className="text-xs text-muted-foreground/60">You&apos;ll be notified of lead assignments and call reminders here.</p>
              </div>
            ) : (
              notifications.slice(0, PREVIEW_COUNT).map((n) => {
                const { Icon, color } = TYPE_META[n.type] ?? TYPE_META.LEAD_ASSIGNED;
                const target = notificationTarget(n);
                return (
                  <button
                    key={n.id}
                    onClick={() => {
                      markRead(n.id);
                      setOpen(false);
                      if (target) router.push(target.href);
                    }}
                    className={cn(
                      'flex w-full items-start gap-3 px-4 py-2.5 text-left transition-colors hover:bg-muted/60',
                      !n.read && 'bg-primary/[0.04]',
                      target && 'cursor-pointer',
                    )}
                  >
                    <div className={cn('mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full', color)}>
                      <Icon className="h-3.5 w-3.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      {/* Title and time on one line, so every row is the same
                          height regardless of how long the message is. */}
                      <div className="flex items-baseline justify-between gap-2">
                        <p className={cn('truncate text-[13px] leading-snug', !n.read ? 'font-semibold text-foreground' : 'font-medium text-foreground/80')}>
                          {n.title}
                        </p>
                        <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/60">{timeAgo(n.createdAt)}</span>
                      </div>
                      {/* Clamped to two lines — an unclamped body was what made
                          rows tall enough to overflow the panel. */}
                      <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{n.body}</p>
                      {target && (
                        <span className="mt-1 inline-block text-[10px] font-medium text-primary">{target.label} →</span>
                      )}
                    </div>
                    {!n.read && (
                      <div className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" aria-label="Unread" />
                    )}
                  </button>
                );
              })
            )}
          </div>

          {/* Footer — shrink-0 so it stays pinned while the list scrolls */}
          {notifications.length > 0 && (
            <div className="shrink-0 border-t border-border bg-background">
              <Link
                href="/dashboard/notifications"
                onClick={() => setOpen(false)}
                className="flex w-full items-center justify-center gap-1.5 py-2.5 text-xs font-medium text-primary transition-colors hover:bg-muted/50"
              >
                {notifications.length > PREVIEW_COUNT
                  ? `See all notifications (${notifications.length})`
                  : 'See all notifications'}
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
