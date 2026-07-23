'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm, type UseFormRegisterReturn } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Eye, EyeOff, Loader2, User, Lock, Phone, Mail,
  Calendar, Clock, Building2, Pencil, X, Check, UserCog, KeyRound,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useToast } from '@/components/ui/use-toast';
import { formatDateTime } from '@/lib/utils';
import { cn } from '@/lib/utils';
import { ActivityHeatmap } from '@/components/shared/activity-heatmap';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ProfileData {
  id: string; name: string; email: string; role: string;
  employeeCode: string; phone?: string | null; joiningDate: string; createdAt: string;
  status: string; workType: 'WFH' | 'WFO';
  team?: { id: string; name: string } | null;
  operationsGroup?: { id: string; name: string } | null;
  manager?: { id: string; name: string; role: string } | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getInitials(name: string) {
  return name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);
}

const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: 'Super Admin',
  REPORTS: 'Reports Team',
  OPERATIONS: 'Operations Team',
  COUNSELLING_TL: 'Counselling Team Lead',
  COUNSELLING_AGENT: 'Counselling Agent',
};

function getPasswordStrength(pwd: string) {
  const hasMinLen = pwd.length >= 8;
  const hasUpper = /[A-Z]/.test(pwd);
  const hasNumber = /[0-9]/.test(pwd);
  if (!hasMinLen) return { label: 'Weak', color: 'bg-red-500', width: 'w-1/3', level: 'weak' };
  if (hasUpper && hasNumber) return { label: 'Strong', color: 'bg-green-500', width: 'w-full', level: 'strong' };
  if (hasUpper || hasNumber) return { label: 'Medium', color: 'bg-amber-500', width: 'w-2/3', level: 'medium' };
  return { label: 'Weak', color: 'bg-red-500', width: 'w-1/3', level: 'weak' };
}

// ─── Inline-editable info row ─────────────────────────────────────────────────

