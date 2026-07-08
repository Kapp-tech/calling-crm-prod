'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { Bell, UserPlus, CalendarClock, PhoneCall, CheckCheck, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface NotificationItem {
  id: string;
  type: 'LEAD_ASSIGNED' | 'CALL_REMINDER' | 'CALL_NOW';
  title: string;
  body: string;
  leadId?: string | null;
  read: boolean;
  createdAt: string;
}

interface NotificationsPage {
  items: NotificationItem[];
  nextCursor: string | null;
}

const TYPE_META = {
  LEAD_ASSIGNED: { Icon: UserPlus,      color: 'bg-blue-100 text-blue-600 dark:bg-blue-950 dark:text-blue-400',   label: 'Lead Assigned' },
  CALL_REMINDER: { Icon: CalendarClock, color: 'bg-amber-100 text-amber-600 dark:bg-amber-950 dark:text-amber-400', label: 'Call Reminder' },
  CALL_NOW:      { Icon: PhoneCall,     color: 'bg-green-100 text-green-600 dark:bg-green-950 dark:text-green-400', label: 'Call Now' },
} as const;

function formatDate(iso: string): string {
  const d    = new Date(iso);
  const now  = new Date();
  const diff = now.getTime() - d.getTime();
  const m    = Math.floor(diff / 60_000);
  if (m < 1)   return 'Just now';
  if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h ago`;
  if (h < 48)  return `Yesterday at ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) +
    ' · ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function groupByDay(items: NotificationItem[]): { label: string; items: NotificationItem[] }[] {
  const today     = new Date().toDateString();
  const yesterday = new Date(Date.now() - 86_400_000).toDateString();
  const groups: Record<string, NotificationItem[]> = {};

  for (const n of items) {
    const day = new Date(n.createdAt).toDateString();
    const key = day === today ? 'Today' : day === yesterday ? 'Yesterday' : new Date(n.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    if (!groups[key]) groups[key] = [];
    groups[key].push(n);
  }

  return Object.entries(groups).map(([label, items]) => ({ label, items }));
}

