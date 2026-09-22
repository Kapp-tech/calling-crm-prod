'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AGENT_ZONES } from '@/lib/college-attributes';
import { Plus, Pencil, UserX, UserCheck, Loader2, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/components/ui/use-toast';
import { formatDate } from '@/lib/utils';

const ROLES = ['SUPER_ADMIN', 'REPORTS', 'OPERATIONS', 'COUNSELLING_TL', 'COUNSELLING_AGENT'] as const;
const WORK_TYPES = ['WFH', 'WFO'] as const;

/** Optional, but exactly 10 digits when filled — mirrors the server rule. */
const phoneField = z
  .string()
  .optional()
  .refine((v) => !v || /^\d{10}$/.test(v), 'Phone must be exactly 10 digits');

const userSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Invalid email'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  phone: phoneField,
  role: z.enum(ROLES),
  workType: z.enum(WORK_TYPES),
  managedById: z.string().optional(),
  managerId: z.string().optional(),
  joiningDate: z.string().min(1, 'Joining date is required'),
  // Digits only: this is the agent's seat id in the DialShree dialer, and
  // click-to-call fails silently upstream if it is malformed.
  dialshreeId: z
    .string()
    .optional()
    .refine((v) => !v || /^\d{1,15}$/.test(v), 'DialShree ID must be digits only'),
  // Reporting attributes. Zone shares the college zone list so the two line up
  // on reports; language is free text because the real list is long and regional.
  zone: z.string().optional(),
  language: z.string().max(80).optional(),
});

type UserForm = z.infer<typeof userSchema>;

/** Same as create, but the password is only set when the admin types one. */
const editSchema = userSchema.extend({
  password: z
    .string()
    .optional()
    .refine((v) => !v || v.length >= 8, 'Password must be at least 8 characters'),
});

type EditForm = z.infer<typeof editSchema>;

interface UserRecord {
  id: string;
  employeeCode: string;
  name: string;
  email: string;
  phone?: string | null;
  dialshreeId?: string | null;
  zone?: string | null;
  language?: string | null;
  role: string;
  workType: 'WFH' | 'WFO';
  isActive: boolean;
  createdAt: string;
  joiningDate: string;
  managedById?: string | null;
  managerId?: string | null;
  managedBy?: { id: string; name: string } | null;
  _count: { assignedLeads: number };
}

const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: 'Super Admin',
  REPORTS: 'Reports',
  OPERATIONS: 'Operations',
  COUNSELLING_TL: 'Counselling TL',
  COUNSELLING_AGENT: 'Counselling Agent',
};

