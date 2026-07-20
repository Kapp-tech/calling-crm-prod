'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  ArrowLeft, Loader2, MessageSquarePlus, Phone, MapPin,
  BookOpen, Megaphone, CheckCircle2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { useToast } from '@/components/ui/use-toast';
import { triggerCelebration, isCelebrationFeedback } from '@/lib/celebrate';
import { LeadDetailDrawer } from '@/components/leads/lead-detail-drawer';

// ─── Types ────────────────────────────────────────────────────────────────────

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
  feedbackOptionId: z.string().min(1, 'Please select a feedback option'),
  remarks: z.string().trim().min(1, 'Remarks are required').max(1000),
});
type FeedbackForm = z.infer<typeof feedbackSchema>;

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function NotificationLeadsPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [feedbackLead, setFeedbackLead] = useState<NotificationLead | null>(null);
  const [drawerLead, setDrawerLead] = useState<NotificationLead | null>(null);

  const { register, handleSubmit, reset, setValue, formState: { errors } } = useForm<FeedbackForm>({
    resolver: zodResolver(feedbackSchema),
  });

  const { data: leads, isLoading, error } = useQuery<NotificationLead[]>({
    queryKey: ['notification-leads', id],
    queryFn: () => fetch(`/api/notifications/${id}/leads`).then((r) => r.json()),
    staleTime: 0,
  });

  const { data: feedbackOptions = [] } = useQuery<FeedbackOption[]>({
    queryKey: ['feedback-options'],
    queryFn: () => fetch('/api/feedback-options').then((r) => r.json()),
    staleTime: 10 * 60 * 1000,
  });

  const submitMutation = useMutation({
    mutationFn: ({ leadId, data }: { leadId: string; data: FeedbackForm }) =>
      fetch(`/api/leads/${leadId}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }).then(async (r) => {
        const json = await r.json();
        if (json.error) throw new Error(typeof json.error === 'string' ? json.error : 'Failed');
        return json;
      }),
    onSuccess: (_, variables) => {
      const label = feedbackOptions.find((o) => o.id === variables.data.feedbackOptionId)?.label ?? '';
      if (isCelebrationFeedback(label)) triggerCelebration();
      toast({ title: 'Feedback submitted!' });
      qc.invalidateQueries({ queryKey: ['notification-leads', id] });
      qc.invalidateQueries({ queryKey: ['my-leads'] });
      setFeedbackLead(null);
      reset();
    },
    onError: (err: Error) => {
      toast({ variant: 'destructive', title: 'Error', description: err.message });
    },
  });

  const onSubmit = (data: FeedbackForm) => {
    if (!feedbackLead) return;
    submitMutation.mutate({ leadId: feedbackLead.id, data });
  };

  const isError = error || (Array.isArray(leads) === false && !isLoading);
  const leadsArr: NotificationLead[] = Array.isArray(leads) ? leads : [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push('/dashboard/notifications')}
          className="gap-1.5 text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Notifications
        </Button>
      </div>

      <div>
        <h1 className="text-xl font-bold">Assigned Leads</h1>
        {!isLoading && (
          <p className="mt-0.5 text-sm text-muted-foreground">
            {leadsArr.length} lead{leadsArr.length !== 1 ? 's' : ''} assigned in this notification
          </p>
        )}
      </div>

      {/* Leads table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : isError ? (
            <div className="py-16 text-center text-sm text-muted-foreground">
              Could not load leads for this notification.
            </div>
          ) : leadsArr.length === 0 ? (
            <div className="py-16 text-center">
              <MessageSquarePlus className="mx-auto h-10 w-10 text-muted-foreground/20 mb-3" />
              <p className="text-sm font-medium text-muted-foreground">No leads found</p>
              <p className="mt-1 text-xs text-muted-foreground/60">
                The leads from this notification may have been reassigned.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>City</TableHead>
                  <TableHead>Course</TableHead>
                  <TableHead>Lead Code</TableHead>
                  <TableHead>Last Feedback</TableHead>
                  <TableHead>Follow-ups</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {leadsArr.map((lead) => {
                  const followUpsDone = lead._count.feedbacks;
                  const lastFeedback = lead.feedbacks[0];

                  return (
                    <TableRow key={lead.id}>
                      <TableCell
                        className="font-medium cursor-pointer hover:text-primary"
                        onClick={() => setDrawerLead(lead)}
                      >
                        {lead.name}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Phone className="h-3 w-3" /> {lead.phone}
                        </span>
                      </TableCell>
                      <TableCell>
                        {lead.city ? (
                          <span className="flex items-center gap-1 text-sm">
                            <MapPin className="h-3 w-3 text-muted-foreground" /> {lead.city}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {lead.course ? (
                          <span className="flex items-center gap-1 text-sm">
                            <BookOpen className="h-3 w-3 text-muted-foreground" /> {lead.course}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {lead.campaign ? (
                          <span className="flex items-center gap-1 text-sm">
                            <Megaphone className="h-3 w-3 text-muted-foreground" /> {lead.campaign}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {lastFeedback?.feedbackOption ? (
                          <Badge variant="secondary" className="flex items-center gap-1 w-fit">
                            <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                            {lastFeedback.feedbackOption.label}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">No calls yet</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          {Array.from({ length: Math.min(followUpsDone, 5) }).map((_, i) => (
                            <div key={i} className="h-2 w-4 rounded-sm bg-primary" />
                          ))}
                          <span className="ml-1 text-xs text-muted-foreground">{followUpsDone} follow-up{followUpsDone === 1 ? '' : 's'}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          onClick={() => { setFeedbackLead(lead); reset(); }}
                        >
                          <MessageSquarePlus className="mr-1 h-3 w-3" /> Feedback
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Feedback Dialog */}
      <Dialog open={!!feedbackLead} onOpenChange={(v) => { if (!v) { setFeedbackLead(null); reset(); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              Submit Feedback — {feedbackLead?.name}
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                (Follow-up #{(feedbackLead?._count.feedbacks ?? 0) + 1}/5)
              </span>
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label>Feedback Option <span className="text-destructive">*</span></Label>
              {feedbackOptions.length === 0 ? (
                <p className="text-xs text-destructive">No feedback options configured.</p>
              ) : (
                <select
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  defaultValue=""
                  onChange={(e) => setValue('feedbackOptionId', e.target.value)}
                >
                  <option value="" disabled>Select outcome…</option>
                  {feedbackOptions.map((opt) => (
                    <option key={opt.id} value={opt.id}>{opt.label}</option>
                  ))}
                </select>
              )}
              {errors.feedbackOptionId && (
                <p className="text-xs text-destructive">{errors.feedbackOptionId.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label>Remarks <span className="text-destructive">*</span></Label>
              <textarea
                {...register('remarks')}
                rows={3}
                placeholder="Describe the conversation outcome…"
                className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
              />
              {errors.remarks && (
                <p className="text-xs text-destructive">{errors.remarks.message}</p>
              )}
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => { setFeedbackLead(null); reset(); }}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitMutation.isPending || feedbackOptions.length === 0}>
                {submitMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Submit Feedback
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Lead Detail Drawer */}
      <LeadDetailDrawer
        leadId={drawerLead?.id ?? null}
        onClose={() => setDrawerLead(null)}
      />
    </div>
  );
}