export default function NotificationsPage() {
  const qc          = useQueryClient();
  const router      = useRouter();
  const sentinelRef = useRef<HTMLDivElement>(null);

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
  } = useInfiniteQuery<NotificationsPage>({
    queryKey: ['notifications-all'],
    queryFn: ({ pageParam }) => {
      const url = pageParam
        ? `/api/notifications/all?cursor=${pageParam}`
        : '/api/notifications/all';
      return fetch(url).then((r) => r.json());
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  // IntersectionObserver — fires fetchNextPage when sentinel scrolls into view
  const onIntersect = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
        fetchNextPage();
      }
    },
    [hasNextPage, isFetchingNextPage, fetchNextPage],
  );

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(onIntersect, { threshold: 0.1 });
    observer.observe(el);
    return () => observer.disconnect();
  }, [onIntersect]);

  async function markAllRead() {
    await fetch('/api/notifications', { method: 'PATCH' });
    qc.setQueryData<{ pages: NotificationsPage[]; pageParams: unknown[] }>(['notifications-all'], (old) => {
      if (!old) return old;
      return {
        ...old,
        pages: old.pages.map((page) => ({
          ...page,
          items: page.items.map((n) => ({ ...n, read: true })),
        })),
      };
    });
    qc.setQueryData<NotificationItem[]>(['notifications'], (old) =>
      (old ?? []).map((n) => ({ ...n, read: true }))
    );
  }

  async function markRead(id: string) {
    // Optimistic update in both caches
    const patch = (n: NotificationItem) => (n.id === id ? { ...n, read: true } : n);
    qc.setQueryData<{ pages: NotificationsPage[]; pageParams: unknown[] }>(['notifications-all'], (old) => {
      if (!old) return old;
      return { ...old, pages: old.pages.map((p) => ({ ...p, items: p.items.map(patch) })) };
    });
    qc.setQueryData<NotificationItem[]>(['notifications'], (old) => (old ?? []).map(patch));
    await fetch(`/api/notifications/${id}`, { method: 'PATCH' });
  }

  const allItems   = data?.pages.flatMap((p) => p.items) ?? [];
  const totalCount = allItems.length;
  const unread     = allItems.filter((n) => !n.read).length;
  const groups     = groupByDay(allItems);

  return (
    <div className="mx-auto max-w-2xl space-y-4">

      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Notifications</h1>
          {!isLoading && totalCount > 0 && (
            <p className="mt-0.5 text-sm text-muted-foreground">
              {totalCount} notification{totalCount !== 1 ? 's' : ''}
              {unread > 0 && <span className="ml-1 text-primary font-medium">· {unread} unread</span>}
            </p>
          )}
        </div>
        {unread > 0 && (
          <button
            onClick={markAllRead}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
          >
            <CheckCheck className="h-4 w-4" /> Mark all read
          </button>
        )}
      </div>

      {/* List */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        {isLoading ? (
          /* Skeleton */
          <div className="divide-y divide-border/50">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-start gap-3 px-5 py-4">
                <div className="h-9 w-9 shrink-0 rounded-full bg-muted animate-pulse" />
                <div className="flex-1 space-y-2 py-0.5">
                  <div className="h-3.5 w-40 rounded bg-muted animate-pulse" />
                  <div className="h-3 w-64 rounded bg-muted animate-pulse" />
                  <div className="h-2.5 w-20 rounded bg-muted animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        ) : allItems.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <Bell className="h-12 w-12 text-muted-foreground/20" />
            <p className="font-medium text-muted-foreground">No notifications yet</p>
            <p className="text-sm text-muted-foreground/60">Lead assignments and call reminders will appear here.</p>
          </div>
        ) : (
          <div className="divide-y divide-border/40">
            {groups.map(({ label, items }) => (
              <div key={label}>
                {/* Day label */}
                <div className="sticky top-0 z-10 bg-muted/60 px-5 py-1.5 backdrop-blur-sm">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
                </div>

                {/* Items */}
                {items.map((n) => {
                  const { Icon, color } = TYPE_META[n.type] ?? TYPE_META.LEAD_ASSIGNED;
                  const isLeadAssigned = n.type === 'LEAD_ASSIGNED';
                  return (
                    <button
                      key={n.id}
                      onClick={() => {
                        markRead(n.id);
                        if (isLeadAssigned) router.push(`/dashboard/notifications/${n.id}/leads`);
                      }}
                      className={cn(
                        'flex w-full items-start gap-3.5 px-5 py-4 text-left transition-colors hover:bg-muted/40',
                        !n.read && 'bg-primary/[0.03]',
                        isLeadAssigned && 'cursor-pointer',
                      )}
                    >
                      {/* Icon */}
                      <div className={cn('mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full', color)}>
                        <Icon className="h-4 w-4" />
                      </div>

                      {/* Content */}
                      <div className="min-w-0 flex-1">
                        <p className={cn('text-sm leading-snug', !n.read ? 'font-semibold text-foreground' : 'font-medium text-foreground/80')}>
                          {n.title}
                        </p>
                        <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">{n.body}</p>
                        <div className="mt-1.5 flex items-center gap-2">
                          <p className="text-xs text-muted-foreground/60">{formatDate(n.createdAt)}</p>
                          {isLeadAssigned && (
                            <span className="text-xs font-medium text-primary">View leads →</span>
                          )}
                        </div>
                      </div>

                      {/* Unread dot */}
                      {!n.read && (
                        <div className="mt-2 h-2 w-2 shrink-0 rounded-full bg-primary" />
                      )}
                    </button>
                  );
                })}
              </div>
            ))}

            {/* Lazy-load sentinel + spinner */}
            <div ref={sentinelRef} className="flex justify-center py-5">
              {isFetchingNextPage ? (
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              ) : hasNextPage ? (
                <span className="text-xs text-muted-foreground/60">Scroll to load more</span>
              ) : (
                totalCount > 0 && (
                  <span className="text-xs text-muted-foreground/40">All notifications loaded</span>
                )
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