export default function SuperAdminPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editUser, setEditUser] = useState<UserRecord | null>(null);

  const { data: users = [], isLoading } = useQuery<UserRecord[]>({
    queryKey: ['users'],
    queryFn: () => fetch('/api/users').then((r) => r.json()),
  });

  // Fetch TLs for agent assignment
  const { data: tls = [] } = useQuery<UserRecord[]>({
    queryKey: ['users', 'tls'],
    queryFn: () => fetch('/api/users?role=COUNSELLING_TL').then((r) => r.json()),
  });

  const { register, handleSubmit, setValue, reset, watch, formState: { errors } } = useForm<UserForm>({
    resolver: zodResolver(userSchema),
    defaultValues: { joiningDate: new Date().toISOString().slice(0, 10) },
  });

  const watchRole = watch('role');

  // A separate form instance so opening the edit dialog can't clobber a
  // half-filled create form (and vice versa).
  const editForm = useForm<EditForm>({ resolver: zodResolver(editSchema) });
  const editRole = editForm.watch('role');

  /** Loads a user's current values into the edit dialog. */
  function openEdit(user: UserRecord) {
    editForm.reset({
      name: user.name,
      email: user.email,
      password: '',
      phone: user.phone ?? '',
      dialshreeId: user.dialshreeId ?? '',
      zone: user.zone ?? '',
      language: user.language ?? '',
      role: user.role as typeof ROLES[number],
      workType: user.workType,
      managedById: user.managedById ?? undefined,
      managerId: user.managerId ?? undefined,
      joiningDate: user.joiningDate ? new Date(user.joiningDate).toISOString().slice(0, 10) : '',
    });
    setEditUser(user);
  }

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: EditForm }) => {
      // Omit password entirely unless the admin actually set a new one.
      const { password, ...rest } = data;
      const payload: Record<string, unknown> = { ...rest };
      if (password) payload.password = password;
      return fetch(`/api/users/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).then((r) => r.json());
    },
    onSuccess: (data) => {
      if (data.error) {
        toast({ variant: 'destructive', title: 'Could not save', description: typeof data.error === 'string' ? data.error : JSON.stringify(data.error) });
        return;
      }
      toast({ title: 'User updated' });
      queryClient.invalidateQueries({ queryKey: ['users'] });
      setEditUser(null);
    },
    onError: (err: Error) => toast({ variant: 'destructive', title: 'Could not save', description: err.message }),
  });

  const createMutation = useMutation({
    mutationFn: (data: UserForm) =>
      fetch('/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then((r) => r.json()),
    onSuccess: (data) => {
      if (data.error) { toast({ variant: 'destructive', title: 'Error', description: JSON.stringify(data.error) }); return; }
      toast({ variant: 'default', title: 'User created' });
      queryClient.invalidateQueries({ queryKey: ['users'] });
      setShowCreateDialog(false);
      reset();
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      fetch(`/api/users/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isActive }) }).then((r) => r.json()),
    onSuccess: () => {
      toast({ title: 'User updated' });
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });

  const filteredUsers = users.filter((u) => {
    if (roleFilter !== 'ALL' && u.role !== roleFilter) return false;
    if (statusFilter === 'ACTIVE' && !u.isActive) return false;
    if (statusFilter === 'INACTIVE' && u.isActive) return false;
    if (typeFilter !== 'ALL' && u.workType !== typeFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        (u.employeeCode ?? '').toLowerCase().includes(q) ||
        u.name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.role.toLowerCase().includes(q) ||
        (u.managedBy?.name ?? '').toLowerCase().includes(q)
      );
    }
    return true;
  });

  const activeFilters = (roleFilter !== 'ALL' ? 1 : 0) + (statusFilter !== 'ALL' ? 1 : 0) + (typeFilter !== 'ALL' ? 1 : 0);

  const onSubmit = (data: UserForm) => createMutation.mutate(data);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>User Management</CardTitle>
          <Button onClick={() => { reset({ joiningDate: new Date().toISOString().slice(0, 10) }); setShowCreateDialog(true); }}>
            <Plus className="mr-2 h-4 w-4" /> Add User
          </Button>
        </CardHeader>
        <CardContent>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            {/* Search */}
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search by user ID, name, email, role or manager..."
                className="pl-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            {/* Role filter */}
            <Select value={roleFilter} onValueChange={setRoleFilter}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="All Roles" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Roles</SelectItem>
                {ROLES.map((r) => (
                  <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Status filter */}
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-36">
                <SelectValue placeholder="All Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Status</SelectItem>
                <SelectItem value="ACTIVE">Active</SelectItem>
                <SelectItem value="INACTIVE">Inactive</SelectItem>
              </SelectContent>
            </Select>

            {/* Type filter */}
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-32">
                <SelectValue placeholder="All Types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Types</SelectItem>
                <SelectItem value="WFH">WFH</SelectItem>
                <SelectItem value="WFO">WFO</SelectItem>
              </SelectContent>
            </Select>

            {/* Clear filters */}
            {activeFilters > 0 && (
              <Button variant="ghost" size="sm" onClick={() => { setRoleFilter('ALL'); setStatusFilter('ALL'); setTypeFilter('ALL'); }}>
                Clear filters
                <Badge variant="secondary" className="ml-1.5 h-5 min-w-5 px-1 text-xs">{activeFilters}</Badge>
              </Button>
            )}
          </div>

          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : (
            // Compact density is scoped here via descendant selectors rather
            // than changing components/ui/table.tsx, which 9 other pages share.
            <Table className="[&_td]:px-3 [&_td]:py-2 [&_th]:h-9 [&_th]:px-3">
              <TableHeader>
                <TableRow>
                  <TableHead>User ID</TableHead>
                  <TableHead className="whitespace-nowrap">DialShree ID</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Manager</TableHead>
                  <TableHead className="text-right">Leads</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="whitespace-nowrap">Joining Date</TableHead>
                  <TableHead className="whitespace-nowrap">Created</TableHead>
                  {/* Pinned right so Edit stays reachable when the table
                      scrolls horizontally. Needs an opaque bg or the scrolled
                      columns show through underneath. */}
                  <TableHead className="sticky right-0 z-10 border-l bg-card text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredUsers.map((user) => (
                  <TableRow key={user.id} className="group">
                    {/* employeeCode is this app's user-facing ID — it's what the
                        team pages, activity logs and profile all display. */}
                    <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">{user.employeeCode}</TableCell>
                    {/* The agent's seat in the dialer. Blank for anyone who does
                        not make calls, and for an agent it means click-to-call
                        cannot bridge — so an em dash here is worth noticing. */}
                    <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">{user.dialshreeId || '—'}</TableCell>
                    <TableCell className="whitespace-nowrap font-medium">{user.name}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{user.email}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground tabular-nums">{user.phone || '—'}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="whitespace-nowrap">{ROLE_LABELS[user.role] ?? user.role.replace(/_/g, ' ')}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={user.workType === 'WFH' ? 'outline' : 'secondary'}>
                        {user.workType}
                      </Badge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{user.managedBy?.name ?? '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">{user._count.assignedLeads}</TableCell>
                    <TableCell>
                      <Badge variant={user.isActive ? 'success' : 'outline'}>
                        {user.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                    </TableCell>
                    {/* Date only — the stored time is a midnight-UTC artifact, so
                        rendering it just added noise and forced a line wrap. */}
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {formatDate(user.joiningDate)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {formatDate(user.createdAt)}
                    </TableCell>
                    <TableCell className="sticky right-0 z-10 border-l bg-card group-hover:bg-muted/50">
                      <div className="flex items-center justify-end gap-0.5">
                        <Button variant="ghost" size="icon" className="h-8 w-8" title="Edit user" onClick={() => openEdit(user)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          title={user.isActive ? 'Deactivate' : 'Activate'}
                          onClick={() => toggleActiveMutation.mutate({ id: user.id, isActive: !user.isActive })}
                        >
                          {user.isActive ? (
                            <UserX className="h-4 w-4 text-destructive" />
                          ) : (
                            <UserCheck className="h-4 w-4 text-green-600" />
                          )}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {filteredUsers.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={13} className="text-center text-muted-foreground py-8">
                      No users found
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Create User Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New User</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input {...register('name')} placeholder="Full name" />
              {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input {...register('email')} type="email" placeholder="email@example.com" />
              {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
            </div>
            <div className="space-y-2">
              <Label>Password</Label>
              <Input {...register('password')} type="password" placeholder="Min 8 characters" />
              {errors.password && <p className="text-xs text-destructive">{errors.password.message}</p>}
            </div>
            <div className="space-y-2">
              <Label>Phone Number</Label>
              <Input
                {...register('phone')}
                type="tel"
                inputMode="numeric"
                maxLength={10}
                placeholder="10-digit mobile number"
                onChange={(e) => {
                  e.target.value = e.target.value.replace(/\D/g, '').slice(0, 10);
                  register('phone').onChange(e);
                }}
              />
              {errors.phone && <p className="text-xs text-destructive">{errors.phone.message}</p>}
            </div>
            <div className="space-y-2">
              <Label>
                DialShree ID <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <Input
                {...register('dialshreeId')}
                inputMode="numeric"
                maxLength={15}
                placeholder="e.g. 100096"
                onChange={(e) => {
                  e.target.value = e.target.value.replace(/\D/g, '').slice(0, 15);
                  register('dialshreeId').onChange(e);
                }}
              />
              <p className="text-[11px] text-muted-foreground">
                Links this agent to their dialer extension. Without it, the Call button is disabled for them.
              </p>
              {errors.dialshreeId && <p className="text-xs text-destructive">{errors.dialshreeId.message}</p>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Agent Zone</Label>
                <select
                  {...register('zone')}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background transition-all duration-200 hover:border-muted-foreground/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="">— Not set —</option>
                  {AGENT_ZONES.map((z) => (
                    <option key={z} value={z}>{z}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Agent Language</Label>
                <Input {...register('language')} placeholder="e.g. Hindi, English" maxLength={80} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Role</Label>
              <Select onValueChange={(v) => setValue('role', v as typeof ROLES[number])}>
                <SelectTrigger>
                  <SelectValue placeholder="Select role" />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((role) => (
                    <SelectItem key={role} value={role}>{role.replace(/_/g, ' ')}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.role && <p className="text-xs text-destructive">{errors.role.message}</p>}
            </div>
            <div className="space-y-2">
              <Label>Type</Label>
              <Select onValueChange={(v) => setValue('workType', v as typeof WORK_TYPES[number])}>
                <SelectTrigger>
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  {WORK_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>{type}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.workType && <p className="text-xs text-destructive">{errors.workType.message}</p>}
            </div>
            {watchRole === 'COUNSELLING_AGENT' && (
              <div className="space-y-2">
                <Label>Assign to TL</Label>
                <Select onValueChange={(v) => setValue('managedById', v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select TL" />
                  </SelectTrigger>
                  <SelectContent>
                    {tls.map((tl) => (
                      <SelectItem key={tl.id} value={tl.id}>{tl.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {watchRole && watchRole !== 'COUNSELLING_AGENT' && (
              <div className="space-y-2">
                <Label>Reporting Manager (optional)</Label>
                <Select onValueChange={(v) => setValue('managerId', v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select manager" />
                  </SelectTrigger>
                  <SelectContent>
                    {users.map((u) => (
                      <SelectItem key={u.id} value={u.id}>{u.name} — {ROLE_LABELS[u.role] ?? u.role}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-2">
              <Label>Joining Date</Label>
              <Input {...register('joiningDate')} type="date" />
              {errors.joiningDate && <p className="text-xs text-destructive">{errors.joiningDate.message}</p>}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowCreateDialog(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Create User
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit User Dialog */}
      <Dialog open={!!editUser} onOpenChange={(open) => { if (!open) setEditUser(null); }}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit User</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={editForm.handleSubmit((data) => {
              if (!editUser) return;
              updateMutation.mutate({ id: editUser.id, data });
            })}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label>Name</Label>
              <Input {...editForm.register('name')} placeholder="Full name" />
              {editForm.formState.errors.name && <p className="text-xs text-destructive">{editForm.formState.errors.name.message}</p>}
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input {...editForm.register('email')} type="email" placeholder="email@example.com" />
              {editForm.formState.errors.email && <p className="text-xs text-destructive">{editForm.formState.errors.email.message}</p>}
            </div>
            <div className="space-y-2">
              <Label>Phone Number</Label>
              <Input
                {...editForm.register('phone')}
                type="tel"
                inputMode="numeric"
                maxLength={10}
                placeholder="10-digit mobile number"
                onChange={(e) => {
                  e.target.value = e.target.value.replace(/\D/g, '').slice(0, 10);
                  editForm.register('phone').onChange(e);
                }}
              />
              {editForm.formState.errors.phone && <p className="text-xs text-destructive">{editForm.formState.errors.phone.message}</p>}
            </div>
            <div className="space-y-2">
              <Label>
                DialShree ID <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <Input
                {...editForm.register('dialshreeId')}
                inputMode="numeric"
                maxLength={15}
                placeholder="e.g. 100096"
                onChange={(e) => {
                  e.target.value = e.target.value.replace(/\D/g, '').slice(0, 15);
                  editForm.register('dialshreeId').onChange(e);
                }}
              />
              <p className="text-[11px] text-muted-foreground">
                Links this agent to their dialer extension. Without it, the Call button is disabled for them.
              </p>
              {editForm.formState.errors.dialshreeId && <p className="text-xs text-destructive">{editForm.formState.errors.dialshreeId.message}</p>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Agent Zone</Label>
                <select
                  {...editForm.register('zone')}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background transition-all duration-200 hover:border-muted-foreground/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="">— Not set —</option>
                  {AGENT_ZONES.map((z) => (
                    <option key={z} value={z}>{z}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Agent Language</Label>
                <Input {...editForm.register('language')} placeholder="e.g. Hindi, English" maxLength={80} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>New Password</Label>
              <Input {...editForm.register('password')} type="password" placeholder="Leave blank to keep current password" />
              {editForm.formState.errors.password && <p className="text-xs text-destructive">{editForm.formState.errors.password.message}</p>}
            </div>
            <div className="space-y-2">
              <Label>Role</Label>
              <Select value={editRole} onValueChange={(v) => editForm.setValue('role', v as typeof ROLES[number])}>
                <SelectTrigger><SelectValue placeholder="Select role" /></SelectTrigger>
                <SelectContent>
                  {ROLES.map((role) => (
                    <SelectItem key={role} value={role}>{role.replace(/_/g, ' ')}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {editForm.formState.errors.role && <p className="text-xs text-destructive">{editForm.formState.errors.role.message}</p>}
            </div>
            <div className="space-y-2">
              <Label>Type</Label>
              <Select value={editForm.watch('workType')} onValueChange={(v) => editForm.setValue('workType', v as typeof WORK_TYPES[number])}>
                <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                <SelectContent>
                  {WORK_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>{type}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {editForm.formState.errors.workType && <p className="text-xs text-destructive">{editForm.formState.errors.workType.message}</p>}
            </div>
            {editRole === 'COUNSELLING_AGENT' && (
              <div className="space-y-2">
                <Label>Assign to TL</Label>
                <Select value={editForm.watch('managedById') ?? undefined} onValueChange={(v) => editForm.setValue('managedById', v)}>
                  <SelectTrigger><SelectValue placeholder="Select TL" /></SelectTrigger>
                  <SelectContent>
                    {tls.map((tl) => (
                      <SelectItem key={tl.id} value={tl.id}>{tl.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {editRole && editRole !== 'COUNSELLING_AGENT' && (
              <div className="space-y-2">
                <Label>Reporting Manager (optional)</Label>
                <Select value={editForm.watch('managerId') ?? undefined} onValueChange={(v) => editForm.setValue('managerId', v)}>
                  <SelectTrigger><SelectValue placeholder="Select manager" /></SelectTrigger>
                  <SelectContent>
                    {users.filter((u) => u.id !== editUser?.id).map((u) => (
                      <SelectItem key={u.id} value={u.id}>{u.name} — {ROLE_LABELS[u.role] ?? u.role}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-2">
              <Label>Joining Date</Label>
              <Input {...editForm.register('joiningDate')} type="date" />
              {editForm.formState.errors.joiningDate && <p className="text-xs text-destructive">{editForm.formState.errors.joiningDate.message}</p>}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditUser(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={updateMutation.isPending}>
                {updateMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save Changes
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
