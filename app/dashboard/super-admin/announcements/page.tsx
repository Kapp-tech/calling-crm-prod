'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import {
  Loader2, Plus, Pencil, Trash2, EyeOff, Eye, Megaphone,
  AlertOctagon, AlertTriangle, Info, Minus, CalendarDays,
  User, Radio, ChevronDown, ChevronUp, LayoutList, CheckCircle2,
  Archive, Zap,
} from 'lucide-react';

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

// ─── Types ────────────────────────────────────────────────────────────────────

type Priority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
type FilterTab = 'all' | 'active' | 'archived';

interface Announcement {
  id: string;
  title: string;
  content: string;
  priority: Priority;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  author: { id: string; name: string };
}

interface FormState {
  title: string;
  content: string;
  priority: Priority;
}

// ─── Priority Config ──────────────────────────────────────────────────────────

const PRIORITY_CONFIG: Record<Priority, {
  label: string;
  badgeClass: string;
  borderClass: string;
  iconClass: string;
  Icon: React.ComponentType<{ className?: string }>;
  selectBg: string;
}> = {
  URGENT: {
    label: 'Urgent',
    badgeClass: 'bg-red-500/15 text-red-400 border-red-500/30',
    borderClass: 'border-l-red-500',
    iconClass: 'text-red-500',
    Icon: AlertOctagon,
    selectBg: 'text-red-400',
  },
  HIGH: {
    label: 'High',
    badgeClass: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
    borderClass: 'border-l-orange-500',
    iconClass: 'text-orange-400',
    Icon: AlertTriangle,
    selectBg: 'text-orange-400',
  },
  NORMAL: {
    label: 'Normal',
    badgeClass: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
    borderClass: 'border-l-blue-500',
    iconClass: 'text-blue-400',
    Icon: Info,
    selectBg: 'text-blue-400',
  },
  LOW: {
    label: 'Low',
    badgeClass: 'bg-slate-500/15 text-slate-400 border-slate-500/30',
    borderClass: 'border-l-slate-500',
    iconClass: 'text-slate-400',
    Icon: Minus,
    selectBg: 'text-slate-400',
  },
};

const EMPTY_FORM: FormState = { title: '', content: '', priority: 'NORMAL' };

// ─── Sub-components ───────────────────────────────────────────────────────────

