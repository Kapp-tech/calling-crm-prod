'use client';

import { useSession } from 'next-auth/react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Users, GitBranch, Headphones, Activity, UserCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

interface TeamAgent {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  employeeCode: string;
  isActive: boolean;
  status: string;
  _count: { assignedLeads: number; feedbacks: number };
}

interface TeamDetail {
  id: string;
  name: string;
  description?: string | null;
  teamLead: { id: string; name: string; email: string; employeeCode: string } | null;
  members: TeamAgent[];
  _count: { members: number; leads: number };
}

// ─── Node components ──────────────────────────────────────────────────────────

function TLNode({ tl }: { tl: NonNullable<TeamDetail['teamLead']> }) {
  const initials = tl.name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);

  return (
    <div className="relative w-52 shrink-0">
      <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 whitespace-nowrap z-10">
        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-card px-2.5 py-0.5 text-[11px] font-semibold text-emerald-500 shadow-sm">
          <UserCheck className="h-3 w-3" /> Team Lead
        </span>
      </div>
      <div className="rounded-2xl border-2 border-emerald-500/30 bg-emerald-500/10 px-5 py-4 shadow-md pt-5">
        <div className="flex flex-col items-center text-center gap-2">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-600 text-white font-bold text-base shadow-md">
            {initials}
          </div>
          <div>
            <p className="font-bold text-sm leading-tight">{tl.name}</p>
            <p className="text-[10px] font-mono text-muted-foreground mt-0.5">{tl.employeeCode}</p>
            <p className="text-[10px] text-muted-foreground truncate max-w-[170px] mt-0.5">{tl.email}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function AgentNode({ agent, isMe }: { agent: TeamAgent; isMe: boolean }) {
  const initials = agent.name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);
  const isPending = agent.status === 'PENDING_APPROVAL';
  const isActive = agent.isActive && !isPending;

  return (
    <div className={cn(
      'relative w-44 shrink-0 rounded-xl border bg-card px-3.5 py-3 shadow-sm transition-all duration-150',
      isMe ? 'border-primary ring-2 ring-primary ring-offset-1 ring-offset-background shadow-md' : 'border-border hover:shadow-md hover:-translate-y-0.5',
      !isActive && !isPending && 'opacity-55',
      isPending && 'border-amber-500/30 bg-amber-500/5',
    )}>
      {isMe && (
        <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 whitespace-nowrap">
          <span className="inline-block rounded-full bg-primary text-primary-foreground px-2 py-px text-[9px] font-bold shadow-sm">
            You
          </span>
        </div>
      )}
      {isPending && !isMe && (
        <div className="absolute -top-2.5 left-1/2 -translate-x-1/2">
          <span className="inline-block rounded-full bg-amber-500/15 border border-amber-500/30 px-2 py-px text-[9px] font-semibold text-amber-400">
            Pending
          </span>
        </div>
      )}

      <div className="flex flex-col items-center text-center gap-1.5 mb-3">
        <div className="relative">
          <div className={cn(
            'flex h-10 w-10 items-center justify-center rounded-xl font-bold text-xs shadow-sm',
            isMe ? 'bg-primary text-primary-foreground' : isPending ? 'bg-amber-500/15 text-amber-400' : 'bg-rose-500/15 text-rose-400',
          )}>
            {initials}
          </div>
          <span className={cn(
            'absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-card',
            isActive ? 'bg-green-500' : isPending ? 'bg-amber-400' : 'bg-muted-foreground/40',
          )} />
        </div>
        <div>
          <p className="font-semibold text-xs leading-tight truncate max-w-[140px]">{agent.name}</p>
          <p className="text-[9px] font-mono text-muted-foreground">{agent.employeeCode}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-1.5">
        <div className="flex flex-col items-center rounded-lg bg-indigo-500/10 border border-indigo-500/20 py-1.5 px-1">
          <Activity className="h-3 w-3 text-indigo-400 mb-0.5" />
          <p className="text-sm font-bold text-indigo-400 leading-none">{agent._count.assignedLeads}</p>
          <p className="text-[8px] text-muted-foreground mt-0.5 uppercase tracking-wide">Leads</p>
        </div>
        <div className="flex flex-col items-center rounded-lg bg-emerald-500/10 border border-emerald-500/20 py-1.5 px-1">
          <Headphones className="h-3 w-3 text-emerald-400 mb-0.5" />
          <p className="text-sm font-bold text-emerald-400 leading-none">{agent._count.feedbacks}</p>
          <p className="text-[8px] text-muted-foreground mt-0.5 uppercase tracking-wide">Calls</p>
        </div>
      </div>
    </div>
  );
}