function InfoRow({
  icon: Icon, label, value,
  editable, clearable, onSave, onClear,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string; value: string;
  editable?: boolean; clearable?: boolean;
  onSave?: (val: string) => Promise<void>;
  onClear?: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!onSave) return;
    setSaving(true);
    await onSave(draft);
    setSaving(false);
    setEditing(false);
  };

  const handleClear = async () => {
    if (!onClear) return;
    setSaving(true);
    await onClear();
    setSaving(false);
  };

  return (
    <div className="flex items-center gap-4 px-5 py-4 group">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted">
        <Icon className="h-[18px] w-[18px] text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-semibold tracking-widest text-muted-foreground uppercase mb-0.5">
          {label}
        </p>
        {editing ? (
          <div className="flex items-center gap-2 mt-1">
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="h-8 text-sm rounded-lg"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSave();
                if (e.key === 'Escape') { setDraft(value); setEditing(false); }
              }}
            />
            <button onClick={handleSave} disabled={saving}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-green-500 text-white hover:bg-green-600 disabled:opacity-50 transition-colors">
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            </button>
            <button onClick={() => { setDraft(value); setEditing(false); }}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground hover:bg-muted/70 transition-colors">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <p className="text-sm font-semibold text-foreground truncate">{value || '—'}</p>
        )}
      </div>
      {!editing && (editable || clearable) && (
        <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          {editable && (
            <button onClick={() => { setDraft(value); setEditing(true); }}
              className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
              <Pencil className="h-3.5 w-3.5" />
            </button>
          )}
          {clearable && value && value !== '—' && (
            <button onClick={handleClear} disabled={saving}
              className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors disabled:opacity-50">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Change Password form ─────────────────────────────────────────────────────

const pwdSchema = z
  .object({
    currentPassword: z.string().min(1, 'Required'),
    newPassword: z
      .string()
      .min(8, 'At least 8 characters')
      .regex(/[A-Z]/, 'Must have an uppercase letter')
      .regex(/[0-9]/, 'Must have a number'),
    confirmPassword: z.string().min(1, 'Required'),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match',
  });

type PwdForm = z.infer<typeof pwdSchema>;

type ShowState = { current: boolean; new: boolean; confirm: boolean };

function PwdField({ id, label, showKey, show, onToggleShow, field, error }: {
  id: string;
  label: string;
  showKey: keyof ShowState;
  show: ShowState;
  onToggleShow: (key: keyof ShowState) => void;
  field: UseFormRegisterReturn;
  error?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
        {label}
      </Label>
      <div className="relative">
        <Input id={id} type={show[showKey] ? 'text' : 'password'}
          className="pr-10 h-10 rounded-xl bg-muted/30 border-border/60 focus:bg-background" {...field} />
        <button type="button" tabIndex={-1}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
          onClick={() => onToggleShow(showKey)}>
          {show[showKey] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function ChangePasswordForm() {
  const { toast } = useToast();
  const [show, setShow] = useState<ShowState>({ current: false, new: false, confirm: false });
  const [apiError, setApiError] = useState<string | null>(null);

  const { register, handleSubmit, watch, reset, formState: { errors, isValid } } = useForm<PwdForm>({
    resolver: zodResolver(pwdSchema),
    mode: 'onChange',
  });

  const newPwd = watch('newPassword') ?? '';
  const strength = newPwd ? getPasswordStrength(newPwd) : null;

  const toggleShow = (key: keyof ShowState) => setShow((s) => ({ ...s, [key]: !s[key] }));

  const mutation = useMutation({
    mutationFn: async (data: PwdForm) => {
      const r = await fetch('/api/users/me/change-password', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      let json: { success: boolean; error?: unknown; message?: string };
      try {
        json = await r.json();
      } catch {
        throw new Error('Server returned an unexpected response. Please try again.');
      }

      if (!json.success) {
        let msg = 'Something went wrong. Please try again.';
        if (typeof json.error === 'string' && json.error) {
          msg = json.error;
        } else if (json.error && typeof json.error === 'object') {
          const fieldErrors = Object.values(json.error as Record<string, string[]>).flat();
          if (fieldErrors.length > 0) msg = fieldErrors[0];
        }
        throw new Error(msg);
      }

      return json;
    },
    onSuccess: () => { toast({ title: 'Password updated successfully' }); reset(); setApiError(null); },
    onError: (err: Error) => setApiError(err.message),
  });

  return (
    <form onSubmit={handleSubmit((d) => { setApiError(null); mutation.mutate(d); })} className="space-y-4">
      <PwdField id="currentPassword" label="Current Password" showKey="current"
        show={show} onToggleShow={toggleShow}
        field={register('currentPassword')} error={errors.currentPassword?.message} />

      <PwdField id="newPassword" label="New Password" showKey="new"
        show={show} onToggleShow={toggleShow}
        field={register('newPassword')} error={errors.newPassword?.message} />

      {newPwd && strength && (
        <div className="space-y-1 -mt-1">
          <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
            <div className={cn('h-full rounded-full transition-all duration-300', strength.color, strength.width)} />
          </div>
          <p className={cn('text-xs font-medium',
            strength.level === 'strong' ? 'text-green-600' :
            strength.level === 'medium' ? 'text-amber-600' : 'text-red-600'
          )}>{strength.label}</p>
        </div>
      )}

      <PwdField id="confirmPassword" label="Confirm New Password" showKey="confirm"
        show={show} onToggleShow={toggleShow}
        field={register('confirmPassword')} error={errors.confirmPassword?.message} />

      {apiError && (
        <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">
          {apiError}
        </div>
      )}

      <Button type="submit" disabled={!isValid || mutation.isPending}
        className="w-full h-10 rounded-xl font-semibold">
        {mutation.isPending
          ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          : <Lock className="mr-2 h-4 w-4" />}
        Update Password
      </Button>
    </form>
  );
}

// ─── Security PIN form (Super Admin only) ──────────────────────────────────────
// Gates destructive tools like Bulk Delete Leads. Changing it always
// requires the account password (proves it's really this admin), plus the
// current PIN if one is already set (proves continuity of possession).
//
// Deliberately uses the same single-line masked-input style as the password
// form right above it (not the segmented digit boxes from PinInput) — this
// is a settings form where you type a PIN you already know, not a one-time
// OTP-style entry moment, so it should look and behave like every other
// field on this page.

interface PinStatus {
  isSet: boolean;
  setAt: string | null;
}

type PinShowState = { old: boolean; new: boolean; confirm: boolean; password: boolean };

function PinField({
  id, label, value, onChange, showKey, show, onToggleShow, error, placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  showKey: keyof PinShowState;
  show: PinShowState;
  onToggleShow: (key: keyof PinShowState) => void;
  error?: string;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
        {label}
      </Label>
      <div className="relative">
        <Input
          id={id}
          type={show[showKey] ? 'text' : 'password'}
          inputMode="numeric"
          autoComplete="off"
          maxLength={6}
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
          placeholder={placeholder ?? '6-digit PIN'}
          className="pr-10 h-10 rounded-xl bg-muted/30 border-border/60 focus:bg-background tracking-[0.35em]"
        />
        <button type="button" tabIndex={-1}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
          onClick={() => onToggleShow(showKey)}>
          {show[showKey] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function SecurityPinForm() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [show, setShow] = useState<PinShowState>({ old: false, new: false, confirm: false, password: false });
  const [password, setPassword] = useState('');
  const [oldPin, setOldPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [apiError, setApiError] = useState<string | null>(null);

  const toggleShow = (key: keyof PinShowState) => setShow((s) => ({ ...s, [key]: !s[key] }));

  const { data: status, isLoading } = useQuery<PinStatus>({
    queryKey: ['security-pin-status'],
    queryFn: () => fetch('/api/super-admin/security-pin').then((r) => r.json()),
  });

  const mutation = useMutation({
    mutationFn: async () => {
      const r = await fetch('/api/super-admin/security-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, oldPin: status?.isSet ? oldPin : undefined, newPin }),
      });
      const json = await r.json();
      if (!json.success) throw new Error(json.error ?? 'Something went wrong');
      return json;
    },
    onSuccess: (json) => {
      toast({ title: json.message ?? 'PIN updated' });
      setPassword(''); setOldPin(''); setNewPin(''); setConfirmPin(''); setApiError(null);
      qc.invalidateQueries({ queryKey: ['security-pin-status'] });
    },
    onError: (err: Error) => setApiError(err.message),
  });

  const formValid =
    password.length > 0 &&
    (!status?.isSet || oldPin.length === 6) &&
    newPin.length === 6 &&
    confirmPin.length === 6 &&
    newPin === confirmPin;

  if (isLoading) {
    return <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); setApiError(null); mutation.mutate(); }}
      className="space-y-5"
    >
      <div className="flex items-center gap-2">
        <Badge variant={status?.isSet ? 'success' : 'outline'} className="text-[10px]">
          {status?.isSet ? 'PIN configured' : 'Not configured'}
        </Badge>
        {status?.isSet && status.setAt && (
          <span className="text-xs text-muted-foreground">Last set {formatDateTime(status.setAt)}</span>
        )}
      </div>

      <div className={cn('grid gap-4', status?.isSet && 'sm:grid-cols-2')}>
        {status?.isSet && (
          <PinField
            id="oldPin" label="Current PIN" value={oldPin} onChange={setOldPin}
            showKey="old" show={show} onToggleShow={toggleShow}
          />
        )}
        <PinField
          id="newPin" label={status?.isSet ? 'New PIN' : 'Set a 6-digit PIN'} value={newPin} onChange={setNewPin}
          showKey="new" show={show} onToggleShow={toggleShow}
        />
        <PinField
          id="confirmPin" label="Confirm New PIN" value={confirmPin} onChange={setConfirmPin}
          showKey="confirm" show={show} onToggleShow={toggleShow}
          error={confirmPin.length === 6 && confirmPin !== newPin ? 'PINs do not match' : undefined}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="pinPassword" className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
          Account Password
        </Label>
        <div className="relative">
          <Input
            id="pinPassword"
            type={show.password ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Confirm it's you"
            className="pr-10 h-10 rounded-xl bg-muted/30 border-border/60 focus:bg-background"
          />
          <button type="button" tabIndex={-1}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => toggleShow('password')}>
            {show.password ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {apiError && (
        <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">
          {apiError}
        </div>
      )}

      <Button type="submit" disabled={!formValid || mutation.isPending} className="w-full h-10 rounded-xl font-semibold">
        {mutation.isPending
          ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          : <KeyRound className="mr-2 h-4 w-4" />}
        {status?.isSet ? 'Update PIN' : 'Set PIN'}
      </Button>
    </form>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ProfilePage() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: user, isLoading } = useQuery<ProfileData>({
    queryKey: ['my-profile'],
    queryFn: () => fetch('/api/users/me').then((r) => r.json()),
  });

  const updateMutation = useMutation({
    mutationFn: (data: { name?: string; phone?: string | null }) =>
      fetch('/api/users/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }).then(async (r) => {
        const json = await r.json();
        if (!json.success) throw new Error(json.error ?? 'Update failed');
        return json;
      }),
    onSuccess: () => {
      toast({ title: 'Profile updated' });
      qc.invalidateQueries({ queryKey: ['my-profile'] });
    },
    onError: (err: Error) => toast({ variant: 'destructive', title: 'Error', description: err.message }),
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) return null;

  const initials = getInitials(user.name);
  const roleLabel = ROLE_LABELS[user.role] ?? user.role.replace(/_/g, ' ');
  const group = user.team?.name ?? user.operationsGroup?.name ?? null;
  const groupLabel = user.team ? 'Team' : 'Operations Group';

  return (
    <div className="space-y-1">

      {/* Page title */}
      <div className="mb-5">
        <h1 className="text-2xl font-bold tracking-tight">My Profile</h1>
        <p className="text-sm text-muted-foreground">Your account information</p>
      </div>

      {/* ── Layout: short identity sidebar + one settings column ────────────────
          Deliberately NOT trying to height-match two columns — the sidebar is
          short by nature (just identity), the settings column is long by
          nature (five sections). Forcing them to look "balanced" is what
          caused the empty gaps / lopsided pairing in earlier passes. */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">

        {/* ── Sidebar (1 / 3) ──────────────────────────────────────────────────── */}
        <div className="lg:col-span-1">
          <Card className="overflow-hidden rounded-2xl border-0 shadow-md lg:sticky lg:top-5">
            <div className="h-24 bg-gradient-to-br from-blue-500 via-blue-600 to-indigo-600" />
            <div className="px-6 pb-6">
              <div className="-mt-11 mb-4">
                <div className="relative inline-block">
                  <div className="h-[72px] w-[72px] rounded-full border-[3px] border-background bg-gradient-to-br from-blue-400 to-indigo-600 flex items-center justify-center shadow-lg">
                    <span className="text-2xl font-bold text-white tracking-tight select-none">
                      {initials}
                    </span>
                  </div>
                  <span className="absolute bottom-1 right-1 h-3.5 w-3.5 rounded-full bg-green-500 border-2 border-background" />
                </div>
              </div>
              <h2 className="text-xl font-bold leading-tight">{user.name}</h2>
              <p className="text-sm text-muted-foreground mt-0.5">{roleLabel}</p>

              <div className="mt-4 flex flex-wrap gap-1.5">
                <Badge variant={user.status === 'ACTIVE' ? 'success' : 'warning'} className="text-[10px]">
                  {user.status}
                </Badge>
                <Badge variant="outline" className="text-[10px]">
                  {user.workType === 'WFH' ? 'Work From Home' : 'Work From Office'}
                </Badge>
              </div>

              <div className="mt-5 space-y-3 border-t border-border/60 pt-4">
                {user.manager && (
                  <div className="flex items-center gap-2.5 text-xs">
                    <UserCog className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="text-muted-foreground">Reports to</span>
                    <span className="ml-auto font-medium text-foreground">{user.manager.name}</span>
                  </div>
                )}
                <div className="flex items-center gap-2.5 text-xs">
                  <Calendar className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="text-muted-foreground">Joined</span>
                  <span className="ml-auto font-medium text-foreground">{formatDateTime(user.joiningDate)}</span>
                </div>
                <div className="flex items-center gap-2.5 text-xs">
                  <Clock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="text-muted-foreground">Account created</span>
                  <span className="ml-auto font-medium text-foreground">{formatDateTime(user.createdAt)}</span>
                </div>
                {group && (
                  <div className="flex items-center gap-2.5 text-xs">
                    <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="text-muted-foreground">{groupLabel}</span>
                    <span className="ml-auto font-medium text-foreground">{group}</span>
                  </div>
                )}
              </div>
            </div>
          </Card>
        </div>

        {/* ── Settings column (2 / 3) ──────────────────────────────────────────── */}
        <div className="lg:col-span-2 space-y-4">

          {/* Personal information card */}
          <Card className="overflow-hidden rounded-2xl border-0 shadow-sm">
            <div className="px-5 pt-4 pb-1">
              <h3 className="text-sm font-semibold text-foreground">Personal Information</h3>
              <p className="text-xs text-muted-foreground">Hover a row to edit</p>
            </div>
            <div className="divide-y divide-border/60 mt-1">
              <InfoRow
                icon={User}
                label="Full Name" value={user.name}
                editable
                onSave={(val) => updateMutation.mutateAsync({ name: val })}
              />
              <InfoRow
                icon={Mail}
                label="Email" value={user.email}
              />
              <InfoRow
                icon={Phone}
                label="Phone Number" value={user.phone ?? ''}
                editable clearable
                onSave={(val) => updateMutation.mutateAsync({ phone: val })}
                onClear={() => updateMutation.mutateAsync({ phone: null })}
              />
            </div>
          </Card>

          {/* Feedback activity heatmap — renders nothing for users with no activity */}
          <ActivityHeatmap />

          {/* Security card */}
          <Card className="rounded-2xl border-0 shadow-sm">
            <CardHeader className="px-5 pb-3 pt-5">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted">
                  <Lock className="h-[18px] w-[18px] text-muted-foreground" />
                </div>
                <div>
                  <CardTitle className="text-base">Security</CardTitle>
                  <CardDescription className="text-xs">Change your account password</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="px-5 pb-5 pt-1">
              <ChangePasswordForm />
            </CardContent>
          </Card>

          {/* Security PIN card — Super Admin only */}
          {user.role === 'SUPER_ADMIN' && (
            <Card id="security-pin" className="rounded-2xl border-0 shadow-sm scroll-mt-4">
              <CardHeader className="px-5 pb-3 pt-5">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted">
                    <KeyRound className="h-[18px] w-[18px] text-muted-foreground" />
                  </div>
                  <div>
                    <CardTitle className="text-base">Security PIN</CardTitle>
                    <CardDescription className="text-xs">
                      Required to unlock destructive tools like Bulk Delete Leads
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="px-5 pb-5 pt-1">
                <SecurityPinForm />
              </CardContent>
            </Card>
          )}

        </div>
      </div>
    </div>
  );
}
