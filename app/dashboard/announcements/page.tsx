'use client';

import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import {
  Loader2, Megaphone, AlertOctagon, AlertTriangle, Info, Minus,
  CalendarDays, ChevronDown, ChevronUp, Pin,
} from 'lucide-react';
import { markAllAnnouncementsRead } from '@/lib/hooks/use-unread-announcements';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function timeAgo(iso: string) {
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60)     return 'just now';
  if (secs < 3600)   return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400)  return `${Math.floor(secs / 3600)}h ago`;
  if (secs < 604800) return `${Math.floor(secs / 86400)}d ago`;
  return fmtDate(iso);
}

function initials(name: string) {
  return name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);
}

// ─── Types ────────────────────────────────────────────────────────────────────

type Priority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';

interface Announcement {
  id: string;
  title: string;
  content: string;
  priority: Priority;
  isActive: boolean;
  createdAt: string;
  author: { id: string; name: string };
}

// ─── Priority Config ──────────────────────────────────────────────────────────

const PRIORITY_CONFIG: Record<Priority, {
  label: string;
  badgeClass: string;
  borderClass: string;
  bgClass: string;
  iconClass: string;
  Icon: React.ComponentType<{ className?: string }>;
}> = {
  URGENT: {
    label: 'Urgent',
    badgeClass: 'bg-red-500/15 text-red-400 border-red-500/30',
    borderClass: 'border-l-red-500',
    bgClass: 'bg-red-500/5',
    iconClass: 'text-red-500',
    Icon: AlertOctagon,
  },
  HIGH: {
    label: 'High',
    badgeClass: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
    borderClass: 'border-l-orange-500',
    bgClass: 'bg-orange-500/5',
    iconClass: 'text-orange-400',
    Icon: AlertTriangle,
  },
  NORMAL: {
    label: 'Normal',
    badgeClass: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
    borderClass: 'border-l-blue-500',
    bgClass: 'bg-card',
    iconClass: 'text-blue-400',
    Icon: Info,
  },
  LOW: {
    label: 'Low',
    badgeClass: 'bg-slate-500/15 text-slate-400 border-slate-500/30',
    borderClass: 'border-l-slate-500',
    bgClass: 'bg-card',
    iconClass: 'text-slate-400',
    Icon: Minus,
  },
};

// ─── Card ─────────────────────────────────────────────────────────────────────

function AnnouncementCard({ a, pinned }: { a: Announcement; pinned?: boolean }) {
  const [expanded, setExpanded] = useState(pinned ?? false);
  const pc = PRIORITY_CONFIG[a.priority];
  const PriorityIcon = pc.Icon;
  const isLong = a.content.length > 220;

  return (
    <div
      className={`
        rounded-xl border border-l-4 ${pc.borderClass} ${pc.bgClass}
        shadow-sm transition-all duration-200 hover:shadow-md
        ${pinned ? 'ring-1 ring-red-500/20' : ''}
      `}
    >
      <div className="p-4">
        {/* Top: icon + priority badge + pinned label */}
        <div className="flex items-start gap-3">
          <div className={`mt-0.5 shrink-0 ${pc.iconClass}`}>
            <PriorityIcon className="h-4 w-4" />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <Badge variant="outline" className={`text-xs font-semibold px-2 py-0.5 ${pc.badgeClass}`}>
                {pc.label}
              </Badge>
              {pinned && (
                <span className="flex items-center gap-1 text-xs font-medium text-red-400">
                  <Pin className="h-3 w-3 fill-red-400" /> Pinned
                </span>
              )}
            </div>

            {/* Title */}
            <h3 className={`font-semibold leading-snug mb-2 ${pinned ? 'text-base' : 'text-sm'}`}>
              {a.title}
            </h3>

            {/* Content */}
            <p className={`text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed ${!expanded && isLong ? 'line-clamp-3' : ''}`}>
              {a.content}
            </p>
            {isLong && (
              <button
                onClick={() => setExpanded(!expanded)}
                className="mt-1.5 flex items-center gap-0.5 text-xs text-primary hover:underline font-medium"
              >
                {expanded
                  ? <><ChevronUp className="h-3 w-3" /> Show less</>
                  : <><ChevronDown className="h-3 w-3" /> Read more</>}
              </button>
            )}

            {/* Footer */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 pt-3 border-t border-border/50">
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <div className="flex h-5 w-5 items-center justify-center rounded-full bg-muted text-[9px] font-bold">
                  {initials(a.author.name)}
                </div>
                {a.author.name}
              </span>
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <CalendarDays className="h-3 w-3" /> {fmtDate(a.createdAt)}
              </span>
              <span className="text-xs text-muted-foreground/60">{timeAgo(a.createdAt)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AnnouncementsPage() {
  const { data: announcements = [], isLoading } = useQuery<Announcement[]>({
    queryKey: ['announcements'],
    queryFn: () =>
      fetch('/api/announcements').then((r) => r.json()).then((d) => Array.isArray(d) ? d : []),
    refetchInterval: 60_000,
  });

  // Mark all as read when announcements are loaded
  useEffect(() => {
    if (announcements.length > 0) {
      markAllAnnouncementsRead(announcements.map((a) => a.id));
    }
  }, [announcements]);

  const urgent = announcements.filter((a) => a.priority === 'URGENT');
  const rest   = announcements.filter((a) => a.priority !== 'URGENT');

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-6">

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
            <Megaphone className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h2 className="text-lg font-semibold leading-tight">Announcements</h2>
            <p className="text-xs text-muted-foreground">Messages from your Super Admin</p>
          </div>
        </div>
        {!isLoading && announcements.length > 0 && (
          <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
            {announcements.length} {announcements.length === 1 ? 'message' : 'messages'}
          </span>
        )}
      </div>

      {/* ── Content ── */}
      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-24 gap-3 text-muted-foreground">
          <Loader2 className="h-7 w-7 animate-spin" />
          <p className="text-sm">Loading announcements…</p>
        </div>
      ) : announcements.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-24 gap-4 text-muted-foreground">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
            <Megaphone className="h-8 w-8 opacity-30" />
          </div>
          <div className="text-center">
            <p className="text-sm font-medium">No announcements</p>
            <p className="text-xs text-muted-foreground mt-1">Check back later for updates from your admin.</p>
          </div>
        </div>
      ) : (
        <div className="space-y-6">

          {/* Urgent pinned section */}
          {urgent.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <AlertOctagon className="h-4 w-4 text-red-500" />
                <h3 className="text-sm font-semibold text-red-400 uppercase tracking-wide">
                  Urgent
                </h3>
                <div className="flex-1 h-px bg-red-500/20" />
                <span className="text-xs text-red-400/70">{urgent.length}</span>
              </div>
              <div className="space-y-3">
                {urgent.map((a) => (
                  <AnnouncementCard key={a.id} a={a} pinned />
                ))}
              </div>
            </div>
          )}

          {/* Remaining announcements */}
          {rest.length > 0 && (
            <div className="space-y-3">
              {urgent.length > 0 && (
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                    Other
                  </h3>
                  <div className="flex-1 h-px bg-border" />
                  <span className="text-xs text-muted-foreground/60">{rest.length}</span>
                </div>
              )}
              <div className="space-y-3">
                {rest.map((a) => (
                  <AnnouncementCard key={a.id} a={a} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
