'use client';

import { useQuery } from '@tanstack/react-query';
import { Loader2, Clock, Calendar, History } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDateTime } from '@/lib/utils';

interface FeedbackWithLead {
  id: string;
  remarks?: string | null;
  followUpNumber: number;
  createdAt: string;
  feedbackOption: { id: string; label: string };
  lead: {
    id: string; name: string; phone: string; email: string;
    city?: string | null; course?: string | null; campaign?: string | null;
    status: string;
    _count: { feedbacks: number };
  };
}

interface ActivityResponse {
  today: FeedbackWithLead[];
  recent: FeedbackWithLead[];
  older: FeedbackWithLead[];
  total: number;
}

function FeedbackCard({ item }: { item: FeedbackWithLead }) {
  return (
    <div className="rounded-lg border p-4 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-sm">{item.lead.name}</p>
          <p className="text-xs text-muted-foreground">{item.lead.phone} · {item.lead.city} · {item.lead.course}</p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <Badge variant="secondary">{item.feedbackOption.label}</Badge>
          <Badge variant="secondary" className="text-[10px]">FU #{item.followUpNumber}</Badge>
        </div>
      </div>

      {item.remarks && (
        <p className="text-xs text-muted-foreground italic">&ldquo;{item.remarks}&rdquo;</p>
      )}

      <p className="text-xs text-muted-foreground">{formatDateTime(item.createdAt)}</p>
    </div>
  );
}

export default function DueTodayPage() {
  const { data, isLoading } = useQuery<ActivityResponse>({
    queryKey: ['recent-activity'],
    queryFn: () => fetch('/api/leads/due-today').then((r) => r.json()),
    refetchInterval: 5 * 60 * 1000,
  });

  const today = data?.today ?? [];
  const recent = data?.recent ?? [];
  const older = data?.older ?? [];

  return (
    <div className="space-y-6">
      {/* Summary badges */}
      <div className="flex flex-wrap gap-3">
        <div className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-4 py-2">
          <Clock className="h-4 w-4 text-primary" />
          <span className="font-bold text-primary">{today.length}</span>
          <span className="text-sm text-primary/80">Today</span>
        </div>
        <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-4 py-2">
          <Calendar className="h-4 w-4 text-muted-foreground" />
          <span className="font-bold">{recent.length}</span>
          <span className="text-sm text-muted-foreground">Yesterday</span>
        </div>
        <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-4 py-2">
          <History className="h-4 w-4 text-muted-foreground" />
          <span className="font-bold">{data?.total ?? 0}</span>
          <span className="text-sm text-muted-foreground">Last 7 Days</span>
        </div>
      </div>

      {isLoading && <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>}

      {today.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="h-4 w-4" /> Today&apos;s Calls ({today.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {today.map((item) => <FeedbackCard key={item.id} item={item} />)}
          </CardContent>
        </Card>
      )}

      {recent.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Calendar className="h-4 w-4" /> Yesterday ({recent.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {recent.map((item) => <FeedbackCard key={item.id} item={item} />)}
          </CardContent>
        </Card>
      )}

      {older.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <History className="h-4 w-4" /> Older ({older.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {older.map((item) => <FeedbackCard key={item.id} item={item} />)}
          </CardContent>
        </Card>
      )}

      {!isLoading && today.length === 0 && recent.length === 0 && older.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No feedback activity in the last 7 days.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
