'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Mail, Plus, Pencil, Trash2, Loader2, Send, CheckCircle2, XCircle, Info, Clock,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { PinGate } from '@/components/shared/pin-gate';
import { PIN_GATED_ACTIONS } from '@/lib/pin-gated-actions';
import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Address { emailid: string; name?: string }

interface Rule {
  id: string;
  name: string;
  reportType: 'AGENT_PERFORMANCE' | 'TEAM_SUMMARY' | 'WELCOME' | 'FEEDBACK_SUMMARY' | 'COLLEGE_WISE';
  frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY';
  sendHour: number;
  sendMinute: number;
  weekday: number | null;
  dayOfMonth: number | null;
  audience: 'FIXED' | 'BY_ROLE' | 'EACH_AGENT';
  toEmails: Address[];
  toRoles: string[];
  ccEmails: Address[];
  ccRoles: string[];
  bccEmails: Address[];
  scopeTlId: string | null;
  scopeTl: { id: string; name: string } | null;
  attachCsv: boolean;
  isActive: boolean;
  lastRunAt: string | null;
}

interface LogRow {
  id: string; subject: string; toEmails: string[]; success: boolean;
  error: string | null; providerGuid: string | null; periodLabel: string;
  sentAt: string; rule: { name: string } | null;
}

interface Payload {
  rules: Rule[];
  teamLeads: { id: string; name: string }[];
  logs: LogRow[];
  configured: boolean;
  fromAddress: string | null;
}

const REPORT_LABEL: Record<Rule['reportType'], string> = {
  AGENT_PERFORMANCE: 'Agent performance — one email per agent',
  TEAM_SUMMARY: 'Team summary — one email listing everyone',
  WELCOME: 'Welcome email — login details and links',
  FEEDBACK_SUMMARY: 'Feedback summary — leads by outcome, with the university count',
  COLLEGE_WISE: 'University / College wise — the same leads split by college',
};

/** Reports that cover the whole floor rather than one person. */
const MANAGEMENT_REPORTS: Rule['reportType'][] = ['TEAM_SUMMARY', 'FEEDBACK_SUMMARY', 'COLLEGE_WISE'];

const ROLES = ['SUPER_ADMIN', 'REPORTS', 'OPERATIONS', 'COUNSELLING_TL'];
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const BLANK: Omit<Rule, 'id' | 'scopeTl' | 'lastRunAt'> & { id?: string } = {
  name: '', reportType: 'TEAM_SUMMARY', frequency: 'DAILY',
  sendHour: 9, sendMinute: 0, weekday: 1, dayOfMonth: 1,
  audience: 'FIXED', toEmails: [], toRoles: [], ccEmails: [], ccRoles: [], bccEmails: [],
  scopeTlId: null, attachCsv: true, isActive: true,
};

const SELECT =
  'h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/** "9:05 am" from 9 and 5 — the times are IST wall clock, not the server's. */
