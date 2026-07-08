'use client';

import { useQuery } from '@tanstack/react-query';
import { Loader2, RefreshCw, GitBranch } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { OrgTree } from '@/components/org-tree/org-tree';

export default function ReportsHierarchyPage() {
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['hierarchy'],
    queryFn: () => fetch('/api/users/hierarchy').then((r) => r.json()),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <GitBranch className="h-5 w-5 text-blue-600" />
            Organisation Hierarchy
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">Read-only view of the full organisation structure</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`mr-2 h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <OrgTree data={data} />
      )}
    </div>
  );
}
