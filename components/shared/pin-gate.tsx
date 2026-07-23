'use client';

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { Loader2, ShieldCheck, ShieldAlert, Lock, LockOpen, KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { PinInput } from '@/components/shared/pin-input';
import type { PinGatedAction } from '@/lib/pin-gated-actions';

interface GateStatus {
  pinConfigured: boolean;
  unlocked: boolean;
  expiresAt: string | null;
  lockedUntil: string | null;
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

function useCountdown(targetIso: string | null) {
  const [label, setLabel] = useState('');
  useEffect(() => {
    if (!targetIso) { setLabel(''); return; }
    const tick = () => {
      const ms = new Date(targetIso).getTime() - Date.now();
      if (ms <= 0) { setLabel('now'); return; }
      const mins = Math.floor(ms / 60_000);
      const secs = Math.floor((ms % 60_000) / 1000);
      setLabel(mins > 0 ? `${mins}m ${secs}s` : `${secs}s`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [targetIso]);
  return label;
}

/** Wraps a sensitive Super Admin tool behind a 6-digit security PIN. The
 * frontend prompt below is UX only — the actual protected API routes
 * independently check isActionUnlocked() server-side, so this can never be
 * bypassed by calling the API directly. */
export function PinGate({
  action,
  title,
  children,
}: {
  action: PinGatedAction;
  title: string;
  children: React.ReactNode;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [pin, setPin] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: status, isLoading } = useQuery<GateStatus>({
    queryKey: ['pin-gate-status', action],
    queryFn: () => fetch(`/api/super-admin/security-pin/gate?action=${action}`).then((r) => r.json()),
    // Poll slowly while unlocked so an expiring window re-locks the UI on
    // its own, and faster while locked so a lockout countdown clears itself.
    refetchInterval: (query) => (query.state.data?.unlocked ? 60_000 : 5000),
  });

  const lockedCountdown = useCountdown(status?.lockedUntil ?? null);

  async function submitPin(value: string) {
    if (value.length !== 6 || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const r = await fetch('/api/super-admin/security-pin/gate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, pin: value }),
      });
      const json = await r.json();
      if (!json.success) {
        if (json.code === 'LOCKED') setError('Too many incorrect attempts — locked temporarily.');
        else if (json.code === 'WRONG') setError(`Incorrect PIN — ${json.attemptsRemaining} attempt${json.attemptsRemaining === 1 ? '' : 's'} remaining.`);
        else setError(json.error ?? 'Could not verify PIN');
        setPin('');
        qc.invalidateQueries({ queryKey: ['pin-gate-status', action] });
        return;
      }
      setPin('');
      qc.invalidateQueries({ queryKey: ['pin-gate-status', action] });
    } catch {
      setError('Something went wrong — please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function lockNow() {
    await fetch('/api/super-admin/security-pin/gate', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    toast({ title: `${title} locked` });
    qc.invalidateQueries({ queryKey: ['pin-gate-status', action] });
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!status?.pinConfigured) {
    return (
      <div className="mx-auto max-w-md rounded-2xl border border-amber-300/50 bg-amber-500/5 p-8 text-center">
        <ShieldAlert className="mx-auto mb-3 h-8 w-8 text-amber-600" />
        <h2 className="text-base font-semibold">Security PIN required</h2>
        <p className="mt-1.5 text-sm text-muted-foreground">
          {title} is protected by a 6-digit security PIN. You haven&apos;t set one up yet —
          set it from your profile page to continue.
        </p>
        <Button asChild className="mt-5">
          <Link href="/dashboard/profile#security-pin">
            <KeyRound className="mr-1.5 h-4 w-4" /> Set up Security PIN
          </Link>
        </Button>
      </div>
    );
  }

  if (status.lockedUntil) {
    return (
      <div className="mx-auto max-w-md rounded-2xl border border-red-300/50 bg-red-500/5 p-8 text-center">
        <Lock className="mx-auto mb-3 h-8 w-8 text-red-600" />
        <h2 className="text-base font-semibold">PIN entry temporarily locked</h2>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Too many incorrect attempts. Try again in <strong>{lockedCountdown}</strong>.
        </p>
      </div>
    );
  }

  if (!status.unlocked) {
    return (
      <div className="mx-auto max-w-sm rounded-2xl border border-border/60 bg-card p-8 text-center shadow-sm">
        <ShieldCheck className="mx-auto mb-3 h-8 w-8 text-primary" />
        <h2 className="text-base font-semibold">Enter your Security PIN</h2>
        <p className="mt-1.5 text-sm text-muted-foreground">{title} is PIN-protected. Enter your 6-digit PIN to continue.</p>
        <div className="mt-5">
          <PinInput value={pin} onChange={setPin} onComplete={submitPin} disabled={submitting} error={!!error} autoFocus />
        </div>
        {error && <p className="mt-3 text-xs font-medium text-destructive">{error}</p>}
        <Button className="mt-5 w-full" disabled={pin.length !== 6 || submitting} onClick={() => submitPin(pin)}>
          {submitting ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <LockOpen className="mr-1.5 h-4 w-4" />}
          Unlock
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-300/50 bg-emerald-500/5 px-3.5 py-2 text-xs text-emerald-700 dark:text-emerald-400">
        <span className="inline-flex items-center gap-1.5">
          <LockOpen className="h-3.5 w-3.5" /> Unlocked{status.expiresAt ? ` until ${formatTime(status.expiresAt)}` : ''}
        </span>
        <button onClick={lockNow} className="inline-flex items-center gap-1 font-semibold hover:underline">
          <Lock className="h-3 w-3" /> Lock now
        </button>
      </div>
      {children}
    </div>
  );
}