function fmtTime(h: number, m: number) {
  const suffix = h < 12 ? 'am' : 'pm';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, '0')} ${suffix}`;
}

function scheduleText(r: Rule | typeof BLANK) {
  const at = `${fmtTime(r.sendHour, r.sendMinute)} IST`;
  if (r.frequency === 'DAILY') return `Every day at ${at}`;
  if (r.frequency === 'WEEKLY') return `Every ${WEEKDAYS[(r.weekday ?? 1) - 1]} at ${at}`;
  if (r.frequency === 'MONTHLY') return `Day ${r.dayOfMonth} of each month at ${at}`;
  return `Day ${r.dayOfMonth} of each quarter at ${at}`;
}

/** Comma or newline separated addresses, optionally "Name <a@b.com>". */
function parseAddresses(text: string): Address[] {
  return text
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const m = s.match(/^(.*)<([^>]+)>$/);
      return m
        ? { emailid: m[2].trim(), name: m[1].trim() || undefined }
        : { emailid: s };
    });
}

const addressesToText = (list: Address[]) =>
  list.map((a) => (a.name ? `${a.name} <${a.emailid}>` : a.emailid)).join(', ');

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function EmailAutomationPage() {
  return (
    <PinGate action={PIN_GATED_ACTIONS.EMAIL_AUTOMATION} title="Email Automation">
      <EmailAutomationContent />
    </PinGate>
  );
}

function EmailAutomationContent() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [editing, setEditing] = useState<(typeof BLANK & { id?: string }) | null>(null);
  const [toText, setToText] = useState('');
  const [ccText, setCcText] = useState('');
  const [bccText, setBccText] = useState('');

  const { data, isLoading } = useQuery<Payload>({
    queryKey: ['email-rules'],
    queryFn: () => fetch('/api/super-admin/email-rules').then((r) => r.json()),
  });

  function openEditor(rule?: Rule) {
    const base = rule ? { ...rule } : { ...BLANK };
    setEditing(base);
    setToText(addressesToText(base.toEmails ?? []));
    setCcText(addressesToText(base.ccEmails ?? []));
    setBccText(addressesToText(base.bccEmails ?? []));
  }

  const save = useMutation({
    mutationFn: async (d: typeof BLANK & { id?: string }) => {
      const payload = {
        ...d,
        toEmails: parseAddresses(toText),
        ccEmails: parseAddresses(ccText),
        bccEmails: parseAddresses(bccText),
      };
      const r = await fetch('/api/super-admin/email-rules', {
        method: d.id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(typeof j.error === 'string' ? j.error : 'Could not save this rule');
    },
    onSuccess: () => {
      toast({ title: 'Rule saved' });
      setEditing(null);
      qc.invalidateQueries({ queryKey: ['email-rules'] });
    },
    onError: (e: Error) => toast({ variant: 'destructive', title: 'Save failed', description: e.message }),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`/api/super-admin/email-rules?id=${id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error('Could not delete this rule');
    },
    onSuccess: () => { toast({ title: 'Rule deleted' }); qc.invalidateQueries({ queryKey: ['email-rules'] }); },
    onError: (e: Error) => toast({ variant: 'destructive', title: 'Delete failed', description: e.message }),
  });

  const sendNow = useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch('/api/super-admin/email-rules', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(typeof j.error === 'string' ? j.error : 'Send failed');
      return j.outcome as { sent: number; failed: number; skipped?: string };
    },
    onSuccess: (o) => {
      toast({
        title: o.skipped ? 'Nothing sent' : `Sent ${o.sent}${o.failed ? `, ${o.failed} failed` : ''}`,
        description: o.skipped ?? 'Check the send log below.',
        variant: o.skipped || o.failed ? 'destructive' : undefined,
      });
      qc.invalidateQueries({ queryKey: ['email-rules'] });
    },
    onError: (e: Error) => toast({ variant: 'destructive', title: 'Send failed', description: e.message }),
  });

  const rules = data?.rules ?? [];

  return (
    <div className="mx-auto max-w-6xl space-y-6 py-2">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold">
            <Mail className="h-5 w-5 text-primary" /> Email Automation
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Scheduled performance emails — what goes out, when, and who receives or is copied.
          </p>
        </div>
        <Button onClick={() => openEditor()}>
          <Plus className="mr-1.5 h-4 w-4" /> Add rule
        </Button>
      </div>

      {data && !data.configured && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-300/60 bg-amber-50/60 p-3 text-xs text-amber-800 dark:border-amber-700/40 dark:bg-amber-950/20 dark:text-amber-300">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Email is not configured on this server, so nothing will send. An admin needs to set
            <code className="mx-1">GOINFINITO_CLIENT_ID</code>,
            <code className="mx-1">GOINFINITO_CLIENT_PASSWORD</code> and
            <code className="mx-1">EMAIL_FROM_ADDRESS</code>, then restart.
          </span>
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : (
        <>
          <section className="space-y-2">
            <h2 className="text-sm font-semibold">Rules</h2>
            {rules.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border/60 p-8 text-center text-sm text-muted-foreground">
                No rules yet. Add one to start sending performance emails automatically.
              </div>
            ) : (
              <div className="space-y-2">
                {rules.map((r) => (
                  <div key={r.id} className={cn('rounded-xl border border-border/60 p-4', !r.isActive && 'opacity-60')}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold">{r.name}</span>
                          <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold',
                            r.isActive ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' : 'bg-muted text-muted-foreground')}>
                            {r.isActive ? 'Active' : 'Paused'}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">{REPORT_LABEL[r.reportType]}</p>
                        <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                          <Clock className="h-3 w-3" /> {scheduleText(r)}
                          {r.scopeTl && <> · only {r.scopeTl.name}’s team</>}
                          {r.attachCsv && <> · CSV attached</>}
                        </p>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          <strong>To:</strong>{' '}
                          {r.audience === 'EACH_AGENT'
                            ? 'each agent, their own numbers'
                            : r.audience === 'BY_ROLE'
                            ? `everyone with role ${r.toRoles.join(', ') || '(none chosen)'}`
                            : addressesToText(r.toEmails) || '(none)'}
                          {(r.ccEmails.length > 0 || r.ccRoles.length > 0) && (
                            <> · <strong>Cc:</strong> {[addressesToText(r.ccEmails), ...r.ccRoles].filter(Boolean).join(', ')}</>
                          )}
                          {r.bccEmails.length > 0 && <> · <strong>Bcc:</strong> {addressesToText(r.bccEmails)}</>}
                        </p>
                        {r.lastRunAt && (
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            Last run {new Date(r.lastRunAt).toLocaleString('en-IN')}
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button variant="outline" size="sm" className="gap-1.5 text-xs"
                          onClick={() => sendNow.mutate(r.id)} disabled={sendNow.isPending}>
                          {sendNow.isPending && sendNow.variables === r.id
                            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            : <Send className="h-3.5 w-3.5" />}
                          Send now
                        </Button>
                        <button onClick={() => openEditor(r)} className="rounded p-2 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={`Edit ${r.name}`}>
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => { if (confirm(`Delete "${r.name}"?`)) remove.mutate(r.id); }}
                          className="rounded p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          aria-label={`Delete ${r.name}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <p className="text-[11px] text-muted-foreground">
              Times are IST. A rule sends once per period — a run missed while the server was down is
              picked up on the next check rather than skipped.
            </p>
          </section>

          {/* ── Send log ─────────────────────────────────────────────────── */}
          <section className="space-y-2">
            <h2 className="text-sm font-semibold">
              Send log <span className="font-normal text-muted-foreground">— last 50</span>
            </h2>
            <div className="overflow-x-auto rounded-xl border border-border/60">
              <table className="w-full min-w-[720px] text-xs">
                <thead className="bg-muted/60">
                  <tr>
                    {['When', 'Rule', 'Subject', 'To', 'Result'].map((h) => (
                      <th key={h} className="px-3 py-2.5 text-left font-semibold text-muted-foreground">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(data?.logs ?? []).length === 0 ? (
                    <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">Nothing sent yet.</td></tr>
                  ) : data!.logs.map((l) => (
                    <tr key={l.id} className="border-t border-border/50">
                      <td className="px-3 py-2 whitespace-nowrap">
                        {new Date(l.sentAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">{l.rule?.name ?? '—'}</td>
                      <td className="px-3 py-2">{l.subject}</td>
                      <td className="px-3 py-2 break-all">{l.toEmails.join(', ')}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {l.success ? (
                          <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                            <CheckCircle2 className="h-3 w-3" /> Sent
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-red-600" title={l.error ?? ''}>
                            <XCircle className="h-3 w-3" /> {l.error ?? 'Failed'}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {/* ── Editor ───────────────────────────────────────────────────────── */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader><DialogTitle>{editing?.id ? 'Edit rule' : 'Add rule'}</DialogTitle></DialogHeader>
          {editing && (() => {
            const set = (patch: Partial<typeof BLANK>) => setEditing({ ...editing, ...patch });
            // Both of these carry one person's own details, so the recipient is
            // always that person; only Cc and Bcc are free to configure.
            const isAgentReport =
              editing.reportType === 'AGENT_PERFORMANCE' || editing.reportType === 'WELCOME';
            return (
              <div className="space-y-4 py-1">
                <div className="space-y-1.5">
                  <Label htmlFor="er-name">Name <span className="text-destructive">*</span></Label>
                  <Input id="er-name" value={editing.name} onChange={(e) => set({ name: e.target.value })}
                    placeholder="Daily team summary to management" />
                </div>

                <div className="space-y-1.5">
                  <Label>What to send</Label>
                  <select className={SELECT} value={editing.reportType}
                    onChange={(e) => {
                      const reportType = e.target.value as Rule['reportType'];
                      // The audience is dictated by the report: a per-agent email
                      // must go to each agent, a team summary must not.
                      set({
                        reportType,
                        audience: MANAGEMENT_REPORTS.includes(reportType) ? 'FIXED' : 'EACH_AGENT',
                      });
                    }}>
                    <option value="TEAM_SUMMARY">{REPORT_LABEL.TEAM_SUMMARY}</option>
                    <option value="AGENT_PERFORMANCE">{REPORT_LABEL.AGENT_PERFORMANCE}</option>
                    <option value="FEEDBACK_SUMMARY">{REPORT_LABEL.FEEDBACK_SUMMARY}</option>
                    <option value="COLLEGE_WISE">{REPORT_LABEL.COLLEGE_WISE}</option>
                    <option value="WELCOME">{REPORT_LABEL.WELCOME}</option>
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>How often</Label>
                    <select className={SELECT} value={editing.frequency}
                      onChange={(e) => set({ frequency: e.target.value as Rule['frequency'] })}>
                      <option value="DAILY">Daily</option>
                      <option value="WEEKLY">Weekly</option>
                      <option value="MONTHLY">Monthly</option>
                      <option value="QUARTERLY">Quarterly</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Time (IST)</Label>
                    <input type="time" className={SELECT}
                      value={`${String(editing.sendHour).padStart(2, '0')}:${String(editing.sendMinute).padStart(2, '0')}`}
                      onChange={(e) => {
                        const [h, m] = e.target.value.split(':').map(Number);
                        set({ sendHour: h || 0, sendMinute: m || 0 });
                      }} />
                  </div>
                </div>

                {editing.frequency === 'WEEKLY' && (
                  <div className="space-y-1.5">
                    <Label>Day of week</Label>
                    <select className={SELECT} value={editing.weekday ?? 1}
                      onChange={(e) => set({ weekday: Number(e.target.value) })}>
                      {WEEKDAYS.map((d, i) => <option key={d} value={i + 1}>{d}</option>)}
                    </select>
                  </div>
                )}

                {(editing.frequency === 'MONTHLY' || editing.frequency === 'QUARTERLY') && (
                  <div className="space-y-1.5">
                    <Label>Day of month</Label>
                    <select className={SELECT} value={editing.dayOfMonth ?? 1}
                      onChange={(e) => set({ dayOfMonth: Number(e.target.value) })}>
                      {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d}</option>)}
                    </select>
                    <p className="text-[11px] text-muted-foreground">Capped at 28 so February never gets skipped.</p>
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label>Who receives it</Label>
                  {isAgentReport ? (
                    <p className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                      {editing.reportType === 'WELCOME'
                        ? 'Each person receives their own login details, at their CRM email address. A welcome also goes out automatically the moment an account is created — this rule is for re-sending. Use Cc to copy a manager.'
                        : 'Each agent receives their own numbers, at their CRM email address.'}
                    </p>
                  ) : (
                    <select className={SELECT} value={editing.audience}
                      onChange={(e) => set({ audience: e.target.value as Rule['audience'] })}>
                      <option value="FIXED">Specific email addresses</option>
                      <option value="BY_ROLE">Everyone with a role</option>
                    </select>
                  )}
                </div>

                {!isAgentReport && editing.audience === 'FIXED' && (
                  <div className="space-y-1.5">
                    <Label htmlFor="er-to">To <span className="text-destructive">*</span></Label>
                    <textarea id="er-to" value={toText} onChange={(e) => setToText(e.target.value)}
                      placeholder="director@kollegeapply.com, Ravi <ravi@kollegeapply.com>"
                      className="min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                    <p className="text-[11px] text-muted-foreground">Separate with commas or new lines. <code>Name &lt;email&gt;</code> is understood.</p>
                  </div>
                )}

                {!isAgentReport && editing.audience === 'BY_ROLE' && (
                  <div className="space-y-1.5">
                    <Label>Roles</Label>
                    <div className="flex flex-wrap gap-1.5">
                      {ROLES.map((role) => {
                        const on = editing.toRoles.includes(role);
                        return (
                          <button key={role} type="button"
                            onClick={() => set({ toRoles: on ? editing.toRoles.filter((x) => x !== role) : [...editing.toRoles, role] })}
                            className={cn('rounded-full border px-2.5 py-1 text-xs transition-colors',
                              on ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-muted')}>
                            {role.replace(/_/g, ' ')}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label htmlFor="er-cc">Cc</Label>
                  <textarea id="er-cc" value={ccText} onChange={(e) => setCcText(e.target.value)}
                    placeholder="Optional — anyone who should be copied"
                    className="min-h-[46px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="er-bcc">Bcc</Label>
                  <textarea id="er-bcc" value={bccText} onChange={(e) => setBccText(e.target.value)}
                    placeholder="Optional"
                    className="min-h-[46px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                </div>

                <div className="space-y-1.5">
                  <Label>Limit to one team</Label>
                  <select className={SELECT} value={editing.scopeTlId ?? ''}
                    onChange={(e) => set({ scopeTlId: e.target.value || null })}>
                    <option value="">All agents</option>
                    {(data?.teamLeads ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}’s team</option>)}
                  </select>
                </div>

                <div className="flex flex-wrap gap-4">
                  {!isAgentReport && (
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={editing.attachCsv}
                        onChange={(e) => set({ attachCsv: e.target.checked })} className="h-4 w-4" />
                      Attach CSV
                    </label>
                  )}
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={editing.isActive}
                      onChange={(e) => set({ isActive: e.target.checked })} className="h-4 w-4" />
                    Active
                  </label>
                </div>

                <p className="rounded-md bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">
                  {scheduleText(editing)}
                </p>
              </div>
            );
          })()}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={() => editing && save.mutate(editing)} disabled={save.isPending || !editing?.name.trim()}>
              {save.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Save rule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
