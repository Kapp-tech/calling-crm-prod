import { useQuery } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';

type PermissionMap = Record<string, boolean>;

export function usePermissions() {
  const { data: session } = useSession();
  const userId = session?.user?.id ?? null;

  const { data, isLoading } = useQuery<PermissionMap>({
    // Include userId so switching accounts never serves a stale previous user's permissions
    queryKey: ['my-permissions', userId],
    queryFn: () =>
      fetch('/api/users/me/permissions').then(async (r) => {
        if (!r.ok) return {} as PermissionMap;
        return r.json();
      }),
    enabled: !!userId,
    staleTime: 60 * 1000, // 1 min — fresh enough for a session, short enough to reflect SA changes quickly
  });

  const can = (feature: string): boolean => data?.[feature] ?? false;

  return { can, isLoading, permissions: data ?? {} };
}
