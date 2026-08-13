'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  UserPlus, Loader2, AlertTriangle, Users, Headphones, UserCheck,
  BarChart3, Activity, GitBranch, ChevronDown, ChevronUp,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { useToast } from '@/components/ui/use-toast';
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
  isActive: boolean;
  teamLeadId: string | null;
  teamLead: { id: string; name: string; email: string; phone?: string | null; employeeCode: string } | null;
  members: TeamAgent[];
  _count: { members: number; leads: number };
}

const agentSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Invalid email address'),
  phone: z.string().optional(),
});
type AgentForm = z.infer<typeof agentSchema>;

// ─── Tree nodes ────────────────────────────────────────────────────────────────

function TLNode({
  tl, agentCount, totalLeads, sessionName,
}: {
  tl: TeamDetail['teamLead'];
  agentCount: number;
  totalLeads: number;
  sessionName?: string;
}) {
  const name = tl?.name ?? sessionName ?? 'Team Lead';
  const email = tl?.email ?? '';
  const employeeCode = tl?.employeeCode ?? '';
  const initials = name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);

  return (
    <div className="relative w-56 shrink-0">
      {/* Role chip */}
      <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 z-10">
        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-card px-2.5 py-0.5 text-[11px] font-semibold text-emerald-500 shadow-sm whitespace-nowrap">
          <UserCheck className="h-3 w-3" /> Team Lead
        </span>
      </div>

      {/* Card */}
      <div className="rounded-2xl border-2 border-emerald-500/30 bg-emerald-500/10 px-5 py-4 shadow-lg pt-5">
        {/* Avatar + identity */}
        <div className="flex flex-col items-center text-center gap-2 mb-4">
          <div className="relative">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-600 text-white font-bold text-lg shadow-md">
              {initials}
            </div>
            <span className="absolute -bottom-1 -right-1 h-3.5 w-3.5 rounded-full border-2 border-card bg-emerald-500" />
          </div>
          <div>
            <p className="font-bold text-sm leading-tight">{name}</p>
            {employeeCode && (
              <p className="text-[10px] font-mono text-muted-foreground mt-0.5">{employeeCode}</p>
            )}
            {email && (
              <p className="text-[10px] text-muted-foreground truncate max-w-[180px] mt-0.5">{email}</p>
            )}
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl bg-background/60 border border-emerald-500/20 p-2 text-center shadow-sm">
            <p className="text-lg font-bold text-emerald-500 leading-none">{agentCount}</p>
            <p className="text-[9px] text-muted-foreground mt-0.5 uppercase tracking-wide">Agents</p>
          </div>
          <div className="rounded-xl bg-background/60 border border-emerald-500/20 p-2 text-center shadow-sm">
            <p className="text-lg font-bold text-emerald-500 leading-none">{totalLeads}</p>
            <p className="text-[9px] text-muted-foreground mt-0.5 uppercase tracking-wide">Leads</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function AgentNode({ agent }: { agent: TeamAgent }) {
  const initials = agent.name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);
  const isPending = agent.status === 'PENDING_APPROVAL';
  const isActive = agent.isActive && !isPending;

  return (
    <div
      className={cn(
        'relative w-44 shrink-0 rounded-xl border bg-card px-3.5 py-3 shadow-sm transition-all duration-150 hover:shadow-md hover:-translate-y-0.5',
        isPending ? 'border-amber-500/30 bg-amber-500/5' : 'border-border',
        !isActive && !isPending && 'opacity-55',
      )}
    >
      {/* Status badge for pending */}
      {isPending && (
        <div className="absolute -top-2.5 left-1/2 -translate-x-1/2">
          <span className="inline-block rounded-full bg-amber-500/15 border border-amber-500/30 px-2 py-px text-[9px] font-semibold text-amber-500">
            Pending
          </span>
        </div>
      )}

      {/* Avatar + name */}
      <div className="flex flex-col items-center text-center gap-1.5 mb-3">
        <div className="relative">
          <div
            className={cn(
              'flex h-10 w-10 items-center justify-center rounded-xl font-bold text-xs shadow-sm',
              isPending ? 'bg-amber-500/15 text-amber-500' : 'bg-rose-500/15 text-rose-500',
            )}
          >
            {initials}
          </div>
          <span
            className={cn(
              'absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-card',
              isActive ? 'bg-green-500' : isPending ? 'bg-amber-400' : 'bg-muted-foreground/40',
            )}
          />
        </div>
        <div>
          <p className="font-semibold text-xs leading-tight truncate max-w-[140px]">{agent.name}</p>
          <p className="text-[9px] font-mono text-muted-foreground">{agent.employeeCode}</p>
        </div>
      </div>

      {/* Stats */}
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

// ─── Hierarchy Tree ────────────────────────────────────────────────────────────

function TeamHierarchyTree({
  team, agents, sessionName,
}: {
  team: TeamDetail;
  agents: TeamAgent[];
  sessionName?: string;
}) {
  const N = agents.length;
  // Summed from the same per-agent counts the child nodes render, so the TL
  // node can never contradict the agents beneath it.
  const totalLeads = agents.reduce((s, a) => s + a._count.assignedLeads, 0);

  return (
    <div className="overflow-x-auto">
      <div
        className="flex flex-col items-center pb-8 pt-6 px-8"
        style={{ minWidth: Math.max(300, N * 196 + 64) }}
      >
        {/* TL node */}
        <TLNode
          tl={team.teamLead}
          agentCount={N}
          totalLeads={totalLeads}
          sessionName={sessionName}
        />

        {N === 0 ? (
          <div className="mt-10 flex flex-col items-center gap-3 text-muted-foreground">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
              <Users className="h-6 w-6 opacity-40" />
            </div>
            <p className="text-sm font-medium">No agents in this team yet.</p>
            <p className="text-xs">Click &quot;Request Agent&quot; to add one.</p>
          </div>
        ) : (
          <>
            {/* Vertical stem from TL */}
            <div className="w-px bg-gradient-to-b from-emerald-500/50 to-border" style={{ height: 40 }} />

            {/* Horizontal connector + agent drops */}
            <div className="relative w-full flex flex-col">
              {/* Horizontal bar */}
              {N > 1 && (
                <div
                  className="absolute top-0 h-px bg-border"
                  style={{
                    left: `${100 / (2 * N)}%`,
                    right: `${100 / (2 * N)}%`,
                  }}
                />
              )}

              {/* Agent columns */}
              <div className="flex w-full">
                {agents.map((agent) => (
                  <div key={agent.id} className="flex-1 flex flex-col items-center">
                    {/* Vertical drop per agent */}
                    <div className="w-px h-10 bg-border" />
                    <AgentNode agent={agent} />
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

// ─── Main page ────────────────────────────────────────────────────────────────

export default function TLTeamPage() {
  const { data: session } = useSession();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showAddAgent, setShowAddAgent] = useState(false);
  const [showChart, setShowChart] = useState(false);
  const [createdAgent, setCreatedAgent] = useState<{
    name: string; email: string; employeeCode: string; status: string;
  } | null>(null);

  const { data: teamList = [], isLoading: loadingList } = useQuery<TeamDetail[]>({
    queryKey: ['my-team-list'],
    queryFn: () => fetch('/api/teams?myTeam=true').then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    }),
    enabled: !!session?.user?.id,
  });

  const teamId = teamList[0]?.id;

  const { data: team, isLoading: loadingDetail, isError } = useQuery<TeamDetail>({
    queryKey: ['my-team-detail', teamId],
    queryFn: () => fetch(`/api/teams/${teamId}`).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    }),
    enabled: !!teamId,
  });

  const isLoading = loadingList || loadingDetail;

  const { register, handleSubmit, reset, formState: { errors } } = useForm<AgentForm>({
    resolver: zodResolver(agentSchema),
  });

  const addAgentMutation = useMutation({
    mutationFn: (data: AgentForm) =>
      fetch(`/api/teams/${team!.id}/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }).then(async (r) => {
        const json = await r.json();
        if (!json.success && json.success !== undefined) throw new Error(json.error ?? 'Failed');
        return json;
      }),
    onSuccess: (data) => {
      setCreatedAgent({ name: data.name, email: data.email, employeeCode: data.employeeCode, status: data.status });
      qc.invalidateQueries({ queryKey: ['my-team-detail'] });
      reset();
    },
    onError: (err: Error) => {
      toast({ variant: 'destructive', title: 'Error', description: err.message });
    },
  });

  const agents = team?.members ?? [];
  const activeAgents = agents.filter((a) => a.isActive && a.status !== 'PENDING_APPROVAL');
  const pendingAgents = agents.filter((a) => a.status === 'PENDING_APPROVAL');
  const totalCalls = agents.reduce((s, a) => s + a._count.feedbacks, 0);
  // Summed per agent rather than read off team._count.leads (which counts by
  // Lead.teamId). The per-agent numbers are what the tree nodes below show, so
  // deriving the headline from the same source keeps them from contradicting
  // each other if any lead's team stamp is ever out of step.
  const totalLeads = agents.reduce((s, a) => s + a._count.assignedLeads, 0);

  const chartData = agents.map((a) => ({
    name: a.name.split(' ')[0],
    Leads: a._count.assignedLeads,
    Calls: a._count.feedbacks,
  }));

  // ── Render ──────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!team && !isLoading) {
    return (
      <Card>
        <CardContent className="py-16 flex flex-col items-center gap-3 text-center text-muted-foreground">
          <Users className="h-10 w-10 opacity-30" />
          <p className="font-medium">You are not assigned to any team yet.</p>
          <p className="text-sm">Contact your Super Admin to be assigned a team.</p>
        </CardContent>
      </Card>
    );
  }

  if (isError || !team) {
    return (
      <Card className="border-destructive/50">
        <CardContent className="py-12 text-center text-destructive">
          Failed to load team data. Please refresh the page.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <GitBranch className="h-5 w-5 text-emerald-600" />
            {team.name}
          </h2>
          {team.description && (
            <p className="text-sm text-muted-foreground mt-0.5">{team.description}</p>
          )}
        </div>
        <Button onClick={() => { setCreatedAgent(null); setShowAddAgent(true); }}>
          <UserPlus className="mr-2 h-4 w-4" /> Request Agent
        </Button>
      </div>

      {/* ── Quick stat pills ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatPill label="Active Agents" value={activeAgents.length} color="emerald" />
        <StatPill label="Total Leads" value={totalLeads} color="indigo" />
        <StatPill label="Total Calls" value={totalCalls} color="teal" />
        <StatPill label="Pending Approval" value={pendingAgents.length} color={pendingAgents.length > 0 ? 'amber' : 'slate'} />
      </div>

      {/* ── Hierarchy Tree ── */}
      <Card className="overflow-hidden">
        <CardHeader className="flex flex-row items-center justify-between py-3 px-5 border-b">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-emerald-600" />
            Team Hierarchy
          </CardTitle>
          <span className="text-xs text-muted-foreground">
            {agents.length} member{agents.length !== 1 ? 's' : ''}
          </span>
        </CardHeader>
        <CardContent className="p-0 bg-muted/20">
          <TeamHierarchyTree
            team={team}
            agents={agents}
            sessionName={session?.user?.name ?? undefined}
          />
        </CardContent>
      </Card>

      {/* ── Agent Load Chart (collapsible) ── */}
      {chartData.length > 0 && (
        <Card>
          <button
            className="flex w-full items-center justify-between px-5 py-3 text-left"
            onClick={() => setShowChart((v) => !v)}
          >
            <span className="text-sm font-semibold flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-indigo-500" />
              Agent Load Comparison
            </span>
            {showChart
              ? <ChevronUp className="h-4 w-4 text-muted-foreground" />
              : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
          </button>
          {showChart && (
            <CardContent className="pt-0">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={chartData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} cursor={{ fill: 'hsl(var(--muted))' }} />
                  <Bar dataKey="Leads" fill="#6366f1" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Calls" fill="#10b981" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
              <div className="flex gap-4 mt-1 justify-center text-xs text-muted-foreground">
                <span className="flex items-center gap-1"><span className="inline-block h-2 w-3 rounded-sm bg-indigo-500" /> Leads</span>
                <span className="flex items-center gap-1"><span className="inline-block h-2 w-3 rounded-sm bg-emerald-500" /> Calls</span>
              </div>
            </CardContent>
          )}
        </Card>
      )}

      {/* ── Request Agent Dialog ── */}
      <Dialog open={showAddAgent} onOpenChange={(v) => { setShowAddAgent(v); if (!v) { setCreatedAgent(null); reset(); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request New Agent</DialogTitle>
          </DialogHeader>

          {createdAgent ? (
            <div className="space-y-4">
              <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 p-4 text-sm space-y-1">
                <div className="flex items-center gap-2 text-amber-500 font-semibold">
                  <AlertTriangle className="h-4 w-4" /> Awaiting Super Admin Approval
                </div>
                <p className="text-muted-foreground text-xs">
                  The agent will be able to log in only after the Super Admin approves this request.
                </p>
              </div>
              <dl className="space-y-3 text-sm">
                <DlRow label="Name" value={createdAgent.name} />
                <DlRow label="Email" value={createdAgent.email} />
                <DlRow label="Employee Code" value={createdAgent.employeeCode} mono />
              </dl>
              <Button className="w-full" onClick={() => { setShowAddAgent(false); setCreatedAgent(null); }}>
                Done
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit((d) => addAgentMutation.mutate(d))} className="space-y-4">
              <div className="space-y-2">
                <Label>Full Name <span className="text-destructive">*</span></Label>
                <Input {...register('name')} placeholder="e.g. Ravi Sharma" />
                {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
              </div>
              <div className="space-y-2">
                <Label>Email Address <span className="text-destructive">*</span></Label>
                <Input {...register('email')} type="email" placeholder="agent@company.com" />
                {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
              </div>
              <div className="space-y-2">
                <Label>Phone <span className="text-muted-foreground text-xs">(optional)</span></Label>
                <Input {...register('phone')} placeholder="10-digit mobile number" />
              </div>
              <p className="text-xs text-muted-foreground rounded-md bg-muted/40 px-3 py-2">
                This request will be sent to the Super Admin for approval. The agent will receive login credentials only after approval.
              </p>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setShowAddAgent(false)}>Cancel</Button>
                <Button type="submit" disabled={addAgentMutation.isPending}>
                  {addAgentMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Submit Request
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Helper components ─────────────────────────────────────────────────────────

type PillColor = 'emerald' | 'indigo' | 'teal' | 'amber' | 'slate';

const PILL_STYLES: Record<PillColor, string> = {
  emerald: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500',
  indigo:  'border-indigo-500/30  bg-indigo-500/10  text-indigo-400',
  teal:    'border-teal-500/30    bg-teal-500/10    text-teal-400',
  amber:   'border-amber-500/30   bg-amber-500/10   text-amber-500',
  slate:   'border-border         bg-muted/50       text-muted-foreground',
};

function StatPill({ label, value, color }: { label: string; value: number; color: PillColor }) {
  return (
    <div className={cn('rounded-xl border px-4 py-3 text-center', PILL_STYLES[color])}>
      <p className="text-2xl font-bold leading-none">{value}</p>
      <p className="text-[11px] mt-1 opacity-75 font-medium">{label}</p>
    </div>
  );
}

function DlRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={`font-medium text-right ${mono ? 'font-mono' : ''}`}>{value}</dd>
    </div>
  );
}
