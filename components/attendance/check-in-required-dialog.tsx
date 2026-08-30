'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlarmClock, Loader2 } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { onAttendanceRequired } from '@/lib/attendance-required';

/**
 * "Check in first" — shown when an agent tries to call or log a follow-up
 * before marking attendance.
 *
 * Mounted once in the dashboard shell and driven by the small channel in
 * lib/attendance-required, so the four places that call or log a follow-up need
 * one line each rather than their own copy of this.
 *
 * It offers the check-in rather than only refusing: the agent's next action is
 * always "punch in", so making them go and find the clock is a step for
 * nothing. On success the punch-clock widget is invalidated so the topbar stops
 * saying "Not Punched In", and they can retry immediately.
 */
export function CheckInRequiredDialog() {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();

  useEffect(() => onAttendanceRequired(() => setOpen(true)), []);

  const punchIn = useMutation({
    mutationFn: async () => {
      const r = await fetch('/api/attendance/punch-in', { method: 'POST' });
      const json = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(json?.error ?? 'Could not check you in');
      return json;
    },
    onSuccess: () => {
      // The key the punch-clock widget reads, so the topbar stops saying
      // "Not Punched In" the moment this succeeds.
      qc.invalidateQueries({ queryKey: ['attendance-me'] });
      setOpen(false);
      toast({ title: 'Checked in', description: 'You are on the clock. Go ahead and place the call.' });
    },
    onError: (err: Error) =>
      toast({ title: 'Could not check you in', description: err.message, variant: 'destructive' }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlarmClock className="h-4 w-4 text-amber-500" />
            Check in first
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          You have not marked your attendance today, so calling and logging follow-ups are
          paused. Check in and carry on — nothing you were doing is lost.
        </p>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => setOpen(false)} disabled={punchIn.isPending}>
            Not now
          </Button>
          <Button onClick={() => punchIn.mutate()} disabled={punchIn.isPending} className="gap-1.5">
            {punchIn.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Check in now
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
