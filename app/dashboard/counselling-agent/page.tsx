'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Phone, Loader2, Search, MessageSquarePlus, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { useToast } from '@/components/ui/use-toast';
import { LeadDetailModal } from '@/components/leads/lead-detail-modal';
import { formatDateTime } from '@/lib/utils';
import { usePermissions } from '@/lib/usePermissions';
import { triggerCelebration, isCelebrationFeedback } from '@/lib/celebrate';
import { OnboardingTour, type TourStep } from '@/components/shared/onboarding-tour';

// First-login walkthrough for new agents — shown once per device
const AGENT_TOUR_STEPS: TourStep[] = [
  {
    target: '[data-tour="leads-table"]',
    title: 'Your assigned leads',
    body: 'Every lead assigned to you appears here. Click a name to see full details, call history and contact actions.',
  },
  {
    target: '[data-tour="lead-feedback"]',
    title: 'Record every call',
    body: 'After each call, press Feedback to log the outcome and remarks. This keeps your follow-ups and stats accurate.',
  },
  {
    target: '[data-tour="scheduled-calls"]',
    title: 'Scheduled calls',
    body: 'Calls you schedule with students show up here so you never miss a follow-up.',
  },
  {
    target: '[data-tour="punch-clock"]',
    title: 'Punch in & breaks',
    body: 'Start your day by punching in. Use the same button for lunch, bio and tea breaks — your time is tracked automatically.',
  },
];

const feedbackSchema = z.object({
  feedbackOptionId: z.string().min(1, 'Please select a feedback option'),
  remarks: z.string().trim().min(1, 'Remarks are required').max(1000),
});

type FeedbackForm = z.infer<typeof feedbackSchema>;

interface FeedbackOption { id: string; label: string }

interface Lead {
  id: string; name: string; email: string; phone: string;
  city?: string | null; course?: string | null; campaign?: string | null;
  status: string; createdAt: string; updatedAt: string;
  uploadedBy: { id: string; name: string };
  approvedBy?: { id: string; name: string } | null;
  assignedTo?: { id: string; name: string } | null;
  assignedBy?: { id: string; name: string } | null;
  feedbacks: { feedbackOption?: { label: string } }[];
  _count: { feedbacks: number };
}

export default function CounsellingAgentPage() {
  const { data: session } = useSession();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const canSubmitFeedback = can('SUBMIT_FEEDBACK');

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [feedbackLead, setFeedbackLead] = useState<Lead | null>(null);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);

  const { register, handleSubmit, setValue, reset, formState: { errors } } = useForm<FeedbackForm>({
    resolver: zodResolver(feedbackSchema),
  });

  const { data, isLoading } = useQuery({
    queryKey: ['my-leads', search, page],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page) });
      if (search) params.set('search', search);
      return fetch(`/api/leads?${params}`).then((r) => r.json());
    },
    enabled: !!session?.user?.id,
  });

  const { data: feedbackOptions = [] } = useQuery<FeedbackOption[]>({
    queryKey: ['feedback-options'],
    queryFn: () =>
      fetch('/api/feedback-options').then(async (r) => {
        const d = await r.json();
        return Array.isArray(d) ? d : [];
      }),
    enabled: !!session?.user?.id,
  });

  const submitFeedbackMutation = useMutation({
    mutationFn: ({ leadId, feedback }: { leadId: string; feedback: FeedbackForm }) =>
      fetch(`/api/leads/${leadId}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(feedback),
      }).then((r) => r.json()),
    onSuccess: (data, variables) => {
      if (data.error) {
        toast({ variant: 'destructive', title: 'Error', description: data.error });
        return;
      }
      const selectedLabel = feedbackOptions.find((o) => o.id === variables.feedback.feedbackOptionId)?.label ?? '';
      if (isCelebrationFeedback(selectedLabel)) {
        triggerCelebration();
      }
      toast({ title: 'Feedback submitted successfully' });
      queryClient.invalidateQueries({ queryKey: ['my-leads'] });
      queryClient.invalidateQueries({ queryKey: ['feedback-category-counts'] });
      setFeedbackLead(null);
      reset();
    },
  });

  const onSubmitFeedback = (formData: FeedbackForm) => {
    if (!feedbackLead) return;
    submitFeedbackMutation.mutate({ leadId: feedbackLead.id, feedback: formData });
  };

  const leads: Lead[] = data?.leads ?? [];
  const totalPages: number = data?.totalPages ?? 1;

  return (
    <div className="space-y-6">
      <OnboardingTour steps={AGENT_TOUR_STEPS} storageKey="agent-onboarding-tour-v1" />
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search your leads..."
                className="pl-9"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : (
            <div data-tour="leads-table">
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
                    <TableHead>Assigned</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {leads.map((lead) => {
                    const feedbackCount = lead._count.feedbacks;
                    const lastFeedback = lead.feedbacks?.[feedbackCount - 1];

                    return (
                      <TableRow key={lead.id}>
                        <TableCell
                          className="font-medium cursor-pointer hover:text-primary"
                          onClick={() => setSelectedLead(lead)}
                        >
                          {lead.name}
                        </TableCell>
                        <TableCell className="text-sm">{lead.phone}</TableCell>
                        <TableCell>{lead.city}</TableCell>
                        <TableCell>{lead.course}</TableCell>
                        <TableCell>{lead.campaign}</TableCell>
                        <TableCell>
                          {lastFeedback?.feedbackOption?.label ? (
                            <Badge variant="secondary">{lastFeedback.feedbackOption.label}</Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">No calls yet</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            {Array.from({ length: Math.min(feedbackCount, 5) }).map((_, i) => (
                              <div key={i} className="h-2 w-4 rounded-sm bg-primary" />
                            ))}
                            <span className="ml-1 text-xs text-muted-foreground">{feedbackCount} follow-up{feedbackCount === 1 ? '' : 's'}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {formatDateTime(lead.createdAt)}
                        </TableCell>
                        <TableCell className="text-right">
                          {!canSubmitFeedback ? (
                            <div className="flex items-center justify-end gap-1 text-xs text-muted-foreground">
                              <Lock className="h-3 w-3" /> No permission
                            </div>
                          ) : (
                            <Button size="sm" data-tour="lead-feedback" onClick={() => { setFeedbackLead(lead); reset(); }}>
                              <MessageSquarePlus className="mr-1 h-3 w-3" /> Feedback
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {leads.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                        No leads assigned to you yet
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>

              {totalPages > 1 && (
                <div className="flex items-center justify-between mt-4">
                  <p className="text-sm text-muted-foreground">Page {page} of {totalPages}</p>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>Previous</Button>
                    <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={page === totalPages}>Next</Button>
                  </div>
                </div>
              )}
            </div>
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
          <form onSubmit={handleSubmit(onSubmitFeedback)} className="space-y-4">
            <div className="space-y-2">
              <Label>Feedback Option <span className="text-destructive">*</span></Label>
              {feedbackOptions.length === 0 ? (
                <p className="text-xs text-destructive">No feedback options configured. Contact your admin.</p>
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
                className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                placeholder="Describe the conversation outcome..."
              />
              {errors.remarks && (
                <p className="text-xs text-destructive">{errors.remarks.message}</p>
              )}
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => { setFeedbackLead(null); reset(); }}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitFeedbackMutation.isPending || feedbackOptions.length === 0 || !canSubmitFeedback}>
                {submitFeedbackMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Submit Feedback
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <LeadDetailModal
        lead={selectedLead as Parameters<typeof LeadDetailModal>[0]['lead']}
        open={!!selectedLead}
        onClose={() => setSelectedLead(null)}
        canUnmask={false}
      />
    </div>
  );
}
