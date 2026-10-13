'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Webhook, Loader2, Plus, Trash2, Save, Send, ChevronDown, ChevronUp,
  CheckCircle2, XCircle, RotateCcw, Search, Copy, ShieldAlert,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { PaginationBar } from '@/components/shared/pagination-bar';
import { cn, formatDateTime } from '@/lib/utils';
import { FIELD_CATALOG, SAMPLE_LEAD_DATA, type FieldGroup } from '@/lib/lead-integration-fields';
import { renderTemplate, TEMPLATE_HELPERS } from '@/lib/lead-integration-template';
import { SECRET_UNCHANGED_SENTINEL } from '@/lib/lead-integration-constants';
import { HTTP_METHODS } from '@/lib/lead-integration-validation';

interface HeaderRow {
  key: string;
  value: string;
  isSecret: boolean;
  unchanged?: boolean;
}

interface ParamRow {
  key: string;
  value: string;
}

interface IntegrationDetail {
  id: string;
  name: string;
  isActive: boolean;
  method: string;
  url: string;
  headers: HeaderRow[];
  queryParams: ParamRow[];
  bodyTemplate: string;
  timeoutMs: number;
}

interface LeadSearchResult {
  id: string;
  name: string;
  phone: string;
  email: string;
}

interface LogRow {
  id: string;
  isTest: boolean;
  retryOfLogId: string | null;
  requestUrl: string;
  requestMethod: string;
  requestBody: string;
  responseStatus: number | null;
  responseBody: string | null;
  success: boolean;
  errorMessage: string | null;
  attemptedAt: string;
  lead: { id: string; name: string } | null;
}

interface TestResult {
  success: boolean;
  responseStatus: number | null;
  responseBody: string | null;
  errorMessage: string | null;
}

