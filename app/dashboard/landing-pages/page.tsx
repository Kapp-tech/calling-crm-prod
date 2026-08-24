'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Search, Loader2, Link2, Copy, Check, ExternalLink, Building2,
  Inbox, AlertTriangle, MapPin, Handshake, BadgeCheck,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';

/**
 * Landing Pages — the links counsellors hand to students.
 *
 * Every URL arrives from the server already carrying the reading agent's ID
 * (see app/api/landing-pages/route.ts), so what is on screen is exactly what
 * gets pasted into a WhatsApp message. Copy is therefore the primary action and
 * is one click from anywhere on the card.
 */

interface LandingPage {
  id: string;
  college: string;
  kappCollegeId: string | null;
  zone: string | null;
  dealType: string | null;
  personalised: boolean;
  url: string;
  blocked: boolean;
}

interface LandingPagesResponse {
  agentTag: string | null;
  employeeCode: string | null;
  items: LandingPage[];
}

/** First and last word, so "Goa Institute of Management" reads GM. */
function monogram(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0][0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] ?? '' : '';
  return (first + last).toUpperCase();
}

/**
 * The college's logo, or its initials when the LMS has none.
 *
 * A plain <img> rather than next/image for the same reason as the College
 * Search page: the LMS serves logos from several hosts, each of which would
 * need whitelisting in next.config.js and would break silently when a new one
 * appeared. The tile is white because most logos are transparent PNGs drawn
 * for light backgrounds.
 */
function CollegeMark({ src, name }: { src?: string | null; name: string }) {
  const [failed, setFailed] = useState(false);
  const url = src?.trim();

  if (url && !failed) {
    return (
      <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border/60 bg-white">
        {/* eslint-disable-next-line @next/next/no-img-element -- deliberate; see the note above. */}
        <img
          src={url}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
          className="h-full w-full object-contain p-1"
        />
      </div>
    );
  }

  return (
    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-sm font-bold text-primary">
      {monogram(name)}
    </div>
  );
}

function MetaPill({
  icon: Icon,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
      <Icon className="h-3 w-3" />
      {children}
    </span>
  );
}

function LandingPageCard({ item, logo }: { item: LandingPage; logo?: string }) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(item.url);
      setCopied(true);
      // Long enough to register as feedback, short enough that the button is
      // ready again before the counsellor moves to the next student.
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast({ variant: 'destructive', title: 'Could not copy', description: 'Select the link and copy it manually.' });
    }
  };

  return (
    <div
      className={cn(
        'group relative flex flex-col overflow-hidden rounded-2xl border border-border/60 bg-card p-4 shadow-sm transition-all duration-200 ease-premium',
        'hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5',
      )}
    >
      <div className="flex items-start gap-3">
        <CollegeMark src={logo} name={item.college} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold leading-tight" title={item.college}>
            {item.college}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {item.kappCollegeId && <MetaPill icon={BadgeCheck}>{item.kappCollegeId}</MetaPill>}
            {item.zone && <MetaPill icon={MapPin}>{item.zone}</MetaPill>}
            {item.dealType && <MetaPill icon={Handshake}>{item.dealType}</MetaPill>}
          </div>
        </div>
      </div>

      {/* The exact string that gets pasted. Shown in full rather than truncated:
          a counsellor should be able to see the ID they are sharing.

          flex-1 so a short URL stretches its box instead of leaving a gap —
          that keeps every Copy button on a row at the same height, which is
          what makes the grid read as a grid. */}
      <div className="mt-3.5 flex-1 rounded-xl border border-border/60 bg-muted/40 px-3 py-2.5">
        <p className="break-all font-mono text-[11px] leading-relaxed text-muted-foreground">
          {item.url}
        </p>
      </div>

      {item.blocked ? (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-400">
          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
          <span>
            Your account has no Employee ID, so this link cannot be tagged to you.
            Ask your manager to set one before sharing it.
          </span>
        </div>
      ) : (
        <div className="mt-3 flex items-center gap-2">
          <Button
            onClick={copy}
            size="sm"
            className={cn(
              'flex-1 transition-colors',
              copied && 'bg-emerald-600 hover:bg-emerald-600',
            )}
          >
            {copied ? <Check className="mr-1.5 h-3.5 w-3.5" /> : <Copy className="mr-1.5 h-3.5 w-3.5" />}
            {copied ? 'Copied' : 'Copy link'}
          </Button>
          <Button asChild size="sm" variant="outline" title="Open in a new tab">
            <a href={item.url} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-3.5 w-3.5" />
              <span className="sr-only">Open landing page</span>
            </a>
          </Button>
        </div>
      )}
    </div>
  );
}

