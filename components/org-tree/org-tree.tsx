'use client';

import { useState } from 'react';
import {
  Shield, BarChart2, Upload, UserCheck, Headphones,
  Users, Clock, ChevronDown, ChevronRight,
  Activity, Hash,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

interface OrgUser {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  employeeCode: string;
  isActive: boolean;
  status: string;
  joiningDate?: string;
  role?: string;
  team?: { id: string; name: string } | null;
  _count?: {
    assignedLeads?: number;
    feedbacks?: number;
    uploadBatches?: number;
    assignedByLeads?: number;
  };
}

interface OrgAgent extends OrgUser {
  _count: { assignedLeads: number; feedbacks: number };
}

interface OrgTL extends OrgUser {
  _count: { assignedByLeads: number };
}

interface OrgTeam {
  id: string;
  name: string;
  description?: string | null;
  teamLead: OrgTL | null;
  members: OrgAgent[];
  _count: { leads: number };
}

interface OrgGroup {
  id: string;
  name: string;
  description?: string | null;
  members: OrgUser[];
}

interface HierarchyData {
  sa: OrgUser | null;
  opsGroups: OrgGroup[];
  teams: OrgTeam[];
  pendingAgents: (OrgUser & { manager?: { id: string; name: string } | null })[];
  reports: OrgUser[];
}

interface OrgTreeProps {
  data: HierarchyData;
  onNodeClick?: (user: OrgUser) => void;
  highlightUserId?: string;
}

// ─── Role meta ────────────────────────────────────────────────────────────────

const ROLE_META = {
  SUPER_ADMIN: {
    label: 'Super Admin', icon: Shield,
    bg: 'bg-violet-500/15', text: 'text-violet-400', border: 'border-violet-500/30',
    avatarBg: 'bg-violet-600', chipBg: 'bg-violet-500/10',
    cardBg: 'bg-violet-500/10', cardBorder: 'border-violet-500/30',
  },
  REPORTS: {
    label: 'Reports', icon: BarChart2,
    bg: 'bg-blue-500/15', text: 'text-blue-400', border: 'border-blue-500/30',
    avatarBg: 'bg-blue-600', chipBg: 'bg-blue-500/10',
    cardBg: 'bg-blue-500/10', cardBorder: 'border-blue-500/30',
  },
  OPERATIONS: {
    label: 'Operations', icon: Upload,
    bg: 'bg-amber-500/15', text: 'text-amber-400', border: 'border-amber-500/30',
    avatarBg: 'bg-amber-500', chipBg: 'bg-amber-500/10',
    cardBg: 'bg-amber-500/10', cardBorder: 'border-amber-500/30',
  },
  COUNSELLING_TL: {
    label: 'Team Lead', icon: UserCheck,
    bg: 'bg-emerald-500/15', text: 'text-emerald-400', border: 'border-emerald-500/30',
    avatarBg: 'bg-emerald-600', chipBg: 'bg-emerald-500/10',
    cardBg: 'bg-emerald-500/10', cardBorder: 'border-emerald-500/30',
  },
  COUNSELLING_AGENT: {
    label: 'Agent', icon: Headphones,
    bg: 'bg-rose-500/15', text: 'text-rose-400', border: 'border-rose-500/30',
    avatarBg: 'bg-rose-500', chipBg: 'bg-rose-500/10',
    cardBg: 'bg-rose-500/10', cardBorder: 'border-rose-500/30',
  },
} as const;

type RoleKey = keyof typeof ROLE_META;

// ─── Tree layout helpers ──────────────────────────────────────────────────────

function TreeBranch({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('relative ml-8 mt-2 space-y-2 border-l-2 border-border pl-5', className)}>
      {children}
    </div>
  );
}

function TreeLeaf({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative">
      <div className="absolute -left-5 top-[26px] h-px w-4 bg-border" />
      {children}
    </div>
  );
}

// ─── Root node (SA) ───────────────────────────────────────────────────────────