// ─── Tree ─────────────────────────────────────────────────────────────────────

function TeamHierarchyTree({
  team, myId,
}: {
  team: TeamDetail;
  myId: string;
}) {
  const agents = team.members;
  const N = agents.length;

  return (
    <div className="overflow-x-auto">
      <div
        className="flex flex-col items-center pb-8 pt-6 px-8"
        style={{ minWidth: Math.max(300, N * 196 + 64) }}
      >
        {team.teamLead && <TLNode tl={team.teamLead} />}

        {N === 0 ? (
          <div className="mt-10 flex flex-col items-center gap-2 text-muted-foreground">
            <Users className="h-8 w-8 opacity-30" />
            <p className="text-sm">No teammates yet.</p>
          </div>
        ) : (
          <>
            <div className="w-px bg-border" style={{ height: 40 }} />
            <div className="relative w-full flex flex-col">
              {N > 1 && (
                <div
                  className="absolute top-0 h-px bg-border"
                  style={{
                    left: `${100 / (2 * N)}%`,
                    right: `${100 / (2 * N)}%`,
                  }}
                />
              )}
              <div className="flex w-full">
                {agents.map((agent) => (
                  <div key={agent.id} className="flex-1 flex flex-col items-center">
                    <div className="w-px h-10 bg-border" />
                    <AgentNode agent={agent} isMe={agent.id === myId} />
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AgentTeamPage() {
  const { data: session } = useSession();
  const myId = session?.user?.id ?? '';

  const { data: team, isLoading, isError } = useQuery<TeamDetail | null>({
    queryKey: ['my-team-mine', myId],
    queryFn: () => fetch('/api/teams/mine').then((r) => r.json()),
    enabled: !!myId,
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError || !team) {
    return (
      <Card>
        <CardContent className="py-16 flex flex-col items-center gap-3 text-center text-muted-foreground">
          <Users className="h-10 w-10 opacity-30" />
          <p className="font-medium">You are not assigned to any team yet.</p>
          <p className="text-sm">Contact your Team Lead or Super Admin.</p>
        </CardContent>
      </Card>
    );
  }

  const agents = team.members;
  const me = agents.find((a) => a.id === myId);
  const myLeads = me?._count.assignedLeads ?? 0;
  const myCalls = me?._count.feedbacks ?? 0;
  const totalLeads = agents.reduce((s, a) => s + a._count.assignedLeads, 0);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold flex items-center gap-2">
          <GitBranch className="h-5 w-5 text-emerald-500" />
          {team.name}
        </h2>
        {team.description && (
          <p className="text-sm text-muted-foreground mt-0.5">{team.description}</p>
        )}
      </div>

      {/* Stats pills */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatPill label="Team Size" value={agents.length} color="emerald" />
        <StatPill label="Team Leads" value={totalLeads} color="indigo" />
        <StatPill label="My Leads" value={myLeads} color="teal" />
        <StatPill label="My Calls" value={myCalls} color="rose" />
      </div>

      {/* Tree */}
      <Card className="overflow-hidden">
        <CardHeader className="flex flex-row items-center justify-between py-3 px-5 border-b">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-emerald-500" />
            Team Hierarchy
          </CardTitle>
          <Badge variant="secondary" className="text-xs">{agents.length} members</Badge>
        </CardHeader>
        <CardContent className="p-0 bg-muted/20">
          <TeamHierarchyTree team={team} myId={myId} />
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

type PillColor = 'emerald' | 'indigo' | 'teal' | 'rose';

const PILL_STYLES: Record<PillColor, string> = {
  emerald: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500',
  indigo:  'border-indigo-500/30  bg-indigo-500/10  text-indigo-500',
  teal:    'border-teal-500/30    bg-teal-500/10    text-teal-500',
  rose:    'border-rose-500/30    bg-rose-500/10    text-rose-500',
};

function StatPill({ label, value, color }: { label: string; value: number; color: PillColor }) {
  return (
    <div className={cn('rounded-xl border px-4 py-3 text-center', PILL_STYLES[color])}>
      <p className="text-2xl font-bold leading-none">{value}</p>
      <p className="text-[11px] mt-1 opacity-75 font-medium">{label}</p>
    </div>
  );
}