export default function LandingPagesPage() {
  const [search, setSearch] = useState('');

  const { data, isLoading, isError } = useQuery<LandingPagesResponse>({
    queryKey: ['landing-pages'],
    queryFn: () => fetch('/api/landing-pages').then((r) => r.json()),
  });

  // Second request on purpose — the links render immediately and the logos drop
  // in when the LMS answers. See app/api/landing-pages/logos/route.ts.
  const { data: logoData } = useQuery<{ logos: Record<string, string> }>({
    queryKey: ['landing-page-logos'],
    queryFn: () => fetch('/api/landing-pages/logos').then((r) => r.json()),
    staleTime: 60 * 60 * 1000,
  });

  const items = useMemo(() => data?.items ?? [], [data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    // Matches the college, its ID, its zone/deal type and the link itself, so
    // searching "2027" finds every campaign for that intake year.
    return items.filter((i) =>
      [i.college, i.kappCollegeId, i.zone, i.dealType, i.url]
        .filter(Boolean)
        .some((f) => String(f).toLowerCase().includes(q)),
    );
  }, [items, search]);

  return (
    <div className="mx-auto max-w-6xl space-y-6 py-2">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 animate-fade-in-up">
        <div className="flex items-start gap-3.5">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-500 to-sky-600 shadow-lg">
            <Link2 className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Landing Pages</h1>
            <p className="mt-1 max-w-xl text-sm text-muted-foreground">
              Application links to share with students. Each one already carries
              your agent ID, so the college knows the applicant came from you.
            </p>
          </div>
        </div>

        {data?.agentTag && (
          <div className="rounded-xl border border-border/60 bg-card px-4 py-2.5 shadow-sm">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Your agent ID
            </p>
            <p className="mt-0.5 font-mono text-lg font-bold leading-none text-primary">
              {data.agentTag}
            </p>
          </div>
        )}
      </div>

      {/* Search */}
      <div className="relative animate-fade-in-up" style={{ animationDelay: '60ms' }}>
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by college, zone, deal type or campaign…"
          className="h-11 pl-9 pr-20"
        />
        {search && (
          <button
            onClick={() => setSearch('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            Clear
          </button>
        )}
      </div>

      {/* Results */}
      {isLoading ? (
        <div className="flex flex-col items-center gap-2 py-20">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          <p className="text-xs text-muted-foreground">Loading your links…</p>
        </div>
      ) : isError ? (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/5 py-14 text-center">
          <p className="text-sm font-medium text-destructive">Could not load the landing pages.</p>
          <p className="mt-1 text-xs text-muted-foreground">Refresh the page to try again.</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-2.5 rounded-2xl border border-border/60 bg-card py-16 text-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-muted">
            <Inbox className="h-5 w-5 text-muted-foreground" />
          </div>
          {items.length === 0 ? (
            <>
              <p className="text-sm font-medium">No landing pages yet</p>
              <p className="max-w-sm text-xs text-muted-foreground">
                A Super Admin adds these under Manage Dropdowns → Colleges, in the
                Landing Page Link field.
              </p>
            </>
          ) : (
            <>
              <p className="text-sm font-medium">No match for “{search}”</p>
              <p className="text-xs text-muted-foreground">
                {items.length} link{items.length === 1 ? '' : 's'} available — try a different search.
              </p>
            </>
          )}
        </div>
      ) : (
        <>
          <p className="text-xs text-muted-foreground animate-fade-in-up" style={{ animationDelay: '90ms' }}>
            Showing <strong className="text-foreground">{filtered.length}</strong>
            {filtered.length !== items.length && ` of ${items.length}`} link
            {items.length === 1 ? '' : 's'}
          </p>
          <div className="grid gap-4 sm:grid-cols-2 animate-fade-in-up" style={{ animationDelay: '120ms' }}>
            {filtered.map((item) => (
              <LandingPageCard
                key={item.id}
                item={item}
                logo={item.kappCollegeId ? logoData?.logos?.[item.kappCollegeId] : undefined}
              />
            ))}
          </div>
        </>
      )}

      {/* A quiet reminder rather than a warning: this is a normal state for a
          college that tracks by campaign only, not something to fix. */}
      {!isLoading && items.some((i) => !i.personalised) && (
        <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Building2 className="h-3 w-3" />
          Some colleges track by campaign rather than by agent — those links are
          the same for everyone.
        </p>
      )}
    </div>
  );
}