function RootNode({
  user, onClick,
}: {
  user: OrgUser;
  onClick?: (u: OrgUser) => void;
}) {
  const meta = ROLE_META.SUPER_ADMIN;
  const initials = user.name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);

  return (
    <div
      className={cn(
        'relative flex items-center gap-4 rounded-2xl border-2 p-4 cursor-pointer transition-all hover:shadow-lg',
        meta.cardBg, meta.cardBorder,
      )}
      onClick={() => onClick?.(user)}
    >
      {/* Role badge */}
      <div className="absolute -top-3 left-6">
        <span className={cn(
          'inline-flex items-center gap-1 rounded-full border px-3 py-0.5 text-[11px] font-semibold shadow-sm bg-card',
          meta.border, meta.text,
        )}>
          <meta.icon className="h-3 w-3" /> Root — {meta.label}
        </span>
      </div>

      {/* Avatar */}
      <div className="relative mt-1 shrink-0">
        <div className={cn(
          'flex h-14 w-14 items-center justify-center rounded-2xl text-white font-bold text-lg shadow-md',
          meta.avatarBg,
        )}>
          {initials}
        </div>
        <span className={cn(
          'absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-card',
          user.isActive ? 'bg-green-500' : 'bg-red-400',
        )} />
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0 mt-1">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="font-bold text-base">{user.name}</h3>
          <span className={cn('text-[10px] font-mono rounded px-1.5 py-0.5 border', meta.bg, meta.text, meta.border)}>
            {user.employeeCode}
          </span>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5 truncate">{user.email}</p>
      </div>

      {/* Status */}
      <Badge variant={user.isActive ? 'success' : 'outline'} className="shrink-0">
        {user.isActive ? 'Active' : 'Inactive'}
      </Badge>
    </div>
  );
}

// ─── User node card ───────────────────────────────────────────────────────────

function UserNode({
  user, role, stats, onClick, highlight = false,
}: {
  user: OrgUser;
  role: RoleKey;
  stats?: React.ReactNode;
  onClick?: (u: OrgUser) => void;
  highlight?: boolean;
}) {
  const meta = ROLE_META[role];
  const Icon = meta.icon;
  const initials = user.name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);
  const isPending = user.status === 'PENDING_APPROVAL';

  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-xl border px-3.5 py-2.5 text-sm transition-all cursor-pointer',
        'hover:shadow-md hover:-translate-y-px duration-150',
        isPending
          ? 'border-amber-500/30 bg-amber-500/5'
          : 'bg-card border-border hover:border-border/80',
        !user.isActive && !isPending && 'opacity-55',
        highlight && 'ring-2 ring-primary ring-offset-1',
      )}
      onClick={() => onClick?.(user)}
    >
      {/* Avatar */}
      <div className="relative shrink-0">
        <div className={cn(
          'flex h-9 w-9 items-center justify-center rounded-lg text-[11px] font-bold',
          isPending ? 'bg-amber-500/15 text-amber-400' : `${meta.bg} ${meta.text}`,
        )}>
          {initials}
        </div>
        <span className={cn(
          'absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-card',
          user.isActive && !isPending ? 'bg-green-500' : isPending ? 'bg-amber-400' : 'bg-muted-foreground/40',
        )} />
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="font-semibold text-sm truncate">{user.name}</span>
          {highlight && (
            <span className="text-[9px] font-bold rounded-full bg-primary text-primary-foreground px-1.5 py-0.5">You</span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground">
            <Hash className="h-2.5 w-2.5" />{user.employeeCode}
          </span>
          <span className="text-[10px] text-muted-foreground truncate hidden sm:block">{user.email}</span>
        </div>
      </div>

      {/* Stats */}
      {stats && <div className="shrink-0">{stats}</div>}

      {/* Role pill */}
      <span className={cn(
        'hidden sm:inline-flex items-center gap-1 text-[10px] font-semibold shrink-0 px-2 py-1 rounded-full border',
        meta.chipBg, meta.text, meta.border,
      )}>
        <Icon className="h-2.5 w-2.5" /> {meta.label}
      </span>

      {/* Pending badge */}
      {isPending && (
        <Badge variant="warning" className="text-[9px] py-0 px-1.5 shrink-0">Pending</Badge>
      )}
    </div>
  );
}

// ─── Section header ───────────────────────────────────────────────────────────

