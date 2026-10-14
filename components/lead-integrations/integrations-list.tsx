'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Webhook, Plus, Loader2, Trash2, CheckCircle2, XCircle, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useToast } from '@/components/ui/use-toast';
import { useUndoable } from '@/components/shared/use-undoable';
import { PinGate } from '@/components/shared/pin-gate';
import { PIN_GATED_ACTIONS } from '@/lib/pin-gated-actions';
import { cn, formatDateTime } from '@/lib/utils';

interface LeadIntegrationRow {
  id: string;
  name: string;
  url: string;
  method: string;
  trigger: string;
  isActive: boolean;
  createdBy: { name: string };
  createdAt: string;
  lastPush: { success: boolean; attemptedAt: string; isTest: boolean } | null;
}

const TRIGGER_LABELS: Record<string, string> = {
  REFERRAL_CREATED: 'Referral Lead Created',
  RECORDING_RECEIVED: 'Call Recording Received',
};

/**
 * The two kinds this screen can show.
 *
 * Each has its own ROUTE rather than a ?kind= query param. The sidebar matches
 * the active entry on `pathname`, which excludes the query string — so a param
 * could never highlight Webhooks and would always highlight Lead Integrations,
 * making the right page look like the wrong one. A distinct path fixes the
 * highlight, the title and the browser history in one go.
 */
export type IntegrationKind = 'recording' | 'referral';

const KIND_TRIGGER: Record<IntegrationKind, string> = {
  recording: 'RECORDING_RECEIVED',
  referral: 'REFERRAL_CREATED',
};

const KIND_COPY: Record<IntegrationKind, { title: string; blurb: string; listBlurb: string; empty: string }> = {
  recording: {
    title: 'Webhooks',
    blurb:
      'Send call recordings to an external system as they arrive — pick the endpoint, the authentication and exactly which call, lead and agent fields to include.',
    listBlurb: 'Fires for every call recording the dialer stores, including calls that match no lead.',
    empty: 'No webhooks yet.',
  },
  referral: {
    title: 'Lead Integrations',
    blurb:
      'Push referral leads to an external system (like your LMS) over HTTP — configure the endpoint, headers and field mapping.',
    listBlurb: 'Fires when a counsellor captures a referral, or submits college preferences.',
    empty: 'No integrations yet.',
  },
};

export function IntegrationsListPage({ kind }: { kind: IntegrationKind }) {
  return (
    // Both kinds sit behind the same PIN gate: they are the same capability —
    // sending CRM data to a third party — and unlocking one should not leave
    // the other open.
    <PinGate action={PIN_GATED_ACTIONS.LEAD_INTEGRATIONS} title={KIND_COPY[kind].title}>
      <LeadIntegrationsContent kind={kind} />
    </PinGate>
  );
}

function LeadIntegrationsContent({ kind }: { kind: IntegrationKind }) {
  const copy = KIND_COPY[kind];
  const kindTrigger = KIND_TRIGGER[kind];
  const qc = useQueryClient();
  const { toast } = useToast();
  const undoable = useUndoable();
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());

  const { data: integrations = [], isLoading } = useQuery<LeadIntegrationRow[]>({
    queryKey: ['lead-integrations'],
    queryFn: () => fetch('/api/super-admin/lead-integrations').then((r) => r.json()).then((d) => (Array.isArray(d) ? d : [])),
  });

  // Narrowed by ?kind when present — see KIND_TRIGGER.
  const visible = integrations.filter(
    (i) => !hiddenIds.has(i.id) && (!kindTrigger || i.trigger === kindTrigger),
  );

  function deleteIntegration(integration: LeadIntegrationRow) {
    setHiddenIds((s) => new Set(s).add(integration.id));
    undoable({
      title: `Deleted "${integration.name}"`,
      description: 'This integration and its push history will be permanently removed.',
      onExecute: async () => {
        try {
          const r = await fetch(`/api/super-admin/lead-integrations/${integration.id}`, { method: 'DELETE' });
          if (!r.ok) throw new Error('Failed to delete integration');
          qc.invalidateQueries({ queryKey: ['lead-integrations'] });
        } catch {
          setHiddenIds((s) => { const n = new Set(s); n.delete(integration.id); return n; });
          toast({ variant: 'destructive', title: 'Delete failed', description: 'Please try again.' });
        }
      },
      onUndo: () => setHiddenIds((s) => { const n = new Set(s); n.delete(integration.id); return n; }),
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl sm:text-2xl font-bold">
            <Webhook className="h-5 w-5 sm:h-6 sm:w-6 text-primary" /> {copy.title}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{copy.blurb}</p>
        </div>
        <Button asChild className="w-full sm:w-auto shrink-0">
          <Link href={`/dashboard/super-admin/configurations/lead-integrations/new?kind=${kind}`}>
            <Plus className="mr-2 h-4 w-4" /> New Integration
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Configured integrations</CardTitle>
          <CardDescription>
            {copy.listBlurb}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : visible.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <Webhook className="h-8 w-8 text-muted-foreground/30" />
              <p className="text-sm font-medium text-muted-foreground">{copy.empty}</p>
              <p className="text-xs text-muted-foreground/70">Create one to start pushing referral leads to an external system.</p>
            </div>
          ) : (
            <div className="divide-y">
              {visible.map((i) => (
                <Link
                  key={i.id}
                  href={`/dashboard/super-admin/configurations/lead-integrations/${i.id}`}
                  className="flex flex-col gap-2 px-5 py-3.5 transition-colors hover:bg-muted/30 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium truncate">{i.name}</p>
                      <span
                        className={cn(
                          'rounded-full border px-2 py-0.5 text-[10px] font-bold',
                          i.isActive
                            ? 'border-emerald-300/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                            : 'border-border bg-muted text-muted-foreground'
                        )}
                      >
                        {i.isActive ? 'Active' : 'Inactive'}
                      </span>
                      <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                        {TRIGGER_LABELS[i.trigger] ?? i.trigger}
                      </span>
                    </div>
                    <p className="mt-0.5 font-mono text-[11px] text-muted-foreground truncate">
                      {i.method} {i.url}
                    </p>
                    <p className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      Created by {i.createdBy.name} · {formatDateTime(i.createdAt)}
                      {i.lastPush && (
                        <>
                          {' '}
                          ·{' '}
                          {i.lastPush.success ? (
                            <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                          ) : (
                            <XCircle className="h-3 w-3 text-red-600" />
                          )}
                          Last push {formatDateTime(i.lastPush.attemptedAt)}
                          {i.lastPush.isTest ? ' (test)' : ''}
                        </>
                      )}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full sm:w-auto shrink-0 border-red-300/60 text-red-700 hover:bg-red-500/10 dark:text-red-400"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      deleteIntegration(i);
                    }}
                  >
                    <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Delete
                  </Button>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-border/60 bg-muted/20">
        <CardContent className="flex items-start gap-3 py-4 text-xs text-muted-foreground">
          <ShieldAlert className="h-4 w-4 shrink-0 text-amber-500" />
          <p>
            New integrations start Inactive. Use Test &amp; Send to verify the endpoint, headers, and field mapping
            before turning one on — once active, every matching lead is pushed automatically.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