function AnnouncementCard({
  a,
  onEdit,
  onToggle,
  onDelete,
  isPending,
}: {
  a: Announcement;
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
  isPending: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const pc = PRIORITY_CONFIG[a.priority];
  const PriorityIcon = pc.Icon;
  const isLong = a.content.length > 180;

  return (
    <div
      className={`
        group relative rounded-xl border bg-card border-l-4 ${pc.borderClass}
        shadow-sm hover:shadow-md transition-all duration-200
        ${!a.isActive ? 'opacity-60' : ''}
      `}
    >
      <div className="p-4">
        {/* Top row: priority + meta + actions */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            {/* Priority icon */}
            <div className={`mt-0.5 shrink-0 ${pc.iconClass}`}>
              <PriorityIcon className="h-4 w-4" />
            </div>

            <div className="flex-1 min-w-0">
              {/* Badges + meta */}
              <div className="flex flex-wrap items-center gap-2 mb-1.5">
                <Badge variant="outline" className={`text-xs font-semibold px-2 py-0.5 ${pc.badgeClass}`}>
                  {pc.label}
                </Badge>
                {!a.isActive && (
                  <Badge variant="outline" className="text-xs bg-muted/50 text-muted-foreground gap-1">
                    <Archive className="h-3 w-3" /> Archived
                  </Badge>
                )}
              </div>

              {/* Title */}
              <h3 className="font-semibold text-sm leading-snug mb-1.5">{a.title}</h3>

              {/* Content */}
              <p className={`text-sm text-muted-foreground whitespace-pre-wrap ${!expanded && isLong ? 'line-clamp-2' : ''}`}>
                {a.content}
              </p>
              {isLong && (
                <button
                  onClick={() => setExpanded(!expanded)}
                  className="mt-1 flex items-center gap-0.5 text-xs text-primary hover:underline"
                >
                  {expanded ? <><ChevronUp className="h-3 w-3" /> Show less</> : <><ChevronDown className="h-3 w-3" /> Show more</>}
                </button>
              )}

              {/* Footer meta */}
              <div className="flex flex-wrap items-center gap-3 mt-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <User className="h-3 w-3" /> {a.author.name}
                </span>
                <span className="flex items-center gap-1">
                  <CalendarDays className="h-3 w-3" /> {fmtDate(a.createdAt)}
                </span>
                <span className="text-muted-foreground/60">{timeAgo(a.createdAt)}</span>
              </div>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex shrink-0 items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={onToggle}
              title={a.isActive ? 'Archive' : 'Restore'}
              disabled={isPending}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:opacity-50"
            >
              {a.isActive ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
            <button
              onClick={onEdit}
              title="Edit"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={onDelete}
              title="Delete"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-destructive/15 hover:text-destructive transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function AnnouncementForm({
  form,
  setForm,
  onSubmit,
  isPending,
  onCancel,
  submitLabel,
}: {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  onSubmit: (e: React.FormEvent) => void;
  isPending: boolean;
  onCancel: () => void;
  submitLabel: string;
}) {
  const pc = PRIORITY_CONFIG[form.priority];
  const PriorityIcon = pc.Icon;

  return (
    <form onSubmit={onSubmit} className="space-y-4 pt-1">
      <div className="space-y-1.5">
        <label className="text-sm font-medium">Title</label>
        <Input
          placeholder="e.g. Office closed on Monday"
          value={form.title}
          onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
          maxLength={200}
          required
        />
        <p className="text-xs text-muted-foreground text-right">{form.title.length}/200</p>
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium">Content</label>
        <textarea
          placeholder="Write the full announcement message…"
          value={form.content}
          onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
          maxLength={5000}
          rows={5}
          required
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 resize-none"
        />
        <p className="text-xs text-muted-foreground text-right">{form.content.length}/5000</p>
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium">Priority</label>
        <Select
          value={form.priority}
          onValueChange={(v) => setForm((f) => ({ ...f, priority: v as Priority }))}
        >
          <SelectTrigger>
            <SelectValue>
              <span className={`flex items-center gap-2 ${pc.selectBg}`}>
                <PriorityIcon className="h-3.5 w-3.5" />
                {pc.label}
              </span>
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {(['URGENT', 'HIGH', 'NORMAL', 'LOW'] as Priority[]).map((p) => {
              const c = PRIORITY_CONFIG[p];
              const Icon = c.Icon;
              return (
                <SelectItem key={p} value={p}>
                  <span className={`flex items-center gap-2 ${c.selectBg}`}>
                    <Icon className="h-3.5 w-3.5" />
                    {c.label}
                  </span>
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>

        {/* Priority preview */}
        <div className={`rounded-lg border-l-4 ${pc.borderClass} bg-muted/30 px-3 py-2 text-xs text-muted-foreground`}>
          {form.priority === 'URGENT' && 'Shown first with a red highlight to all TLs and Agents.'}
          {form.priority === 'HIGH'   && 'Shown near the top with an orange highlight.'}
          {form.priority === 'NORMAL' && 'Standard announcement, shown in order.'}
          {form.priority === 'LOW'    && 'Informational — shown at the bottom of the list.'}
        </div>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={isPending} className="gap-1.5">
          {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Radio className="h-4 w-4" />}
          {submitLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SAAnnouncementsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const [tab, setTab]               = useState<FilterTab>('all');
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Announcement | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Announcement | null>(null);
  const [form, setForm]             = useState<FormState>(EMPTY_FORM);

  const { data: announcements = [], isLoading } = useQuery<Announcement[]>({
    queryKey: ['announcements-all'],
    queryFn: () =>
      fetch('/api/announcements?all=1').then((r) => r.json()).then((d) => Array.isArray(d) ? d : []),
  });

  // ── Stats ──
  const total    = announcements.length;
  const active   = announcements.filter((a) => a.isActive).length;
  const archived = announcements.filter((a) => !a.isActive).length;
  const urgent   = announcements.filter((a) => a.priority === 'URGENT' && a.isActive).length;

  // ── Filtered list ──
  const filtered = useMemo(() => {
    if (tab === 'active')   return announcements.filter((a) =>  a.isActive);
    if (tab === 'archived') return announcements.filter((a) => !a.isActive);
    return announcements;
  }, [announcements, tab]);

  // ── Mutations ──
  const createMutation = useMutation({
    mutationFn: (data: FormState) =>
      fetch('/api/announcements', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }).then((r) => r.json()),
    onSuccess: (d) => {
      if (d.error) { toast({ variant: 'destructive', title: 'Error', description: d.error }); return; }
      toast({ title: 'Announcement published', description: 'Visible to all TLs and Agents.' });
      qc.invalidateQueries({ queryKey: ['announcements-all'] });
      setCreateOpen(false);
      setForm(EMPTY_FORM);
    },
    onError: () => toast({ variant: 'destructive', title: 'Failed to publish' }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<FormState & { isActive: boolean }> }) =>
      fetch(`/api/announcements/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }).then((r) => r.json()),
    onSuccess: (d) => {
      if (d.error) { toast({ variant: 'destructive', title: 'Error', description: d.error }); return; }
      toast({ title: 'Announcement updated' });
      qc.invalidateQueries({ queryKey: ['announcements-all'] });
      setEditTarget(null);
    },
    onError: () => toast({ variant: 'destructive', title: 'Failed to update' }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      fetch(`/api/announcements/${id}`, { method: 'DELETE' }).then((r) => r.json()),
    onSuccess: (d) => {
      if (d.error) { toast({ variant: 'destructive', title: 'Error', description: d.error }); return; }
      toast({ title: 'Announcement deleted' });
      qc.invalidateQueries({ queryKey: ['announcements-all'] });
      setDeleteTarget(null);
    },
    onError: () => toast({ variant: 'destructive', title: 'Failed to delete' }),
  });

  function openCreate() { setForm(EMPTY_FORM); setCreateOpen(true); }
  function openEdit(a: Announcement) {
    setForm({ title: a.title, content: a.content, priority: a.priority });
    setEditTarget(a);
  }

  const TABS: { key: FilterTab; label: string; count: number; Icon: React.ComponentType<{ className?: string }> }[] = [
    { key: 'all',      label: 'All',      count: total,    Icon: LayoutList   },
    { key: 'active',   label: 'Active',   count: active,   Icon: CheckCircle2 },
    { key: 'archived', label: 'Archived', count: archived, Icon: Archive      },
  ];

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-4xl mx-auto">

      {/* ── Page header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
            <Megaphone className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h2 className="text-lg font-semibold leading-tight">Announcements</h2>
            <p className="text-xs text-muted-foreground">Broadcast messages to all TLs & Agents</p>
          </div>
        </div>
        <Button onClick={openCreate} className="gap-2 self-start sm:self-auto">
          <Plus className="h-4 w-4" /> New Announcement
        </Button>
      </div>

      {/* ── Stats row ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total',    value: total,    icon: LayoutList,   color: 'text-foreground'   },
          { label: 'Active',   value: active,   icon: CheckCircle2, color: 'text-green-400'    },
          { label: 'Archived', value: archived, icon: Archive,      color: 'text-muted-foreground' },
          { label: 'Urgent',   value: urgent,   icon: Zap,          color: 'text-red-400'      },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="rounded-xl border bg-card px-4 py-3 flex items-center gap-3">
            <Icon className={`h-4 w-4 shrink-0 ${color}`} />
            <div>
              <p className="text-xl font-bold leading-none">{value}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* ── Filter tabs ── */}
      <div className="flex items-center gap-1 rounded-lg border bg-muted/30 p-1 w-fit">
        {TABS.map(({ key, label, count, Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`
              flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-all
              ${tab === key
                ? 'bg-background shadow-sm text-foreground'
                : 'text-muted-foreground hover:text-foreground'}
            `}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
            <span className={`ml-0.5 rounded-full px-1.5 py-0.5 text-xs leading-none
              ${tab === key ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'}`}>
              {count}
            </span>
          </button>
        ))}
      </div>

      {/* ── List ── */}
      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-24 gap-3 text-muted-foreground">
          <Loader2 className="h-7 w-7 animate-spin" />
          <p className="text-sm">Loading announcements…</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-24 gap-3 text-muted-foreground">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
            <Megaphone className="h-7 w-7 opacity-40" />
          </div>
          <div className="text-center">
            <p className="text-sm font-medium">
              {tab === 'archived' ? 'No archived announcements' : tab === 'active' ? 'No active announcements' : 'No announcements yet'}
            </p>
            <p className="text-xs mt-1">
              {tab === 'all' ? 'Click "New Announcement" to publish your first one.' : ''}
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((a) => (
            <AnnouncementCard
              key={a.id}
              a={a}
              onEdit={() => openEdit(a)}
              onToggle={() => updateMutation.mutate({ id: a.id, data: { isActive: !a.isActive } })}
              onDelete={() => setDeleteTarget(a)}
              isPending={updateMutation.isPending}
            />
          ))}
        </div>
      )}

      {/* ── Create Dialog ── */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Radio className="h-4 w-4 text-primary" /> New Announcement
            </DialogTitle>
          </DialogHeader>
          <AnnouncementForm
            form={form}
            setForm={setForm}
            onSubmit={(e) => { e.preventDefault(); if (!form.title.trim() || !form.content.trim()) return; createMutation.mutate(form); }}
            isPending={createMutation.isPending}
            onCancel={() => setCreateOpen(false)}
            submitLabel="Publish"
          />
        </DialogContent>
      </Dialog>

      {/* ── Edit Dialog ── */}
      <Dialog open={!!editTarget} onOpenChange={(o) => { if (!o) setEditTarget(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="h-4 w-4 text-primary" /> Edit Announcement
            </DialogTitle>
          </DialogHeader>
          <AnnouncementForm
            form={form}
            setForm={setForm}
            onSubmit={(e) => {
              e.preventDefault();
              if (!editTarget || !form.title.trim() || !form.content.trim()) return;
              updateMutation.mutate({ id: editTarget.id, data: form });
            }}
            isPending={updateMutation.isPending}
            onCancel={() => setEditTarget(null)}
            submitLabel="Save Changes"
          />
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirm ── */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="h-4 w-4" /> Delete Announcement?
            </DialogTitle>
          </DialogHeader>
          <div className="rounded-lg border bg-muted/30 p-3 my-1">
            <p className="text-sm font-medium">{deleteTarget?.title}</p>
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{deleteTarget?.content}</p>
          </div>
          <p className="text-sm text-muted-foreground">
            This will permanently delete the announcement and cannot be undone.
          </p>
          <DialogFooter className="mt-1">
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              className="gap-1.5"
            >
              {deleteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Delete Permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
