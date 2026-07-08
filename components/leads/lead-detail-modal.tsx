'use client';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { formatDateTime } from '@/lib/utils';
import { maskEmail, maskPhone } from '@/lib/csv-parser';
import type { Lead, LeadFeedback, FeedbackOption, User } from '@prisma/client';

type LeadWithRelations = Lead & {
  uploadedBy: Pick<User, 'id' | 'name'>;
  approvedBy?: Pick<User, 'id' | 'name'> | null;
  assignedTo?: Pick<User, 'id' | 'name'> | null;
  assignedBy?: Pick<User, 'id' | 'name'> | null;
  feedbacks: (LeadFeedback & {
    agent: Pick<User, 'id' | 'name'>;
    feedbackOption: Pick<FeedbackOption, 'id' | 'label'>;
  })[];
};

interface LeadDetailModalProps {
  lead: LeadWithRelations | null;
  open: boolean;
  onClose: () => void;
  canUnmask?: boolean;
}

export function LeadDetailModal({ lead, open, onClose, canUnmask = false }: LeadDetailModalProps) {
  if (!lead) return null;

  const displayPhone = canUnmask ? lead.phone : maskPhone(lead.phone);
  const displayEmail = canUnmask ? lead.email : maskEmail(lead.email);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {lead.name}
            <Badge
              variant={
                lead.status === 'APPROVED'
                  ? 'success'
                  : lead.status === 'DISAPPROVED'
                  ? 'destructive'
                  : 'warning'
              }
            >
              {lead.status}
            </Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Contact Info */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <InfoRow label="Email" value={displayEmail} />
            <InfoRow label="Phone" value={displayPhone} />
            <InfoRow label="City" value={lead.city} />
            <InfoRow label="State" value={lead.state} />
            <InfoRow label="Course" value={lead.course} />
            <InfoRow label="College" value={lead.college} />
            <InfoRow label="Campaign" value={lead.campaign} />
            <InfoRow label="Lead Type" value={lead.leadType} />
            <InfoRow label="Lead Origin" value={lead.leadOrigin} />
            <InfoRow label="Lead Zone" value={lead.leadZone} />
          </div>

          <Separator />

          {/* Metadata */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <InfoRow label="Uploaded By" value={lead.uploadedBy?.name} />
            <InfoRow label="Uploaded At" value={formatDateTime(lead.createdAt)} />
            {lead.approvedBy && (
              <InfoRow label="Approved/Rejected By" value={lead.approvedBy.name} />
            )}
            {lead.assignedTo && (
              <InfoRow label="Assigned To" value={lead.assignedTo.name} />
            )}
            {lead.assignedBy && (
              <InfoRow label="Assigned By" value={lead.assignedBy.name} />
            )}
          </div>

          {/* Feedback History */}
          {(lead.feedbacks ?? []).length > 0 && (
            <>
              <Separator />
              <div>
                <h4 className="font-semibold mb-3">
                  Follow-up History ({(lead.feedbacks ?? []).length}/5)
                </h4>
                <div className="space-y-3">
                  {(lead.feedbacks ?? []).map((feedback) => (
                    <div key={feedback.id} className="rounded-md border p-3 text-sm space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">Follow-up #{feedback.followUpNumber}</span>
                        <Badge variant="secondary">
                          {feedback.feedbackOption?.label ?? '—'}
                        </Badge>
                      </div>
                      {feedback.remarks && (
                        <p className="text-muted-foreground">{feedback.remarks}</p>
                      )}
                      <div className="flex gap-4 text-xs text-muted-foreground">
                        <span>Agent: {feedback.agent?.name ?? '—'}</span>
                        <span>Date: {formatDateTime(feedback.createdAt)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function InfoRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <span className="text-xs text-muted-foreground">{label}</span>
      <p className="font-medium">{value || '—'}</p>
    </div>
  );
}