function SectionHeader({
  icon: Icon, label, count, color, open, onToggle,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  count?: number;
  color: string;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      className="flex w-full items-center gap-2.5 rounded-xl border border-border bg-muted/50 px-4 py-2.5 text-left transition-colors hover:bg-muted/80"
      onClick={onToggle}
    >
      {open
        ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
      <Icon className={cn('h-4 w-4 shrink-0', color)} />
      <span className="font-semibold text-sm flex-1 text-left">{label}</span>
      {count !== undefined && (
        <Badge variant="secondary" className="text-xs">{count}</Badge>
      )}
    </button>
  );
}

// ─── Team section ─────────────────────────────────────────────────────────────

function TeamSection({
  team, onNodeClick, highlightUserId,
}: {
  team: OrgTeam;
  onNodeClick?: (u: OrgUser) => void;
  highlightUserId?: string;
}) {
  const [open, setOpen] = useState(true);

  return (
    <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 overflow-hidden">
      <button
        className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left hover:bg-emerald-500/10 transition-colors"
        onClick={() => setOpen((v) => !v)}
      >
        {open
          ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
        <Users className="h-4 w-4 text-emerald-500 shrink-0" />
        <span className="font-semibold text-sm flex-1">{team.name}</span>
        <span className="text-xs text-muted-foreground mr-2">
          {team.members.length} agent{team.members.length !== 1 ? 's' : ''} · {team._count.leads} leads
        </span>
        <Badge variant="secondary" className="text-[10px]">Team</Badge>
      </button>

      {open && (
        <div className="px-4 pb-3">
          {/* TL */}
          {team.teamLead && (
            <TreeLeaf>
              <UserNode
                user={team.teamLead}
                role="COUNSELLING_TL"
                stats={
                  <AgentStats
                    leads={team.teamLead._count?.assignedByLeads ?? 0}
                    calls={undefined}
                    leadsLabel="assigned"
                  />
                }
                onClick={onNodeClick}
                highlight={highlightUserId === team.teamLead.id}
              />
            </TreeLeaf>
          )}

          {/* Agents */}
          {team.members.length > 0 && (
            <TreeBranch>
              {team.members.map((agent) => (
                <TreeLeaf key={agent.id}>
                  <UserNode
                    user={agent}
                    role="COUNSELLING_AGENT"
                    stats={
                      <AgentStats
                        leads={agent._count.assignedLeads}
                        calls={agent._count.feedbacks}
                      />
                    }
                    onClick={onNodeClick}
                    highlight={highlightUserId === agent.id}
                  />
                </TreeLeaf>
              ))}
            </TreeBranch>
          )}

          {team.members.length === 0 && !team.teamLead && (
            <p className="text-xs text-muted-foreground px-2 pt-1">No members yet.</p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Stat mini-chip ───────────────────────────────────────────────────────────

function AgentStats({
  leads, calls, leadsLabel = 'leads',
}: {
  leads: number;
  calls?: number;
  leadsLabel?: string;
}) {
  return (
    <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
      <span className="flex items-center gap-0.5 rounded bg-indigo-500/10 border border-indigo-500/20 px-1.5 py-0.5 font-medium text-indigo-400">
        <Activity className="h-2.5 w-2.5" /> {leads} {leadsLabel}
      </span>
      {calls !== undefined && (
        <span className="flex items-center gap-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 font-medium text-emerald-400">
          <Headphones className="h-2.5 w-2.5" /> {calls} calls
        </span>
      )}
    </div>
  );
}

// ─── Main OrgTree ─────────────────────────────────────────────────────────────

export function OrgTree({ data, onNodeClick, highlightUserId }: OrgTreeProps) {
  const [reportsOpen, setReportsOpen] = useState(true);
  const [opsOpen, setOpsOpen] = useState(true);
  const [teamsOpen, setTeamsOpen] = useState(true);
  const [pendingOpen, setPendingOpen] = useState(true);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  const toggleGroup = (id: string) =>
    setOpenGroups((prev) => ({ ...prev, [id]: prev[id] === false ? true : false }));

  const totalUsers =
    (data.reports.length) +
    (data.opsGroups.reduce((s, g) => s + g.members.length, 0)) +
    (data.teams.reduce((s, t) => s + t.members.length + (t.teamLead ? 1 : 0), 0));

  return (
    <div className="space-y-3">
      {/* ── SA Root node ── */}
      {data.sa && (
        <div>
          <RootNode user={data.sa} onClick={onNodeClick} />
          <div className="flex justify-center">
            <div className="w-px h-4 bg-border" />
          </div>
        </div>
      )}

      {/* ── Summary strip ── */}
      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground px-1">
        <span className="rounded-full bg-muted px-3 py-1">{data.teams.length} teams</span>
        <span className="rounded-full bg-muted px-3 py-1">{totalUsers} members</span>
        {data.pendingAgents.length > 0 && (
          <span className="rounded-full bg-amber-500/15 text-amber-400 px-3 py-1">
            {data.pendingAgents.length} pending approval
          </span>
        )}
      </div>

      <div className="space-y-2">
        {/* ── Reports ── */}
        {data.reports.length > 0 && (
          <div>
            <SectionHeader
              icon={BarChart2} label="Reports" count={data.reports.length}
              color="text-blue-400" open={reportsOpen} onToggle={() => setReportsOpen((v) => !v)}
            />
            {reportsOpen && (
              <TreeBranch>
                {data.reports.map((u) => (
                  <TreeLeaf key={u.id}>
                    <UserNode user={u} role="REPORTS" onClick={onNodeClick} highlight={highlightUserId === u.id} />
                  </TreeLeaf>
                ))}
              </TreeBranch>
            )}
          </div>
        )}

        {/* ── Operations ── */}
        {data.opsGroups.length > 0 && (
          <div>
            <SectionHeader
              icon={Upload} label="Operations" count={data.opsGroups.reduce((s, g) => s + g.members.length, 0)}
              color="text-amber-400" open={opsOpen} onToggle={() => setOpsOpen((v) => !v)}
            />
            {opsOpen && (
              <TreeBranch>
                {data.opsGroups.map((group) => {
                  const groupOpen = openGroups[group.id] !== false;
                  return (
                    <TreeLeaf key={group.id}>
                      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 overflow-hidden">
                        <button
                          className="flex w-full items-center gap-2 px-3.5 py-2 text-left hover:bg-amber-500/10 transition-colors"
                          onClick={() => toggleGroup(group.id)}
                        >
                          {groupOpen
                            ? <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
                            : <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />}
                          <Upload className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                          <span className="font-medium text-sm flex-1">{group.name}</span>
                          <Badge variant="secondary" className="text-[10px]">{group.members.length}</Badge>
                        </button>
                        {groupOpen && group.members.length > 0 && (
                          <div className="px-3.5 pb-2.5">
                            <TreeBranch>
                              {group.members.map((u) => (
                                <TreeLeaf key={u.id}>
                                  <UserNode
                                    user={u} role="OPERATIONS"
                                    stats={
                                      u._count?.uploadBatches !== undefined
                                        ? <span className="text-[10px] text-amber-400 rounded bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5">
                                            {u._count.uploadBatches} uploads
                                          </span>
                                        : undefined
                                    }
                                    onClick={onNodeClick}
                                    highlight={highlightUserId === u.id}
                                  />
                                </TreeLeaf>
                              ))}
                            </TreeBranch>
                          </div>
                        )}
                      </div>
                    </TreeLeaf>
                  );
                })}
              </TreeBranch>
            )}
          </div>
        )}

        {/* ── Counselling Teams ── */}
        {data.teams.length > 0 && (
          <div>
            <SectionHeader
              icon={Users} label="Counselling Teams" count={data.teams.length}
              color="text-emerald-400" open={teamsOpen} onToggle={() => setTeamsOpen((v) => !v)}
            />
            {teamsOpen && (
              <TreeBranch>
                {data.teams.map((team) => (
                  <TreeLeaf key={team.id}>
                    <TeamSection
                      team={team}
                      onNodeClick={onNodeClick}
                      highlightUserId={highlightUserId}
                    />
                  </TreeLeaf>
                ))}
              </TreeBranch>
            )}
          </div>
        )}

        {/* ── Pending Approval ── */}
        {data.pendingAgents.length > 0 && (
          <div>
            <SectionHeader
              icon={Clock} label="Pending Approval" count={data.pendingAgents.length}
              color="text-orange-400" open={pendingOpen} onToggle={() => setPendingOpen((v) => !v)}
            />
            {pendingOpen && (
              <TreeBranch>
                {data.pendingAgents.map((u) => (
                  <TreeLeaf key={u.id}>
                    <UserNode
                      user={{ ...u, isActive: false }}
                      role="COUNSELLING_AGENT"
                      onClick={onNodeClick}
                    />
                  </TreeLeaf>
                ))}
              </TreeBranch>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
