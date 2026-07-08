'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Users, Loader2, Pencil, ToggleLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/components/ui/use-toast';
import { formatDateTime } from '@/lib/utils';

const teamSchema = z.object({
  name: z.string().min(2),
  description: z.string().optional(),
  teamLeadId: z.string().optional(),
});
type TeamForm = z.infer<typeof teamSchema>;

interface Team {
  id: string;
  name: string;
  description?: string | null;
  isActive: boolean;
  createdAt: string;
  teamLead?: { id: string; name: string; email: string } | null;
  _count: { members: number; leads: number };
}

interface TLUser { id: string; name: string; email: string }

export default function TeamsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showDialog, setShowDialog] = useState(false);
  const [editTeam, setEditTeam] = useState<Team | null>(null);

  const { data: teams = [], isLoading } = useQuery<Team[]>({
    queryKey: ['teams'],
    queryFn: () => fetch('/api/teams').then((r) => r.json()),
  });

  const { data: tls = [] } = useQuery<TLUser[]>({
    queryKey: ['users', 'tls'],
    queryFn: () => fetch('/api/users?role=COUNSELLING_TL').then((r) => r.json()),
  });

  const { register, handleSubmit, setValue, reset, formState: { errors } } = useForm<TeamForm>({
    resolver: zodResolver(teamSchema),
  });

  const saveMutation = useMutation({
    mutationFn: (data: TeamForm) => {
      if (editTeam) {
        return fetch(`/api/teams/${editTeam.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
        }).then((r) => r.json());
      }
      return fetch('/api/teams', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
      }).then((r) => r.json());
    },
    onSuccess: (data) => {
      if (data.success === false) { toast({ variant: 'destructive', title: 'Error', description: data.error }); return; }
      toast({ title: editTeam ? 'Team updated' : 'Team created' });
      qc.invalidateQueries({ queryKey: ['teams'] });
      setShowDialog(false); setEditTeam(null); reset();
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      fetch(`/api/teams/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isActive }) }).then((r) => r.json()),
    onSuccess: () => { toast({ title: 'Team updated' }); qc.invalidateQueries({ queryKey: ['teams'] }); },
  });

  const openCreate = () => { reset(); setEditTeam(null); setShowDialog(true); };
  const openEdit = (t: Team) => {
    setEditTeam(t);
    reset({ name: t.name, description: t.description ?? '', teamLeadId: t.teamLead?.id });
    setShowDialog(true);
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Teams</CardTitle>
          <Button onClick={openCreate}><Plus className="mr-2 h-4 w-4" />Create Team</Button>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Team Lead</TableHead>
                  <TableHead>Agents</TableHead>
                  <TableHead>Leads</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {teams.map((team) => (
                  <TableRow key={team.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <Users className="h-4 w-4 text-muted-foreground" />
                        {team.name}
                      </div>
                    </TableCell>
                    <TableCell>{team.teamLead?.name ?? <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell><Badge variant="secondary">{team._count.members}</Badge></TableCell>
                    <TableCell><Badge variant="info">{team._count.leads}</Badge></TableCell>
                    <TableCell>
                      <Badge variant={team.isActive ? 'success' : 'outline'}>
                        {team.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatDateTime(team.createdAt)}</TableCell>
                    <TableCell className="text-right space-x-1">
                      <Button variant="ghost" size="icon" onClick={() => openEdit(team)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => toggleMutation.mutate({ id: team.id, isActive: !team.isActive })}>
                        <ToggleLeft className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {teams.length === 0 && (
                  <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No teams yet</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editTeam ? 'Edit Team' : 'Create Team'}</DialogTitle></DialogHeader>
          <form onSubmit={handleSubmit((d) => saveMutation.mutate(d))} className="space-y-4">
            <div className="space-y-2">
              <Label>Team Name</Label>
              <Input {...register('name')} placeholder="e.g. Team Alpha" />
              {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Input {...register('description')} placeholder="Optional description" />
            </div>
            <div className="space-y-2">
              <Label>Team Lead</Label>
              <Select defaultValue={editTeam?.teamLead?.id} onValueChange={(v) => setValue('teamLeadId', v)}>
                <SelectTrigger><SelectValue placeholder="Select TL..." /></SelectTrigger>
                <SelectContent>
                  {tls.map((tl: TLUser) => (
                    <SelectItem key={tl.id} value={tl.id}>{tl.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowDialog(false)}>Cancel</Button>
              <Button type="submit" disabled={saveMutation.isPending}>
                {saveMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {editTeam ? 'Save Changes' : 'Create'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
