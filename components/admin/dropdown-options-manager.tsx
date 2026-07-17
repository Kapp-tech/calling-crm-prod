'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import {
  Plus, Pencil, Trash2, Loader2, ListChecks, Tag, ShieldCheck, Globe2,
  GraduationCap, MapPin, PhoneCall, CheckCircle2, Layers, Inbox,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';
import { useUndoable } from '@/components/shared/use-undoable';

const TYPE_META: Record<string, { icon: React.ComponentType<{ className?: string }>; color: string; bg: string; ring: string }> = {
  LEAD_TYPE:          { icon: Tag,           color: 'text-indigo-600 dark:text-indigo-400', bg: 'bg-indigo-500/10',  ring: 'from-indigo-500 to-indigo-600' },
  LEAD_VERIFICATION:  { icon: ShieldCheck,   color: 'text-blue-600 dark:text-blue-400',      bg: 'bg-blue-500/10',    ring: 'from-blue-500 to-blue-600' },
  LEAD_ORIGIN:        { icon: Globe2,        color: 'text-cyan-600 dark:text-cyan-400',      bg: 'bg-cyan-500/10',    ring: 'from-cyan-500 to-cyan-600' },
  COLLEGE:            { icon: GraduationCap, color: 'text-violet-600 dark:text-violet-400',  bg: 'bg-violet-500/10',  ring: 'from-violet-500 to-violet-600' },
  ZONE:               { icon: MapPin,        color: 'text-rose-600 dark:text-rose-400',      bg: 'bg-rose-500/10',    ring: 'from-rose-500 to-rose-600' },
  DATA_CALLING_TYPE:  { icon: PhoneCall,     color: 'text-amber-600 dark:text-amber-400',    bg: 'bg-amber-500/10',   ring: 'from-amber-500 to-amber-600' },
  LEAD_CONFIRMATION:  { icon: CheckCircle2,  color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-500/10', ring: 'from-emerald-500 to-emerald-600' },
};
const DEFAULT_META = { icon: ListChecks, color: 'text-slate-600 dark:text-slate-400', bg: 'bg-slate-500/10', ring: 'from-slate-500 to-slate-600' };

interface DropdownOption {
  id: string;
  type: string;
  value: string;
  kappCollegeId?: string | null;
  isActive: boolean;
  createdAt: string;
}

interface IdField {
  label: string;
  placeholder: string;
}

interface Props {
  type: string;
  title: string;
  description: string;
  placeholder?: string;
  idField?: IdField; // extra required ID field (used for colleges)
}

export function DropdownOptionsManager({ type, title, description, placeholder, idField }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: session } = useSession();

  const undoable = useUndoable();
  // Optimistically hidden while their undo toast is open (Gmail-style delete)
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());

  const [showDialog, setShowDialog]     = useState(false);
  const [editOption, setEditOption]     = useState<DropdownOption | null>(null);
  const [value, setValue]               = useState('');
  const [kappCollegeId, setKappId]      = useState('');

  const queryKey = ['dropdown-options', type];

  const { data: options = [], isLoading } = useQuery<DropdownOption[]>({
    queryKey,
    queryFn: () =>
      fetch(`/api/dropdown-options?type=${type}&all=1`).then(async (r) => {
        const d = await r.json();
        return Array.isArray(d) ? d : [];
      }),
    enabled: !!session?.user?.id,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey });

  const openCreate = () => {
    setEditOption(null);
    setValue('');
    setKappId('');
    setShowDialog(true);
  };

  const openEdit = (opt: DropdownOption) => {
    setEditOption(opt);
    setValue(opt.value);
    setKappId(opt.kappCollegeId ?? '');
    setShowDialog(true);
  };

  const canSave = value.trim() !== '' && (!idField || kappCollegeId.trim() !== '');

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (editOption) {
        const body: Record<string, unknown> = { value: value.trim() };
        if (idField) body.kappCollegeId = kappCollegeId.trim();
        const r = await fetch(`/api/dropdown-options/${editOption.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!r.ok) {
          const d = await r.json();
          throw new Error(d.error ?? 'Failed to update');
        }
      } else {
        const body: Record<string, unknown> = { type, value: value.trim() };
        if (idField) body.kappCollegeId = kappCollegeId.trim();
        const r = await fetch('/api/dropdown-options', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!r.ok) {
          const d = await r.json();
          throw new Error(d.error ?? 'Failed to create');
        }
      }
    },
    onSuccess: () => {
      toast({ title: editOption ? 'Option updated' : 'Option added' });
      setShowDialog(false);
      invalidate();
    },
    onError: (err: Error) => {
      toast({ variant: 'destructive', title: 'Error', description: err.message });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: (opt: DropdownOption) =>
      fetch(`/api/dropdown-options/${opt.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !opt.isActive }),
      }).then((r) => r.json()),
    onSuccess: () => { toast({ title: 'Status updated' }); invalidate(); },
    onError: () => toast({ variant: 'destructive', title: 'Failed to update status' }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      fetch(`/api/dropdown-options/${id}`, { method: 'DELETE' }).then((r) => r.json()),
    onSuccess: () => { toast({ title: 'Option deleted' }); invalidate(); },
    onError: () => toast({ variant: 'destructive', title: 'Failed to delete option' }),
  });

  const visibleOptions = options.filter((o) => !hiddenIds.has(o.id));
  const activeCount   = visibleOptions.filter((o) => o.isActive).length;
  const inactiveCount = visibleOptions.length - activeCount;
  const meta = TYPE_META[type] ?? DEFAULT_META;
  const Icon = meta.icon;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 animate-fade-in-up">
        <div className="flex items-start gap-3.5">
          <div className={cn('flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br shadow-lg', meta.ring)}>
            <Icon className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
            <p className="text-sm text-muted-foreground mt-1 max-w-xl">{description}</p>
          </div>
        </div>
        <Button
          onClick={openCreate}
          className="shrink-0 shadow-md shadow-primary/20 transition-transform duration-200 ease-premium hover:-translate-y-0.5 hover:shadow-lg hover:shadow-primary/30"
        >
          <Plus className="mr-2 h-4 w-4" />
          Add Value
        </Button>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 animate-fade-in-up" style={{ animationDelay: '60ms' }}>
        <div className="group relative overflow-hidden rounded-xl border border-border/60 bg-card px-4 py-3 hover-lift">
          <div className={cn('pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full opacity-0 blur-2xl transition-opacity duration-300 group-hover:opacity-100', meta.bg)} />
          <p className="relative text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Total</p>
          <p className="relative mt-0.5 text-2xl font-bold tabular-nums">{visibleOptions.length}</p>
        </div>
        <div className="group relative overflow-hidden rounded-xl border border-border/60 bg-card px-4 py-3 hover-lift">
          <div className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-emerald-500/10 opacity-0 blur-2xl transition-opacity duration-300 group-hover:opacity-100" />
          <p className="relative text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Active</p>
          <p className="relative mt-0.5 text-2xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">{activeCount}</p>
        </div>
        {inactiveCount > 0 && (
          <div className="group relative overflow-hidden rounded-xl border border-border/60 bg-card px-4 py-3 hover-lift">
            <div className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-muted opacity-0 blur-2xl transition-opacity duration-300 group-hover:opacity-100" />
            <p className="relative text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Inactive</p>
            <p className="relative mt-0.5 text-2xl font-bold tabular-nums text-muted-foreground">{inactiveCount}</p>
          </div>
        )}
      </div>

      {/* List */}
      <div className="rounded-2xl border border-border/60 bg-card shadow-sm animate-fade-in-up" style={{ animationDelay: '120ms' }}>
        <div className="flex items-center gap-2 border-b border-border/60 px-6 py-4">
          <Layers className="h-4 w-4 text-muted-foreground" />
          <div>
            <p className="text-sm font-bold leading-tight">Values</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Only <strong className="text-foreground">active</strong> values are accepted during CSV upload — inactive values are preserved for historical data.
            </p>
          </div>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-14">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : visibleOptions.length === 0 ? (
          <div className="flex flex-col items-center gap-2.5 py-14 text-center">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-muted">
              <Inbox className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="text-sm text-muted-foreground">
              No values added yet. Click <strong className="text-foreground">&ldquo;Add Value&rdquo;</strong> to get started.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border/60">
            <AnimatePresence initial={false}>
              {visibleOptions.map((opt, idx) => (
                <motion.div
                  key={opt.id}
                  layout="position"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2, delay: Math.min(idx, 12) * 0.02 }}
                  className={cn(
                    'group flex items-center gap-3.5 px-6 py-3.5 transition-colors hover:bg-muted/30',
                    !opt.isActive && 'opacity-60',
                  )}
                >
                  {/* Initial avatar */}
                  <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold', meta.bg, meta.color)}>
                    {opt.value.trim().charAt(0).toUpperCase() || '?'}
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className={cn('font-semibold truncate', !opt.isActive && 'line-through text-muted-foreground')}>
                      {opt.value}
                    </p>
                    {idField && opt.kappCollegeId && (
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {idField.label}: <span className="font-mono">{opt.kappCollegeId}</span>
                      </p>
                    )}
                  </div>

                  <span
                    className={cn(
                      'hidden shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide sm:inline-flex',
                      opt.isActive
                        ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                        : 'border-border bg-muted text-muted-foreground',
                    )}
                  >
                    <span className={cn('h-1.5 w-1.5 rounded-full', opt.isActive ? 'bg-emerald-500' : 'bg-muted-foreground/50')} />
                    {opt.isActive ? 'Active' : 'Inactive'}
                  </span>

                  <Switch
                    checked={opt.isActive}
                    onCheckedChange={() => toggleMutation.mutate(opt)}
                    title={opt.isActive ? 'Deactivate' : 'Activate'}
                    className="shrink-0"
                  />

                  <div className="flex items-center gap-0.5 shrink-0 rounded-lg border border-border/60 bg-muted/30 p-0.5">
                    <Button
                      variant="ghost" size="icon"
                      className="h-7 w-7 hover:bg-background"
                      onClick={() => openEdit(opt)}
                      title="Edit"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost" size="icon"
                      className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                      onClick={() => {
                        setHiddenIds((s) => new Set(s).add(opt.id));
                        undoable({
                          title: `Deleted "${opt.value}"`,
                          onExecute: () => deleteMutation.mutate(opt.id),
                          onUndo: () => setHiddenIds((s) => { const n = new Set(s); n.delete(opt.id); return n; }),
                        });
                      }}
                      title="Delete"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* Create / Edit Dialog */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editOption ? 'Edit Value' : `Add Value — ${title}`}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {idField && (
              <div className="space-y-1.5">
                <Label htmlFor="opt-kapp-id">
                  {idField.label} <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="opt-kapp-id"
                  value={kappCollegeId}
                  onChange={(e) => setKappId(e.target.value)}
                  placeholder={idField.placeholder}
                  autoFocus
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="opt-value">Value <span className="text-destructive">*</span></Label>
              <Input
                id="opt-value"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={placeholder ?? `Enter ${title.toLowerCase()} value`}
                autoFocus={!idField}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>Cancel</Button>
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={!canSave || saveMutation.isPending}
            >
              {saveMutation.isPending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
              {editOption ? 'Save Changes' : 'Add Value'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
