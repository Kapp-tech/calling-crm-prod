'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  KeyRound, Plus, Loader2, Copy, Check, Ban, ShieldAlert, Webhook,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { useUndoable } from '@/components/shared/use-undoable';
import { cn, formatDateTime } from '@/lib/utils';

interface ApiKeyRow {
  id: string;
  name: string;
  keyPrefix: string;
  isActive: boolean;
  lastUsedAt: string | null;
  createdAt: string;
  revokedAt: string | null;
  createdBy: { id: string; name: string };
  _count: { leads: number };
}

function timeAgo(iso: string | null): string {
  if (!iso) return 'Never';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'Just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function ApiKeysPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const undoable = useUndoable();

  const [createOpen, setCreateOpen] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [creating, setCreating] = useState(false);
  const [mintedKey, setMintedKey] = useState<{ name: string; rawKey: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());

  const { data: keys = [], isLoading } = useQuery<ApiKeyRow[]>({
    queryKey: ['api-keys'],
    queryFn: () => fetch('/api/super-admin/api-keys').then((r) => r.json()).then((d) => Array.isArray(d) ? d : []),
  });

  const visibleKeys = keys.filter((k) => !hiddenIds.has(k.id));

  async function handleCreate() {
    if (newKeyName.trim().length < 2) return;
    setCreating(true);
    try {
      const r = await fetch('/api/super-admin/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newKeyName.trim() }),
      });
      const json = await r.json();
      if (!r.ok) throw new Error(typeof json?.error === 'string' ? json.error : 'Failed to create key');
      setMintedKey({ name: json.name, rawKey: json.rawKey });
      setCreateOpen(false);
      setNewKeyName('');
      qc.invalidateQueries({ queryKey: ['api-keys'] });
    } catch (err) {
      toast({ variant: 'destructive', title: 'Failed to create key', description: err instanceof Error ? err.message : undefined });
    } finally {
      setCreating(false);
    }
  }

  function copyKey(text: string) {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function revokeKey(key: ApiKeyRow) {
    setHiddenIds((s) => new Set(s).add(key.id));
    undoable({
      title: `Revoked "${key.name}"`,
      description: 'This key will stop working immediately.',
      onExecute: async () => {
        try {
          const r = await fetch(`/api/super-admin/api-keys/${key.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'REVOKE' }),
          });
          if (!r.ok) throw new Error('Failed to revoke key');
          qc.invalidateQueries({ queryKey: ['api-keys'] });
        } catch {
          setHiddenIds((s) => { const n = new Set(s); n.delete(key.id); return n; });
          toast({ variant: 'destructive', title: 'Revoke failed', description: 'Please try again.' });
        }
      },
      onUndo: () => setHiddenIds((s) => { const n = new Set(s); n.delete(key.id); return n; }),
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl sm:text-2xl font-bold">
            <Webhook className="h-5 w-5 sm:h-6 sm:w-6 text-primary" /> API Keys
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Credentials for external systems pushing leads into this CRM via the Lead Ingestion API.
            New leads skip Lead Approvals and land directly in Unassigned Leads on the Assign Leads page.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="w-full sm:w-auto shrink-0">
          <Plus className="mr-2 h-4 w-4" /> Generate New Key
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Integration credentials</CardTitle>
          <CardDescription>
            Each key is shown in full only once, right after you create it. After that, only this prefix is displayed.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : visibleKeys.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <KeyRound className="h-8 w-8 text-muted-foreground/30" />
              <p className="text-sm font-medium text-muted-foreground">No API keys yet</p>
              <p className="text-xs text-muted-foreground/70">Generate one to let an external system push leads in.</p>
            </div>
          ) : (
            <div className="divide-y">
              {visibleKeys.map((k) => (
                <div key={k.id} className="flex flex-col gap-2 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium truncate">{k.name}</p>
                      <span
                        className={cn(
                          'rounded-full border px-2 py-0.5 text-[10px] font-bold',
                          k.isActive
                            ? 'border-emerald-300/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                            : 'border-red-300/50 bg-red-500/10 text-red-700 dark:text-red-400',
                        )}
                      >
                        {k.isActive ? 'Active' : 'Revoked'}
                      </span>
                    </div>
                    <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                      {k.keyPrefix}{'•'.repeat(24)}
                    </p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Created by {k.createdBy.name} · {formatDateTime(k.createdAt)} · Last used {timeAgo(k.lastUsedAt)} · {k._count.leads} lead{k._count.leads !== 1 ? 's' : ''} created
                    </p>
                  </div>
                  {k.isActive && (
                    <Button
                      variant="outline" size="sm"
                      className="w-full sm:w-auto shrink-0 border-red-300/60 text-red-700 hover:bg-red-500/10 dark:text-red-400"
                      onClick={() => revokeKey(k)}
                    >
                      <Ban className="mr-1.5 h-3.5 w-3.5" /> Revoke
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-border/60 bg-muted/20">
        <CardContent className="flex items-start gap-3 py-4 text-xs text-muted-foreground">
          <ShieldAlert className="h-4 w-4 shrink-0 text-amber-500" />
          <p>
            Treat these keys like passwords — anyone with a valid key can create leads in this CRM.
            Share a key only through a secure channel, use a separate key per integration so you can
            revoke one without affecting others, and revoke immediately if a key is ever exposed.
          </p>
        </CardContent>
      </Card>

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={(v) => { setCreateOpen(v); if (!v) setNewKeyName(''); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Generate API Key</DialogTitle>
            <DialogDescription>Give it a name so you can identify this integration later.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5 py-2">
            <Label>Name</Label>
            <Input
              autoFocus
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              placeholder="e.g. Partner LMS — Referral Leads"
              onKeyDown={(e) => { if (e.key === 'Enter' && newKeyName.trim().length >= 2) handleCreate(); }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button disabled={newKeyName.trim().length < 2 || creating} onClick={handleCreate}>
              {creating && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Generate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* One-time reveal dialog */}
      <Dialog open={!!mintedKey} onOpenChange={(v) => { if (!v) setMintedKey(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-primary" /> {mintedKey?.name}
            </DialogTitle>
            <DialogDescription>
              Copy this key now — for your security, it will never be shown again. If you lose it,
              revoke this one and generate a new key.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2.5">
            <code className="flex-1 overflow-x-auto whitespace-nowrap font-mono text-xs">{mintedKey?.rawKey}</code>
            <button
              type="button"
              onClick={() => mintedKey && copyKey(mintedKey.rawKey)}
              className="flex shrink-0 items-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <DialogFooter>
            <Button onClick={() => setMintedKey(null)}>Done — I&apos;ve saved it</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