const TABS = [
  { key: 'setup', label: 'Setup' },
  { key: 'headers', label: 'Headers & Params' },
  { key: 'body', label: 'Body Builder' },
  { key: 'test', label: 'Test & Send' },
  { key: 'logs', label: 'Logs' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

const FIELD_GROUPS: FieldGroup[] = ['Lead', 'Agent', 'LeadProfile', 'System'];
const GROUP_LABEL: Record<FieldGroup, string> = { Lead: 'Lead', Agent: 'Assigned Agent', LeadProfile: 'Lead Profile', System: 'System' };

export function LeadIntegrationBuilder({ integrationId }: { integrationId?: string }) {
  const isEdit = !!integrationId;
  const router = useRouter();
  const qc = useQueryClient();
  const { toast } = useToast();

  const [tab, setTab] = useState<TabKey>('setup');
  const [name, setName] = useState('');
  const [isActive, setIsActive] = useState(false);
  const [method, setMethod] = useState<string>('POST');
  const [url, setUrl] = useState('');
  const [headers, setHeaders] = useState<HeaderRow[]>([
    { key: 'Content-Type', value: 'application/json', isSecret: false },
  ]);
  const [queryParams, setQueryParams] = useState<ParamRow[]>([]);
  const [bodyTemplate, setBodyTemplate] = useState('{\n  \n}');
  const [timeoutMs, setTimeoutMs] = useState(10000);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(!isEdit);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Shared target for both the Body Builder's Live Preview and Test & Send —
  // previewing and testing against the same lead keeps the UI coherent.
  const [dataSource, setDataSource] = useState<'sample' | 'lead'>('sample');
  const [leadQuery, setLeadQuery] = useState('');
  const [leadResults, setLeadResults] = useState<LeadSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedLead, setSelectedLead] = useState<LeadSearchResult | null>(null);

  const [testSending, setTestSending] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);

  const [logsPage, setLogsPage] = useState(1);
  const [logsLimit, setLogsLimit] = useState(25);
  const [logsFrom, setLogsFrom] = useState('');
  const [logsTo, setLogsTo] = useState('');

  const { data: integration } = useQuery<IntegrationDetail>({
    queryKey: ['lead-integration', integrationId],
    queryFn: () => fetch(`/api/super-admin/lead-integrations/${integrationId}`).then((r) => r.json()),
    enabled: isEdit,
  });

  useEffect(() => {
    if (!integration) return;
    setName(integration.name);
    setIsActive(integration.isActive);
    setMethod(integration.method);
    setUrl(integration.url);
    setHeaders(
      (integration.headers ?? []).map((h) => ({
        key: h.key,
        isSecret: h.isSecret,
        value: h.isSecret && h.value === SECRET_UNCHANGED_SENTINEL ? '' : h.value,
        unchanged: h.isSecret && h.value === SECRET_UNCHANGED_SENTINEL,
      }))
    );
    setQueryParams(integration.queryParams ?? []);
    setBodyTemplate(integration.bodyTemplate);
    setTimeoutMs(integration.timeoutMs);
    setLoaded(true);
  }, [integration]);

  const { data: previewData } = useQuery<Record<string, unknown>>({
    queryKey: ['lead-integration-preview-data', selectedLead?.id],
    queryFn: () =>
      fetch(`/api/super-admin/lead-integrations/preview-data?leadId=${selectedLead!.id}`).then((r) => r.json()),
    enabled: dataSource === 'lead' && !!selectedLead,
  });

  const activeData = dataSource === 'lead' && previewData ? previewData : SAMPLE_LEAD_DATA;

  const rendered = useMemo(() => renderTemplate(bodyTemplate, activeData), [bodyTemplate, activeData]);
  /**
   * Validity is judged on the RENDERED body, not the raw template.
   *
   * It used to JSON.parse the template text itself, which worked only because
   * every token happened to sit inside quotes — `"name": "{{name}}"` is
   * parseable JSON before substitution. {{jsonArray(field)}} cannot be quoted:
   * it supplies its own brackets so the body can carry a real array, which
   * makes the raw template unparseable by construction. The old check called
   * that invalid and blocked Save, so the one token that needed the editor's
   * help was the one it refused.
   *
   * The rendered output is also the better test regardless: it is exactly what
   * lib/lead-integration-engine.ts parses before sending, so the badge now
   * agrees with what the send will do rather than approximating it. A missing
   * comma still fails, because substitution preserves structure.
   */
  const bodyValid = rendered.valid;
  const fieldsUsedCount = useMemo(() => (bodyTemplate.match(/\{\{[^}]+\}\}/g) ?? []).length, [bodyTemplate]);

  useEffect(() => {
    if (leadQuery.trim().length < 2) {
      setLeadResults([]);
      return;
    }
    setSearching(true);
    const t = setTimeout(() => {
      fetch(`/api/leads/search?q=${encodeURIComponent(leadQuery.trim())}`)
        .then((r) => r.json())
        .then((d) => setLeadResults(Array.isArray(d) ? d : []))
        .finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(t);
  }, [leadQuery]);

  function insertField(fieldKey: string) {
    const token = `{{${fieldKey}}}`;
    const el = textareaRef.current;
    if (!el) {
      setBodyTemplate((t) => t + token);
      return;
    }
    const start = el.selectionStart ?? bodyTemplate.length;
    const end = el.selectionEnd ?? bodyTemplate.length;
    const next = bodyTemplate.slice(0, start) + token + bodyTemplate.slice(end);
    setBodyTemplate(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  }

  function addHeader() {
    setHeaders((h) => [...h, { key: '', value: '', isSecret: false }]);
  }
  function updateHeader(i: number, patch: Partial<HeaderRow>) {
    setHeaders((h) => h.map((row, idx) => (idx === i ? { ...row, ...patch, unchanged: false } : row)));
  }
  function removeHeader(i: number) {
    setHeaders((h) => h.filter((_, idx) => idx !== i));
  }

  function addParam() {
    setQueryParams((p) => [...p, { key: '', value: '' }]);
  }
  function updateParam(i: number, patch: Partial<ParamRow>) {
    setQueryParams((p) => p.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  }
  function removeParam(i: number) {
    setQueryParams((p) => p.filter((_, idx) => idx !== i));
  }

  function buildPayload() {
    return {
      name: name.trim(),
      isActive,
      method,
      url: url.trim(),
      headers: headers
        .filter((h) => h.key.trim())
        .map((h) => ({
          key: h.key.trim(),
          isSecret: h.isSecret,
          value: h.isSecret && h.unchanged ? SECRET_UNCHANGED_SENTINEL : h.value,
        })),
      queryParams: queryParams.filter((p) => p.key.trim()).map((p) => ({ key: p.key.trim(), value: p.value })),
      bodyTemplate,
      timeoutMs,
    };
  }

  async function handleSave() {
    if (name.trim().length < 2) {
      toast({ variant: 'destructive', title: 'Name is required' });
      setTab('setup');
      return;
    }
    if (!url.trim()) {
      toast({ variant: 'destructive', title: 'URL is required' });
      setTab('setup');
      return;
    }
    if (!bodyValid) {
      toast({
        variant: 'destructive',
        title: 'Body template does not render to valid JSON',
        description: rendered.error,
      });
      setTab('body');
      return;
    }

    setSaving(true);
    try {
      const payload = buildPayload();
      const r = await fetch(
        isEdit ? `/api/super-admin/lead-integrations/${integrationId}` : '/api/super-admin/lead-integrations',
        {
          method: isEdit ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      );
      const json = await r.json();
      if (!r.ok) throw new Error(typeof json?.error === 'string' ? json.error : 'Failed to save');

      qc.invalidateQueries({ queryKey: ['lead-integrations'] });
      if (isEdit) {
        qc.invalidateQueries({ queryKey: ['lead-integration', integrationId] });
        toast({ title: 'Saved' });
      } else {
        toast({ title: 'Integration created' });
        router.push(`/dashboard/super-admin/configurations/lead-integrations/${json.id}`);
      }
    } catch (err) {
      toast({ variant: 'destructive', title: 'Save failed', description: err instanceof Error ? err.message : undefined });
    } finally {
      setSaving(false);
    }
  }

  async function handleTestSend() {
    if (!isEdit) return;
    if (dataSource === 'lead' && !selectedLead) {
      toast({ variant: 'destructive', title: 'Pick a lead to test with' });
      return;
    }
    setTestSending(true);
    setTestResult(null);
    try {
      const body = dataSource === 'lead' ? { leadId: selectedLead!.id } : { useSampleData: true as const };
      const r = await fetch(`/api/super-admin/lead-integrations/${integrationId}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await r.json();
      if (!r.ok) throw new Error(typeof json?.error === 'string' ? json.error : 'Test request failed');
      setTestResult(json);
      qc.invalidateQueries({ queryKey: ['lead-integration-logs', integrationId] });
      qc.invalidateQueries({ queryKey: ['lead-integrations'] });
    } catch (err) {
      toast({ variant: 'destructive', title: 'Test request failed', description: err instanceof Error ? err.message : undefined });
    } finally {
      setTestSending(false);
    }
  }

  const { data: logsData, isLoading: logsLoading, isFetching: logsFetching } = useQuery<{
    logs: LogRow[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }>({
    queryKey: ['lead-integration-logs', integrationId, logsPage, logsLimit, logsFrom, logsTo],
    queryFn: () => {
      const p = new URLSearchParams({ page: String(logsPage), limit: String(logsLimit) });
      if (logsFrom) p.set('from', logsFrom);
      if (logsTo) p.set('to', logsTo);
      return fetch(`/api/super-admin/lead-integrations/${integrationId}/logs?${p}`).then((r) => r.json());
    },
    enabled: isEdit && tab === 'logs',
    placeholderData: (prev) => prev,
  });

  async function handleRetry(logId: string) {
    setRetryingId(logId);
    try {
      const r = await fetch(`/api/super-admin/lead-integrations/${integrationId}/logs/${logId}/retry`, { method: 'POST' });
      const json = await r.json();
      if (!r.ok) throw new Error(typeof json?.error === 'string' ? json.error : 'Retry failed');
      toast({ title: json.success ? 'Retry succeeded' : 'Retry attempted — still failing', description: json.success ? undefined : json.errorMessage });
      qc.invalidateQueries({ queryKey: ['lead-integration-logs', integrationId] });
    } catch (err) {
      toast({ variant: 'destructive', title: 'Retry failed', description: err instanceof Error ? err.message : undefined });
    } finally {
      setRetryingId(null);
    }
  }

  const leadPickerBlock = (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={selectedLead ? selectedLead.name : leadQuery}
          onChange={(e) => {
            setSelectedLead(null);
            setLeadQuery(e.target.value);
          }}
          placeholder="Search by name, phone, or email…"
          className="pl-8"
        />
      </div>
      {!selectedLead && leadQuery.trim().length >= 2 && (
        <div className="max-h-48 overflow-y-auto rounded-lg border border-border">
          {searching ? (
            <div className="flex justify-center py-4">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : leadResults.length === 0 ? (
            <p className="px-3 py-3 text-xs text-muted-foreground">No matching leads.</p>
          ) : (
            leadResults.map((l) => (
              <button
                key={l.id}
                type="button"
                onClick={() => {
                  setSelectedLead(l);
                  setLeadQuery('');
                }}
                className="flex w-full flex-col items-start gap-0.5 border-b border-border/60 px-3 py-2 text-left text-sm last:border-0 hover:bg-muted/40"
              >
                <span className="font-medium">{l.name}</span>
                <span className="text-[11px] text-muted-foreground">{l.phone} · {l.email}</span>
              </button>
            ))
          )}
        </div>
      )}
      {selectedLead && (
        <button type="button" onClick={() => setSelectedLead(null)} className="text-xs text-muted-foreground underline">
          Change lead
        </button>
      )}
    </div>
  );

  if (isEdit && !loaded) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl sm:text-2xl font-bold">
            <Webhook className="h-5 w-5 sm:h-6 sm:w-6 text-primary" /> {isEdit ? name || 'Edit Integration' : 'New Integration'}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Configure the endpoint, headers, and field mapping for pushing referral leads to an external system.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {isEdit && (
            <span
              className={cn(
                'rounded-full border px-2.5 py-1 text-xs font-bold',
                isActive
                  ? 'border-emerald-300/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                  : 'border-border bg-muted text-muted-foreground'
              )}
            >
              {isActive ? 'Active' : 'Inactive'}
            </span>
          )}
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            <Save className="mr-1.5 h-3.5 w-3.5" /> Save
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1 rounded-lg border border-border bg-muted/30 p-1">
        {TABS.filter((t) => isEdit || (t.key !== 'test' && t.key !== 'logs')).map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              tab === t.key ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'setup' && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Setup</CardTitle>
            <CardDescription>Name, trigger, and where the request goes.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder='e.g. "Push Referrals to LMS"' />
              </div>
              <div className="space-y-1.5">
                <Label>Trigger</Label>
                <Input value="Referral Lead Created" disabled className="bg-muted/40 text-muted-foreground" />
              </div>
            </div>

            {isEdit ? (
              <div className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/20 px-4 py-3">
                <div>
                  <p className="text-sm font-medium">Active</p>
                  <p className="text-xs text-muted-foreground">When on, every new referral lead is pushed here automatically.</p>
                </div>
                <Switch checked={isActive} onCheckedChange={setIsActive} />
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-border/60 bg-muted/10 px-4 py-3 text-xs text-muted-foreground">
                New integrations save as Inactive. Save this one, verify it with Test &amp; Send, then activate it from here.
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-[140px_1fr]">
              <div className="space-y-1.5">
                <Label>Method</Label>
                <Select value={method} onValueChange={setMethod}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {HTTP_METHODS.map((m) => (
                      <SelectItem key={m} value={m}>
                        {m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Endpoint URL</Label>
                <Input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://api.example.com/leads"
                  className="font-mono text-sm"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Timeout (ms)</Label>
              <Input
                type="number"
                min={1000}
                max={30000}
                step={500}
                value={timeoutMs}
                onChange={(e) => setTimeoutMs(Number(e.target.value) || 10000)}
                className="max-w-[160px]"
              />
            </div>
          </CardContent>
        </Card>
      )}

      {tab === 'headers' && (
        <div className="space-y-5">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
              <div>
                <CardTitle className="text-base">API Headers Mapping</CardTitle>
                <CardDescription>Sent with every request. Mark a value Secret to encrypt it at rest.</CardDescription>
              </div>
              <Button size="sm" variant="outline" onClick={addHeader}>
                <Plus className="mr-1.5 h-3.5 w-3.5" /> Add Header
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              {headers.length === 0 ? (
                <p className="px-5 py-6 text-sm text-muted-foreground">No headers configured.</p>
              ) : (
                <div className="divide-y">
                  {headers.map((h, i) => (
                    <div key={i} className="grid grid-cols-1 gap-2 px-5 py-3 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-center">
                      <Input value={h.key} onChange={(e) => updateHeader(i, { key: e.target.value })} placeholder="Header Name" />
                      <Input
                        type={h.isSecret ? 'password' : 'text'}
                        value={h.value}
                        onChange={(e) => updateHeader(i, { value: e.target.value })}
                        placeholder={h.unchanged ? '•••••••••••• (unchanged — type to replace)' : 'Header Value'}
                        className="font-mono text-sm"
                      />
                      <label className="flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground">
                        <Switch checked={h.isSecret} onCheckedChange={(v) => updateHeader(i, { isSecret: v })} /> Secret
                      </label>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeHeader(i)}
                        className="text-red-600 hover:bg-red-500/10 hover:text-red-700"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
              <div>
                <CardTitle className="text-base">Query Parameters</CardTitle>
                <CardDescription>Appended to the URL as ?key=value. Values may use {'{{field}}'}.</CardDescription>
              </div>
              <Button size="sm" variant="outline" onClick={addParam}>
                <Plus className="mr-1.5 h-3.5 w-3.5" /> Add Param
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              {queryParams.length === 0 ? (
                <p className="px-5 py-6 text-sm text-muted-foreground">No query parameters configured.</p>
              ) : (
                <div className="divide-y">
                  {queryParams.map((p, i) => (
                    <div key={i} className="grid grid-cols-1 gap-2 px-5 py-3 sm:grid-cols-[1fr_1fr_auto] sm:items-center">
                      <Input value={p.key} onChange={(e) => updateParam(i, { key: e.target.value })} placeholder="Parameter Name" />
                      <Input
                        value={p.value}
                        onChange={(e) => updateParam(i, { value: e.target.value })}
                        placeholder="Parameter Value"
                        className="font-mono text-sm"
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeParam(i)}
                        className="text-red-600 hover:bg-red-500/10 hover:text-red-700"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {tab === 'body' && (
        <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
          <Card className="lg:sticky lg:top-5 lg:self-start">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Fields</CardTitle>
              <CardDescription>Click to insert at cursor.</CardDescription>
            </CardHeader>
            <CardContent className="max-h-[460px] space-y-4 overflow-y-auto p-3">
              {FIELD_GROUPS.map((group) => (
                <div key={group}>
                  <p className="mb-1.5 px-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {GROUP_LABEL[group]}
                  </p>
                  <div className="space-y-0.5">
                    {FIELD_CATALOG.filter((f) => f.group === group).map((f) => (
                      <button
                        key={f.key}
                        type="button"
                        onClick={() => insertField(f.key)}
                        className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted/60"
                      >
                        <span className="truncate">{f.label}</span>
                        {f.isArray && <span className="ml-1 shrink-0 text-[10px] text-muted-foreground">join()</span>}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              <div className="border-t pt-3">
                <p className="mb-1.5 px-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Helpers</p>
                <div className="space-y-1.5 px-2 text-[11px] text-muted-foreground">
                  {TEMPLATE_HELPERS.map((hp) => (
                    <div key={hp.syntax}>
                      <code className="rounded bg-muted px-1 py-0.5 font-mono">{hp.syntax}</code>
                      <p className="mt-0.5">{hp.description}</p>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* min-w-0: a `1fr` grid track has an auto minimum, so the wide
              code previews inside would otherwise stretch the whole page. */}
          <div className="min-w-0 space-y-4">
            <Card>
              <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-3">
                <div>
                  <CardTitle className="text-base">JSON Body Builder</CardTitle>
                  <CardDescription>Use {'{{field}}'} or {'{{helper(field)}}'} syntax.</CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      try {
                        setBodyTemplate(JSON.stringify(JSON.parse(bodyTemplate), null, 2));
                      } catch {
                        toast({ variant: 'destructive', title: 'Fix JSON errors before formatting' });
                      }
                    }}
                  >
                    Format
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => navigator.clipboard.writeText(bodyTemplate)}>
                    <Copy className="mr-1.5 h-3.5 w-3.5" /> Copy
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setBodyTemplate('{\n  \n}')}>
                    Clear
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                <textarea
                  ref={textareaRef}
                  value={bodyTemplate}
                  onChange={(e) => setBodyTemplate(e.target.value)}
                  spellCheck={false}
                  className="h-64 w-full resize-y rounded-lg border border-border bg-muted/20 p-3 font-mono text-xs leading-relaxed focus:bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  {bodyValid ? (
                    <span className="flex items-center gap-1 font-medium text-emerald-600">
                      <CheckCircle2 className="h-3.5 w-3.5" /> Valid JSON
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 font-medium text-red-600" title={rendered.error}>
                      <XCircle className="h-3.5 w-3.5" /> Invalid JSON
                    </span>
                  )}
                  <span className="text-muted-foreground">· {fieldsUsedCount} field{fieldsUsedCount !== 1 ? 's' : ''} used</span>
                  {method === 'GET' && <span className="text-amber-600">· Body is ignored for GET requests</span>}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-3">
                <div>
                  <CardTitle className="text-base">Live Preview</CardTitle>
                  <CardDescription>
                    Rendered against {dataSource === 'sample' ? 'sample data' : selectedLead ? selectedLead.name : 'a lead you pick below'}.
                  </CardDescription>
                </div>
                <div className="flex gap-1 rounded-lg border border-border bg-muted/30 p-1">
                  <button
                    type="button"
                    onClick={() => setDataSource('sample')}
                    className={cn('rounded-md px-2.5 py-1 text-xs font-medium', dataSource === 'sample' ? 'bg-background shadow-sm' : 'text-muted-foreground')}
                  >
                    Sample Data
                  </button>
                  <button
                    type="button"
                    onClick={() => setDataSource('lead')}
                    className={cn('rounded-md px-2.5 py-1 text-xs font-medium', dataSource === 'lead' ? 'bg-background shadow-sm' : 'text-muted-foreground')}
                  >
                    Real Lead
                  </button>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {dataSource === 'lead' && leadPickerBlock}
                <pre
                  className={cn(
                    'max-h-64 max-w-full overflow-auto rounded-lg border p-3 font-mono text-xs leading-relaxed',
                    rendered.valid ? 'border-border bg-muted/20' : 'border-red-300/50 bg-red-500/5 text-red-700 dark:text-red-400'
                  )}
                >
                  {rendered.output}
                </pre>
                {!rendered.valid && <p className="text-xs text-red-600">{rendered.error}</p>}
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {tab === 'test' && isEdit && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Test &amp; Send</CardTitle>
            <CardDescription className="flex items-start gap-1.5">
              <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
              This sends a real request to the configured endpoint — it is not a dry run.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex w-fit gap-1 rounded-lg border border-border bg-muted/30 p-1">
              <button
                type="button"
                onClick={() => setDataSource('sample')}
                className={cn('rounded-md px-3 py-1.5 text-xs font-medium', dataSource === 'sample' ? 'bg-background shadow-sm' : 'text-muted-foreground')}
              >
                Sample Data
              </button>
              <button
                type="button"
                onClick={() => setDataSource('lead')}
                className={cn('rounded-md px-3 py-1.5 text-xs font-medium', dataSource === 'lead' ? 'bg-background shadow-sm' : 'text-muted-foreground')}
              >
                Real Lead
              </button>
            </div>
            {dataSource === 'lead' && leadPickerBlock}

            <Button onClick={handleTestSend} disabled={testSending || (dataSource === 'lead' && !selectedLead)}>
              {testSending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1.5 h-3.5 w-3.5" />}
              Send Test Request
            </Button>

            {testResult && (
              <div
                className={cn(
                  'rounded-lg border p-4 text-sm',
                  testResult.success ? 'border-emerald-300/50 bg-emerald-500/5' : 'border-red-300/50 bg-red-500/5'
                )}
              >
                <p className="flex items-center gap-1.5 font-semibold">
                  {testResult.success ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <XCircle className="h-4 w-4 text-red-600" />}
                  {testResult.success
                    ? `Success — HTTP ${testResult.responseStatus}`
                    : testResult.errorMessage ?? `HTTP ${testResult.responseStatus ?? '—'}`}
                </p>
                {testResult.responseBody && (
                  <pre className="mt-2 max-h-56 max-w-full overflow-y-auto whitespace-pre-wrap break-all rounded-md bg-background/60 p-2 font-mono text-xs">{testResult.responseBody}</pre>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {tab === 'logs' && isEdit && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Push History</CardTitle>
            <CardDescription>Every automatic push, test send, and retry — success or failure.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="flex flex-wrap items-end gap-3 border-b border-border/60 px-5 py-3.5">
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">From</Label>
                <Input
                  type="date"
                  value={logsFrom}
                  onChange={(e) => {
                    setLogsFrom(e.target.value);
                    setLogsPage(1);
                  }}
                  className="h-9 w-[150px]"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">To</Label>
                <Input
                  type="date"
                  value={logsTo}
                  onChange={(e) => {
                    setLogsTo(e.target.value);
                    setLogsPage(1);
                  }}
                  className="h-9 w-[150px]"
                />
              </div>
              {(logsFrom || logsTo) && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setLogsFrom('');
                    setLogsTo('');
                    setLogsPage(1);
                  }}
                >
                  Clear
                </Button>
              )}
            </div>

            {logsLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : !logsData?.logs.length ? (
              <div className="flex flex-col items-center gap-2 py-12 text-center">
                <Webhook className="h-8 w-8 text-muted-foreground/30" />
                <p className="text-sm font-medium text-muted-foreground">
                  {logsFrom || logsTo ? 'No push attempts in this date range' : 'No push attempts yet'}
                </p>
              </div>
            ) : (
              <>
                <div className={cn('divide-y transition-opacity', logsFetching && 'opacity-60')}>
                  {logsData.logs.map((log) => (
                    <LogRowItem key={log.id} log={log} onRetry={() => handleRetry(log.id)} retrying={retryingId === log.id} />
                  ))}
                </div>
                <PaginationBar
                  page={logsPage}
                  totalPages={logsData.totalPages}
                  total={logsData.total}
                  limit={logsLimit}
                  onPageChange={setLogsPage}
                  onLimitChange={(l) => {
                    setLogsLimit(l);
                    setLogsPage(1);
                  }}
                  disabled={logsFetching}
                  className="px-5"
                />
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function LogRowItem({ log, onRetry, retrying }: { log: LogRow; onRetry: () => void; retrying: boolean }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="px-5 py-3.5">
      <button type="button" onClick={() => setExpanded((v) => !v)} className="flex w-full items-center justify-between gap-2 text-left">
        <div className="flex min-w-0 items-center gap-2">
          {log.success ? (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
          ) : (
            <XCircle className="h-4 w-4 shrink-0 text-red-600" />
          )}
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">
              {log.lead ? log.lead.name : 'Sample Data'}
              {log.isTest && (
                <span className="ml-1.5 rounded-full border border-border px-1.5 py-0 text-[10px] font-semibold text-muted-foreground">
                  TEST
                </span>
              )}
              {log.retryOfLogId && (
                <span className="ml-1.5 rounded-full border border-border px-1.5 py-0 text-[10px] font-semibold text-muted-foreground">
                  RETRY
                </span>
              )}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {formatDateTime(log.attemptedAt)} · {log.requestMethod} ·{' '}
              {log.responseStatus ? `HTTP ${log.responseStatus}` : log.errorMessage ?? 'No response'}
            </p>
          </div>
        </div>
        {expanded ? <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />}
      </button>
      {expanded && (
        <div className="mt-3 min-w-0 space-y-2 pl-6">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Request</p>
            {/* Wrap rather than scroll horizontally — request/response bodies are
                often one unbroken JSON line, which would otherwise size the
                `pre` to its content and stretch the page. */}
            <pre className="mt-1 max-h-40 max-w-full overflow-y-auto whitespace-pre-wrap break-all rounded-md bg-muted/30 p-2 font-mono text-[11px]">
              {log.requestUrl}
              {'\n\n'}
              {log.requestBody}
            </pre>
          </div>
          {(log.responseBody || log.errorMessage) && (
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Response</p>
              <pre className="mt-1 max-h-40 max-w-full overflow-y-auto whitespace-pre-wrap break-all rounded-md bg-muted/30 p-2 font-mono text-[11px]">
                {log.responseBody ?? log.errorMessage}
              </pre>
            </div>
          )}
          {!log.success && log.lead && (
            <Button size="sm" variant="outline" onClick={onRetry} disabled={retrying}>
              {retrying ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="mr-1.5 h-3.5 w-3.5" />}
              Retry
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
