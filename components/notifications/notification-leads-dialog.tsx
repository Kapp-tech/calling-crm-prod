'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { failIfAttendanceBlock, isAttendanceError } from '@/lib/attendance-required';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';
import { triggerCelebration, isCelebrationFeedback } from '@/lib/celebrate';
import {
  MapPin, BookOpen, MessageSquarePlus, Loader2, CheckCircle2,
  ChevronRight, X, Phone,
} from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

interface NotificationLead {
  id: string;
  name: string;
  phone: string;
  city: string | null;
  course: string | null;
  campaign: string | null;
  status: string;
  currentFeedbackOptionId: string | null;
  _count: { feedbacks: number };
  feedbacks: {
    feedbackOption: { id: string; label: string } | null;
    remarks: string | null;
    createdAt: string;
  }[];
}

interface FeedbackOption { id: string; label: string }

const feedbackSchema = z.object({
  feedbackOptionId: z.string().min(1, 'Select a feedback option'),
  remarks: z.string().trim().min(1, 'Remarks are required').max(1000),
});
type FeedbackForm = z.infer<typeof feedbackSchema>;

// ─── Inline feedback form ─────────────────────────────────────────────────────

function FeedbackForm({
  lead,
  onClose,
  onSuccess,
}: {
  lead: NotificationLead;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: feedbackOptions = [] } = useQuery<FeedbackOption[]>({
    queryKey: ['feedback-options'],
    queryFn: () => fetch('/api/feedback-options').then((r) => r.json()),
    staleTime: 10 * 60 * 1000,
  });

  const { register, handleSubmit, formState: { errors } } = useForm<FeedbackForm>({
    resolver: zodResolver(feedbackSchema),
  });

  const mutation = useMutation({
    mutationFn: (data: FeedbackForm) =>
      fetch(`/api/leads/${lead.id}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }).then(async (r) => {
        const json = await r.json();
        if (json.error) {
          failIfAttendanceBlock(json);
          throw new Error(typeof json.error === 'string' ? json.error : 'Failed to save');
        }
        return json;
      }),
    onSuccess: (_, variables) => {
      const label = feedbackOptions.find((o) => o.id === variables.feedbackOptionId)?.label ?? '';
      if (isCelebrationFeedback(label)) triggerCelebration();
      toast({ title: 'Feedback submitted!' });
      qc.invalidateQueries({ queryKey: ['my-leads'] });
      onSuccess();
    },
    onError: (err: Error) => {
      // The check-in dialog is already open and says it better than a toast.
      if (isAttendanceError(err)) return;
      toast({ variant: 'destructive', title: 'Error', description: err.message });
    },
  });

  return (
    <form onSubmit={handleSubmit((d) => mutation.mutate(d))} className="space-y-3 pt-2">
      <div>
        <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Feedback *</label>
        <select
          {...register('feedbackOptionId')}
          className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="">Select feedback…</option>
          {feedbackOptions.map((o) => (
            <option key={o.id} value={o.id}>{o.label}</option>
          ))}
        </select>
        {errors.feedbackOptionId && (
          <p className="text-xs text-destructive mt-1">{errors.feedbackOptionId.message}</p>
        )}
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Remarks <span className="text-destructive">*</span></label>
        <textarea
          {...register('remarks')}
          rows={2}
          placeholder="Describe the conversation outcome…"
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-ring"
        />
        {errors.remarks && (
          <p className="text-xs text-destructive mt-1">{errors.remarks.message}</p>
        )}
      </div>

      <div className="flex items-center gap-2 pt-1">
        <Button type="submit" size="sm" disabled={mutation.isPending} className="flex-1">
          {mutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
          Submit
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onClose}>Cancel</Button>
      </div>
    </form>
  );
}

// ─── Lead row ────────────────────────────────────────────────────────────────

function LeadRow({ lead }: { lead: NotificationLead }) {
  const [showForm, setShowForm] = useState(false);
  const lastFeedback = lead.feedbacks[0];
  const followUpsDone = lead._count.feedbacks;

  return (
    <div className={cn(
      'rounded-xl border border-border/60 p-4 space-y-3 transition-colors',
      showForm ? 'bg-muted/30' : 'bg-card hover:bg-muted/20'
    )}>
      {/* Lead info */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-sm text-foreground truncate">{lead.name}</p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1">
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Phone className="h-3 w-3" /> {lead.phone}
            </span>
            {lead.city && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <MapPin className="h-3 w-3" /> {lead.city}
              </span>
            )}
            {lead.course && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <BookOpen className="h-3 w-3" /> {lead.course}
              </span>
            )}
          </div>
        </div>

        {/* Follow-up badge */}
        <span className={cn(
          'text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0',
          followUpsDone === 0
            ? 'bg-red-500/10 text-red-500'
            : 'bg-emerald-500/10 text-emerald-600'
        )}>
          {followUpsDone} follow-up{followUpsDone === 1 ? '' : 's'}
        </span>
      </div>

      {/* Last feedback badge */}
      {lastFeedback?.feedbackOption && (
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
          <span className="text-xs text-muted-foreground">Last:</span>
          <span className="text-xs font-medium bg-primary/10 text-primary px-2 py-0.5 rounded-full">
            {lastFeedback.feedbackOption.label}
          </span>
        </div>
      )}

      {/* Action */}
      {!showForm ? (
        <button
          onClick={() => setShowForm(true)}
          className="w-full flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition-colors bg-primary/10 text-primary hover:bg-primary/20"
        >
          <MessageSquarePlus className="h-3.5 w-3.5" />
          Give Feedback
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      ) : (
        <FeedbackForm
          lead={lead}
          onClose={() => setShowForm(false)}
          onSuccess={() => setShowForm(false)}
        />
      )}
    </div>
  );
}

// ─── Main dialog ──────────────────────────────────────────────────────────────

interface Props {
  notificationId: string | null;
  title: string;
  onClose: () => void;
}

export function NotificationLeadsDialog({ notificationId, title, onClose }: Props) {
  const open = !!notificationId;

  const { data: leads, isLoading } = useQuery<NotificationLead[]>({
    queryKey: ['notification-leads', notificationId],
    queryFn: () =>
      fetch(`/api/notifications/${notificationId}/leads`).then((r) => r.json()),
    enabled: open,
    staleTime: 0,
  });

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[85vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-5 py-4 border-b border-border/60 shrink-0">
          <div className="flex items-start justify-between gap-3">
            <div>
              <DialogTitle className="text-base">{title}</DialogTitle>
              {!isLoading && Array.isArray(leads) && (
                <p className="text-sm text-muted-foreground mt-0.5">
                  {leads.length} lead{leads.length !== 1 ? 's' : ''} assigned
                </p>
              )}
            </div>
            <button
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground transition-colors shrink-0 mt-0.5"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="rounded-xl border border-border/60 p-4 space-y-2">
                  <div className="h-4 w-40 rounded bg-muted animate-pulse" />
                  <div className="h-3 w-56 rounded bg-muted animate-pulse" />
                  <div className="h-8 w-full rounded-lg bg-muted animate-pulse" />
                </div>
              ))}
            </div>
          ) : !leads?.length ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <MessageSquarePlus className="h-10 w-10 text-muted-foreground/20" />
              <p className="text-sm font-medium text-muted-foreground">No leads found</p>
              <p className="text-xs text-muted-foreground/60">
                The leads from this notification may have been reassigned.
              </p>
            </div>
          ) : (
            leads.map((lead) => <LeadRow key={lead.id} lead={lead} />)
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
