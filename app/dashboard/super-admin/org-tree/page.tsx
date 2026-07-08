'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { OrgTree } from '@/components/org-tree/org-tree';
import { UserDetailDrawer } from '@/components/org-tree/user-detail-drawer';

export default function OrgTreePage() {
  const [selectedUser, setSelectedUser] = useState<Parameters<typeof UserDetailDrawer>[0]['user']>(null);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['hierarchy'],
    queryFn: () => fetch('/api/users/hierarchy').then((r) => r.json()),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Organisation Hierarchy</h2>
          <p className="text-sm text-muted-foreground">Click any node to view profile &amp; perform actions</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`mr-2 h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
      ) : (
        <OrgTree data={data} onNodeClick={setSelectedUser} />
      )}

      <UserDetailDrawer user={selectedUser} onClose={() => setSelectedUser(null)} />
    </div>
  );
}
