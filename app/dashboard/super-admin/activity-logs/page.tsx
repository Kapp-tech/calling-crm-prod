'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDateTime } from '@/lib/utils';

const ACTIONS = [
  'USER_CREATED','USER_UPDATED','USER_DEACTIVATED','USER_APPROVED','USER_REJECTED',
  'LEAD_ASSIGNED','LEAD_APPROVED','LEAD_DISAPPROVED','LEAD_DELETED',
  'PERMISSION_CHANGED','CSV_UPLOADED','LEADS_EXPORTED',
  'TEAM_CREATED','TEAM_UPDATED','AGENT_TRANSFER','TL_TRANSFER',
];

const ACTION_COLORS: Record<string, string> = {
  USER_CREATED: 'success', USER_APPROVED: 'success', TEAM_CREATED: 'success',
  USER_DEACTIVATED: 'destructive', USER_REJECTED: 'destructive', LEAD_DELETED: 'destructive',
  LEAD_ASSIGNED: 'info', AGENT_TRANSFER: 'info', TL_TRANSFER: 'info',
  CSV_UPLOADED: 'warning', PERMISSION_CHANGED: 'warning', LEADS_EXPORTED: 'warning',
};

interface LogEntry {
  id: string;
  action: string;
  description: string;
  targetType?: string | null;
  createdAt: string;
  user: { id: string; name: string; role: string; employeeCode: string };
}

export default function ActivityLogsPage() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['activity-logs', page, action, from, to],
    queryFn: () => {
      const p = new URLSearchParams({ page: String(page), limit: '20' });
      if (action) p.set('action', action);
      if (from) p.set('from', from);
      if (to) p.set('to', to);
      return fetch(`/api/activity-logs?${p}`).then((r) => r.json());
    },
  });

  const logs: LogEntry[] = data?.logs ?? [];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Activity Logs</CardTitle>
          <Button variant="outline" size="sm" onClick={() => {
            const p = new URLSearchParams();
            if (action) p.set('action', action);
            window.open(`/api/activity-logs/export?${p}`, '_blank');
          }}>
            <Download className="mr-2 h-4 w-4" /> Export CSV
          </Button>
        </CardHeader>
        <CardContent>
          {/* Filters */}
          <div className="flex gap-3 mb-4 flex-wrap">
            <Select value={action} onValueChange={(v) => { setAction(v === 'ALL' ? '' : v); setPage(1); }}>
              <SelectTrigger className="w-52">
                <SelectValue placeholder="All actions" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All actions</SelectItem>
                {ACTIONS.map((a) => <SelectItem key={a} value={a}>{a.replace(/_/g, ' ')}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} className="w-40" />
            <Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} className="w-40" />
          </div>

          {isLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Action</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>By</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Target</TableHead>
                    <TableHead>Time</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell>
                        <Badge variant={(ACTION_COLORS[log.action] as 'success' | 'destructive' | 'info' | 'warning') ?? 'secondary'}>
                          {log.action.replace(/_/g, ' ')}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm max-w-xs truncate">{log.description}</TableCell>
                      <TableCell>
                        <div>
                          <p className="font-medium text-sm">{log.user.name}</p>
                          <p className="text-xs text-muted-foreground">{log.user.employeeCode}</p>
                        </div>
                      </TableCell>
                      <TableCell><Badge variant="secondary" className="text-xs">{log.user.role.replace(/_/g, ' ')}</Badge></TableCell>
                      <TableCell className="text-xs text-muted-foreground">{log.targetType ?? '—'}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{formatDateTime(log.createdAt)}</TableCell>
                    </TableRow>
                  ))}
                  {logs.length === 0 && (
                    <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No logs found</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>

              {data?.totalPages > 1 && (
                <div className="flex items-center justify-between mt-4">
                  <p className="text-sm text-muted-foreground">Page {page} of {data.totalPages} · {data.total} total</p>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>Previous</Button>
                    <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={page === data.totalPages}>Next</Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
