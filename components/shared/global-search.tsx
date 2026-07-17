'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Loader2, Phone, MapPin, GraduationCap, UserCheck } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SearchResult {
  id: string;
  name: string;
  phone: string;
  email: string;
  city: string | null;
  course: string | null;
  status: 'PENDING' | 'APPROVED' | 'DISAPPROVED';
  assignedTo: { name: string } | null;
}

const STATUS_STYLES: Record<SearchResult['status'], string> = {
  PENDING: 'text-amber-600 border-amber-300/50 bg-amber-500/10',
  APPROVED: 'text-emerald-600 border-emerald-300/50 bg-emerald-500/10',
  DISAPPROVED: 'text-red-600 border-red-300/50 bg-red-500/10',
};

export function GlobalSearch() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // ⌘K / Ctrl+K opens from anywhere in the dashboard
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Debounce typing so we don't fire a request per keystroke
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setDebounced('');
      setActiveIndex(0);
      // Focus after the enter animation has mounted the input
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const { data: results = [], isFetching } = useQuery<SearchResult[]>({
    queryKey: ['global-lead-search', debounced],
    queryFn: async () => {
      const r = await fetch(`/api/leads/search?q=${encodeURIComponent(debounced)}`);
      if (!r.ok) throw new Error('Search failed');
      const d = await r.json();
      return Array.isArray(d) ? d : [];
    },
    enabled: open && debounced.length >= 2,
    staleTime: 30_000,
  });

  useEffect(() => setActiveIndex(0), [results]);

  const openLead = useCallback(
    (id: string) => {
      setOpen(false);
      router.push(`/leads/${id}/profile`);
    },
    [router],
  );

  const onInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && results[activeIndex]) {
      e.preventDefault();
      openLead(results[activeIndex].id);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  // Keep the active row visible while arrowing through results
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  return (
    <>
      {/* Trigger — full pill on desktop, icon on mobile */}
      <button
        onClick={() => setOpen(true)}
        aria-label="Search leads"
        className="hidden sm:flex h-9 w-52 md:w-64 items-center gap-2 rounded-lg border border-input bg-muted/40 px-3 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <Search className="h-4 w-4 shrink-0" />
        <span className="flex-1 text-left truncate">Search leads…</span>
        <kbd className="pointer-events-none rounded border bg-background px-1.5 py-0.5 text-[10px] font-medium">
          ⌘K
        </kbd>
      </button>
      <button
        onClick={() => setOpen(true)}
        aria-label="Search leads"
        className="flex sm:hidden h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
      >
        <Search className="h-5 w-5" />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm p-4 pt-[12vh] sm:pt-[18vh]"
            onClick={() => setOpen(false)}
            role="dialog"
            aria-modal="true"
            aria-label="Search leads"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: -8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: -8 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              className="mx-auto w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-background shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-3 border-b border-border px-4">
                {isFetching ? (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
                ) : (
                  <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
                )}
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={onInputKeyDown}
                  placeholder="Search by Lead ID, name, phone or email…"
                  className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                />
                <kbd className="hidden sm:block rounded border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                  Esc
                </kbd>
              </div>

              <div ref={listRef} className="max-h-[50vh] overflow-y-auto p-2">
                {debounced.length < 2 ? (
                  <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                    Type at least 2 characters to search leads
                  </p>
                ) : results.length === 0 && !isFetching ? (
                  <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                    No leads found for &ldquo;{debounced}&rdquo;
                  </p>
                ) : (
                  results.map((lead, i) => (
                    <button
                      key={lead.id}
                      data-index={i}
                      onClick={() => openLead(lead.id)}
                      onMouseEnter={() => setActiveIndex(i)}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors',
                        i === activeIndex ? 'bg-muted' : 'hover:bg-muted/60',
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium">{lead.name}</span>
                          <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                            {lead.id}
                          </span>
                          <span
                            className={cn(
                              'shrink-0 rounded-full border px-2 py-px text-[10px] font-medium',
                              STATUS_STYLES[lead.status],
                            )}
                          >
                            {lead.status.charAt(0) + lead.status.slice(1).toLowerCase()}
                          </span>
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                          <span className="inline-flex items-center gap-1">
                            <Phone className="h-3 w-3" /> {lead.phone}
                          </span>
                          {lead.course && (
                            <span className="inline-flex items-center gap-1 truncate">
                              <GraduationCap className="h-3 w-3 shrink-0" /> {lead.course}
                            </span>
                          )}
                          {lead.city && (
                            <span className="inline-flex items-center gap-1">
                              <MapPin className="h-3 w-3" /> {lead.city}
                            </span>
                          )}
                          {lead.assignedTo && (
                            <span className="inline-flex items-center gap-1">
                              <UserCheck className="h-3 w-3" /> {lead.assignedTo.name}
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
