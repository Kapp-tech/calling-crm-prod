'use client';

import { useQuery } from '@tanstack/react-query';
import { Loader2, PhoneMissed, Info, Clock, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PaginationBar } from '@/components/shared/pagination-bar';

/**
 * Calls the lead made to us that nobody answered.
 *
 * Sits behind the Missed tab on Scheduled/Missed Calls. The rows come from the
 * dialer's own record (CallLog, `term_reason: ABANDON`) rather than anything
 * the CRM writes, so what is listed here is what actually rang.
 */

interface MissedCall {
  id: string;
  phoneNumber: string;
  phoneCode: string | null;
  agentSeat: string | null;
  startedAt: string | null;
  endedAt: string | null;
  ringTimeSeconds: number | null;
  calledCount: number | null;
  agent: { id: string; name: string } | null;
  lead: {
    id: string; name: string; email: string; phone: string;
    city: string | null; state: string | null; course: string | null; college: string | null;
    assignedTo: { id: string; name: string } | null;
    feedbacks: { followUpNumber: number; feedbackOption: { label: string } | null }[];
  } | null;
}

interface Response {
  calls: MissedCall[];
  total: number; page: number; limit: number; totalPages: number;
  counts: { today: number; unmatched: number };
}

/** IST, because every other time in this CRM is. */
function istDateTime(iso: string | null): { date: string; time: string } {
  if (!iso) return { date: '—', time: '' };
  const d = new Date(iso);
  return {
    date: d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }),
    time: d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }),
  };
}

/** How long it rang before they gave up — the closest thing to "how keen". */
function ringLabel(seconds: number | null): string {
  if (seconds === null || seconds === undefined) return '—';
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export function MissedCallsTable({
  page,
  limit,
  onPageChange,
  onLimitChange,
  onLeadClick,
}: {
  page: number;
  limit: number;
  onPageChange: (p: number) => void;
  onLimitChange: (l: number) => void;
  onLeadClick: (leadId: string) => void;
}) {
  const { data, isLoading, isFetching } = useQuery<Response>({
    queryKey: ['missed-calls', page, limit],
    queryFn: () => fetch(`/api/leads/missed-calls?page=${page}&limit=${limit}`).then((r) => r.json()),
    placeholderData: (prev) => prev,
  });

  const calls = data?.calls ?? [];

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-xs text-muted-foreground">
          <strong className="text-foreground">{(data?.total ?? 0).toLocaleString('en-IN')}</strong> missed
          {data?.counts.today ? <> · <strong className="text-foreground">{data.counts.today}</strong> today</> : null}
          {isFetching && !isLoading && <Loader2 className="ml-2 inline h-3 w-3 animate-spin" />}
        </p>
        {/* Surfaced rather than hidden: someone rang and got nothing back, and
            nobody owns the follow-up if the number matches no lead. */}
        {(data?.counts.unmatched ?? 0) > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-400">
            <Info className="h-3 w-3" />
            {data!.counts.unmatched} from a number that matches no lead
          </span>
        )}
      </div>

      <div className="overflow-x-auto rounded-xl border border-border/60">
        <table className="w-full min-w-[900px] text-xs">
          <thead className="bg-muted/60">
            <tr>
              {['Lead', 'Number that called', 'Missed at', 'Rang for', 'Attempts', 'Agent', 'Latest feedback'].map((h, i) => (
                <th
                  key={h}
                  className={cn(
                    'whitespace-nowrap px-3 py-2.5 font-semibold text-muted-foreground',
                    i >= 2 && i <= 4 ? 'text-center' : 'text-left',
                  )}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {calls.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-14 text-center">
                  <PhoneMissed className="mx-auto mb-2 h-6 w-6 text-muted-foreground/50" />
                  <p className="text-sm font-medium">No missed calls</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    A call shows here when the dialer reports the caller hung up before anyone answered.
                  </p>
                </td>
              </tr>
            ) : (
              calls.map((c) => {
                const when = istDateTime(c.startedAt);
                const latest = c.lead?.feedbacks?.[0];
                return (
                  <tr key={c.id} className="border-t border-border/50 hover:bg-muted/30">
                    <td className="px-3 py-2.5">
                      {c.lead ? (
                        <button
                          onClick={() => onLeadClick(c.lead!.id)}
                          className="text-left font-medium text-primary hover:underline"
                        >
                          {c.lead.name}
                        </button>
                      ) : (
                        <span className="text-muted-foreground">Not in the CRM</span>
                      )}
                      {c.lead && (
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          {[c.lead.course, c.lead.city].filter(Boolean).join(' · ') || '—'}
                        </p>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 font-mono text-[11px]">
                      {c.phoneCode ? `+${c.phoneCode} ` : ''}{c.phoneNumber}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-center">
                      <span className="font-medium">{when.date}</span>
                      <span className="ml-1.5 text-muted-foreground">{when.time}</span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-center text-muted-foreground">
                      <Clock className="mr-1 inline h-3 w-3" />{ringLabel(c.ringTimeSeconds)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-center text-muted-foreground">
                      {c.calledCount ? <><RotateCcw className="mr-1 inline h-3 w-3" />{c.calledCount}</> : '—'}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5">
                      {c.agent?.name
                        ?? (c.agentSeat
                          // The seat is shown when it maps to no CRM user, so the
                          // gap is visible and fixable rather than silent.
                          ? <span className="text-amber-600 dark:text-amber-400" title="This dialer seat is not linked to a CRM user">
                              seat {c.agentSeat}
                            </span>
                          : <span className="text-muted-foreground">—</span>)}
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground">
                      {latest?.feedbackOption?.label
                        ? <>{latest.feedbackOption.label} <span className="text-[10px]">#{latest.followUpNumber}</span></>
                        : 'Never followed up'}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {(data?.totalPages ?? 0) > 1 && (
        <PaginationBar
          page={page}
          totalPages={data!.totalPages}
          total={data!.total}
          limit={limit}
          onPageChange={onPageChange}
          onLimitChange={onLimitChange}
        />
      )}
    </div>
  );
}
