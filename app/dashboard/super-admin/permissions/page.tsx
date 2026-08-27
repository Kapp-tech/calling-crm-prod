'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Lock, Check, X } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useToast } from '@/components/ui/use-toast';
import { PinGate } from '@/components/shared/pin-gate';
import { PIN_GATED_ACTIONS } from '@/lib/pin-gated-actions';

const ROLES = [
  { key: 'SUPER_ADMIN', label: 'Super Admin' },
  { key: 'REPORTS', label: 'Reports' },
  { key: 'OPERATIONS', label: 'Operations' },
  { key: 'COUNSELLING_TL', label: 'Counselling TL' },
  { key: 'COUNSELLING_AGENT', label: 'Counselling Agent' },
] as const;

const FEATURES = [
  { key: 'VIEW_REPORTS', label: 'View Reports' },
  { key: 'DOWNLOAD_DATA', label: 'Download Data' },
  // Enum name kept (renaming costs an ALTER TYPE plus a data migration for no
  // gain); the label says what the switch actually does.
  { key: 'MASK_UNMASK_DATA', label: 'Mask Data (hide email & phone)' },
  { key: 'UPLOAD_LEADS', label: 'Upload Leads' },
  { key: 'APPROVE_LEADS', label: 'Approve Leads' },
  { key: 'ASSIGN_LEADS', label: 'Assign Leads' },
  { key: 'VIEW_LEADS', label: 'View Leads' },
  { key: 'SUBMIT_FEEDBACK', label: 'Submit Feedback' },
  { key: 'APPROVE_RECEIPTS', label: 'Approve Receipts' },
] as const;

type RoleKey = typeof ROLES[number]['key'];
type FeatureKey = typeof FEATURES[number]['key'];

export default function PermissionsPage() {
  return (
    <PinGate action={PIN_GATED_ACTIONS.MANAGE_PERMISSIONS} title="Manage Permissions">
      <PermissionsContent />
    </PinGate>
  );
}

function PermissionsContent() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: permissions, isLoading } = useQuery<Record<RoleKey, Record<FeatureKey, boolean>>>({
    queryKey: ['permissions'],
    queryFn: async () => {
      const r = await fetch('/api/permissions');
      // Never cache an error body ({error:'Unauthorized'}) as matrix data —
      // that used to render every switch as OFF instead of surfacing a failure.
      if (!r.ok) throw new Error(`Failed to load permissions (HTTP ${r.status})`);
      return r.json();
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: { role: RoleKey; feature: FeatureKey; canAccess: boolean }) => {
      const r = await fetch('/api/permissions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const json = await r.json().catch(() => null);
      if (!r.ok || json?.error) {
        const msg = typeof json?.error === 'string' ? json.error : `Save failed (HTTP ${r.status})`;
        throw new Error(msg);
      }
      return json;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['permissions'] });
      toast({ title: 'Permission updated' });
    },
    onError: (err: Error) => {
      toast({ variant: 'destructive', title: 'Permission not saved', description: err.message });
    },
  });

  const handleToggle = (role: RoleKey, feature: FeatureKey, current: boolean) => {
    if (role === 'SUPER_ADMIN') return; // locked
    updateMutation.mutate({ role, feature, canAccess: !current });
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Permission Matrix</CardTitle>
          <CardDescription>
            Toggle feature access for each role. Super Admin permissions are locked and cannot be changed.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="py-3 px-4 text-left font-semibold text-muted-foreground">
                      Feature
                    </th>
                    {ROLES.map((role) => (
                      <th key={role.key} className="py-3 px-4 text-center font-semibold">
                        <div className="flex flex-col items-center gap-1">
                          <span>{role.label}</span>
                          {role.key === 'SUPER_ADMIN' && (
                            <Badge variant="secondary" className="text-xs">
                              <Lock className="mr-1 h-2.5 w-2.5" /> Locked
                            </Badge>
                          )}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {FEATURES.map((feature, i) => (
                    <tr key={feature.key} className={i % 2 === 0 ? 'bg-muted/20' : ''}>
                      <td className="py-3 px-4 font-medium">{feature.label}</td>
                      {ROLES.map((role) => {
                        const hasAccess = permissions?.[role.key]?.[feature.key] ?? false;
                        const isLocked = role.key === 'SUPER_ADMIN';
                        return (
                          <td key={role.key} className="py-3 px-4 text-center">
                            {isLocked ? (
                              <div className="flex justify-center">
                                <Check className="h-5 w-5 text-green-500" />
                              </div>
                            ) : (
                              <div className="flex justify-center">
                                <Switch
                                  checked={hasAccess}
                                  onCheckedChange={() => handleToggle(role.key, feature.key, hasAccess)}
                                  disabled={updateMutation.isPending}
                                />
                              </div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
