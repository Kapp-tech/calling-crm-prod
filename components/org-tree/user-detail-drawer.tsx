'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X, UserX, UserCheck, Phone, Mail, Calendar, Hash, Building2, KeyRound, Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/components/ui/use-toast';
import { formatDateTime } from '@/lib/utils';

interface DrawerUser {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  employeeCode: string;
  isActive: boolean;
  status: string;
  joiningDate?: string | null;
  role?: string;
  team?: { id: string; name: string } | null;
  _count?: { assignedLeads?: number; feedbacks?: number };
}

interface UserDetailDrawerProps {
  user: DrawerUser | null;
  onClose: () => void;
}

export function UserDetailDrawer({ user, onClose }: UserDetailDrawerProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [approvedCredentials, setApprovedCredentials] = useState<{ email: string; password: string } | null>(null);
  const [copied, setCopied] = useState<'email' | 'password' | null>(null);

  function copyToClipboard(text: string, field: 'email' | 'password') {
    navigator.clipboard.writeText(text);
    setCopied(field);
    setTimeout(() => setCopied(null), 2000);
  }

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      fetch(`/api/users/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive }),
      }).then((r) => r.json()),
    onSuccess: (data) => {
      if (!data?.id) {
        toast({ variant: 'destructive', title: 'Error', description: 'Failed to update user' });
        return;
      }
      toast({ title: `User ${data.isActive ? 'activated' : 'deactivated'}` });
      queryClient.invalidateQueries({ queryKey: ['hierarchy'] });
    },
  });

  const approveMutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'APPROVE' | 'REJECT' }) =>
      fetch(`/api/users/${id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      }).then((r) => r.json()),
    onSuccess: (data) => {
      if (!data.success) {
        toast({ variant: 'destructive', title: 'Error', description: 'Action failed' });
        return;
      }
      queryClient.invalidateQueries({ queryKey: ['hierarchy'] });
      if (data.tempPassword && user) {
        setApprovedCredentials({ email: user.email, password: data.tempPassword });
      } else {
        onClose();
      }
    },
  });

  if (!user) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />

      {/* Drawer */}
      <div className="fixed right-0 top-0 z-50 h-full w-80 bg-background shadow-2xl overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="font-semibold">User Profile</h2>
          <Button variant="ghost" size="icon" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>

        <div className="p-5 space-y-5">
          {/* Avatar + name */}
          <div className="flex flex-col items-center gap-2 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary text-2xl font-bold text-primary-foreground">
              {user.name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)}
            </div>
            <div>
              <h3 className="font-bold text-lg">{user.name}</h3>
              {user.role && (
                <Badge variant="secondary" className="mt-1">{user.role.replace(/_/g, ' ')}</Badge>
              )}
            </div>
            <Badge variant={user.isActive ? 'success' : 'destructive'}>
              {user.status.replace(/_/g, ' ')}
            </Badge>
          </div>

          <Separator />

          {/* Details */}
          <dl className="space-y-3 text-sm">
            <DetailRow icon={Hash} label="Employee Code" value={user.employeeCode} />
            <DetailRow icon={Mail} label="Email" value={user.email} />
            {user.phone && <DetailRow icon={Phone} label="Phone" value={user.phone} />}
            {user.joiningDate && <DetailRow icon={Calendar} label="Joined" value={formatDateTime(user.joiningDate)} />}
            {user.team && <DetailRow icon={Building2} label="Team" value={user.team.name} />}
          </dl>

          {/* Stats */}
          {user._count && (
            <>
              <Separator />
              <div className="grid grid-cols-2 gap-3">
                {user._count.assignedLeads !== undefined && (
                  <StatCard label="Assigned Leads" value={user._count.assignedLeads} />
                )}
                {user._count.feedbacks !== undefined && (
                  <StatCard label="Total Calls" value={user._count.feedbacks} />
                )}
              </div>
            </>
          )}

          <Separator />

          {/* Actions */}
          <div className="space-y-2">
            {approvedCredentials ? (
              <>
                <div className="rounded-lg border border-green-500/30 bg-green-500/5 p-4 space-y-3">
                  <div className="flex items-center gap-2 text-green-600">
                    <KeyRound className="h-4 w-4 shrink-0" />
                    <span className="text-sm font-semibold">Agent Approved — Share Credentials</span>
                  </div>
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center justify-between gap-2 rounded-md bg-muted px-3 py-2">
                      <div className="min-w-0">
                        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Username (Email)</p>
                        <p className="font-mono text-xs truncate">{approvedCredentials.email}</p>
                      </div>
                      <button
                        onClick={() => copyToClipboard(approvedCredentials.email, 'email')}
                        className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {copied === 'email' ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                    <div className="flex items-center justify-between gap-2 rounded-md bg-muted px-3 py-2">
                      <div className="min-w-0">
                        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Password</p>
                        <p className="font-mono text-xs font-bold tracking-wide">{approvedCredentials.password}</p>
                      </div>
                      <button
                        onClick={() => copyToClipboard(approvedCredentials.password, 'password')}
                        className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {copied === 'password' ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  </div>
                  <p className="text-[11px] text-muted-foreground">Ask the agent to change their password after first login.</p>
                </div>
                <Button className="w-full" onClick={onClose}>Done</Button>
              </>
            ) : user.status === 'PENDING_APPROVAL' ? (
              <>
                <Button
                  className="w-full"
                  onClick={() => approveMutation.mutate({ id: user.id, action: 'APPROVE' })}
                  disabled={approveMutation.isPending}
                >
                  <UserCheck className="mr-2 h-4 w-4" /> Approve Agent
                </Button>
                <Button
                  variant="destructive"
                  className="w-full"
                  onClick={() => approveMutation.mutate({ id: user.id, action: 'REJECT' })}
                  disabled={approveMutation.isPending}
                >
                  <UserX className="mr-2 h-4 w-4" /> Reject
                </Button>
              </>
            ) : (
              <Button
                variant={user.isActive ? 'destructive' : 'default'}
                className="w-full"
                onClick={() => toggleMutation.mutate({ id: user.id, isActive: !user.isActive })}
                disabled={toggleMutation.isPending}
              >
                {user.isActive ? (
                  <><UserX className="mr-2 h-4 w-4" /> Deactivate</>
                ) : (
                  <><UserCheck className="mr-2 h-4 w-4" /> Activate</>
                )}
              </Button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function DetailRow({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="font-medium">{value}</p>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-muted/40 p-3 text-center">
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
