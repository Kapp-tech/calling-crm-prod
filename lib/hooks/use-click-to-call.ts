'use client';

import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useToast } from '@/components/ui/use-toast';

/**
 * Click-to-call against the DialShree dialer.
 *
 * The dialer rings the agent's own softphone first and bridges the lead in, so
 * "on call" here means "we asked the dialer to connect" — not that the lead
 * picked up. The CRM gets no call-progress events back, which is why the state
 * is a plain boolean and the agent ends the call themselves.
 *
 * Shared by the All Leads drawer and the lead profile page: both need the same
 * behaviour, and two copies of it would drift the moment one is fixed.
 *
 * `leadId` is nullable because the drawer mounts before a lead is chosen; with
 * no lead there is nothing to dial and the mutations refuse to fire.
 */
export function useClickToCall(leadId: string | null) {
  const { toast } = useToast();

  const [onCall, setOnCall] = useState(false);
  /** Whatever handle the dial response carried, echoed back on hangup. */
  const [callRef, setCallRef] = useState<string | undefined>();

  const callMutation = useMutation({
    mutationFn: async () => {
      if (!leadId) throw new Error('No lead selected');
      const r = await fetch('/api/dialer/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId }),
      });
      const json = await r.json();
      if (!r.ok || !json.success) throw new Error(json.error || 'Could not place the call');
      return json;
    },
    onSuccess: (json) => {
      setOnCall(true);
      const ref = json?.result?.call_id ?? json?.result?.data?.call_id ?? json?.result?.value;
      setCallRef(ref != null ? String(ref) : undefined);
      toast({ title: 'Calling…', description: 'Answer your dialer to connect to the lead.' });
    },
    onError: (err: Error) => toast({ title: 'Call failed', description: err.message, variant: 'destructive' }),
  });

  const hangupMutation = useMutation({
    mutationFn: async () => {
      if (!leadId) throw new Error('No lead selected');
      const r = await fetch('/api/dialer/hangup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId, value: callRef }),
      });
      const json = await r.json();
      if (!r.ok || !json.success) throw new Error(json.error || 'Could not end the call');
      return json;
    },
    // Either way the agent is done with this call — never strand them on a
    // Disconnect button that cannot be cleared.
    onSettled: () => {
      setOnCall(false);
      setCallRef(undefined);
    },
    onError: (err: Error) => toast({ title: 'Hangup failed', description: err.message, variant: 'destructive' }),
  });

  // Switching to another lead must not leave the previous one showing "on call".
  useEffect(() => {
    setOnCall(false);
    setCallRef(undefined);
  }, [leadId]);

  return {
    onCall,
    isDialing: callMutation.isPending,
    isHangingUp: hangupMutation.isPending,
    call: () => callMutation.mutate(),
    hangup: () => hangupMutation.mutate(),
  };
}
