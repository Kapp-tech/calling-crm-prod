'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

const STORAGE_KEY = 'ka-read-announcements';

export function getReadIds(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set<string>();
  } catch {
    return new Set<string>();
  }
}

export function markAllAnnouncementsRead(ids: string[]) {
  try {
    const existing = getReadIds();
    ids.forEach((id) => existing.add(id));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(existing)));
    // Signal same-tab listeners that read state changed
    window.dispatchEvent(new Event('ka-announcements-read'));
  } catch {
    // localStorage unavailable (e.g. private browsing)
  }
}

interface AnnouncementItem {
  id: string;
  [key: string]: unknown;
}

export function useUnreadAnnouncements() {
  const [readIds, setReadIds] = useState<Set<string>>(new Set());

  // Hydrate from localStorage after mount (avoids SSR mismatch)
  useEffect(() => {
    setReadIds(getReadIds());

    const handler = () => setReadIds(getReadIds());
    window.addEventListener('ka-announcements-read', handler);
    // Also sync across tabs
    window.addEventListener('storage', handler);
    return () => {
      window.removeEventListener('ka-announcements-read', handler);
      window.removeEventListener('storage', handler);
    };
  }, []);

  const { data: announcements = [] } = useQuery<AnnouncementItem[]>({
    queryKey: ['announcements'],
    queryFn: () =>
      fetch('/api/announcements')
        .then((r) => r.json())
        .then((d) => (Array.isArray(d) ? d : [])),
    refetchInterval: 30_000,
    staleTime: 20_000,
  });

  const unreadCount = announcements.filter((a) => !readIds.has(a.id)).length;

  return { unreadCount };
}
