'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, ChevronDown, Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface MultiSelectOption {
  value: string;
  label: string;
}

/**
 * How many options are rendered at once. Matching is not capped — see `matches`
 * — only the rows put in the DOM, so a 9,700-entry college list stays usable.
 */
const DISPLAY_LIMIT = 250;

/** Searchable, multi-select dropdown filter — button trigger + popover with a
 * search box, checkbox list, and selected-chips footer. Shared by any filter
 * bar that needs to match the All Leads page's city/state/course/college/etc.
 * filter UX exactly. */
export function MultiSelectFilter({
  placeholder,
  options,
  selected,
  onChange,
  loading,
  triggerClassName,
  selectAll,
}: {
  placeholder: string;
  options: MultiSelectOption[];
  selected: string[];
  onChange: (v: string[]) => void;
  loading?: boolean;
  /**
   * Adds a "Select all" row at the top of the list.
   *
   * Opt-in rather than always on, because several filters here are backed by
   * lists that are long enough for it to be a trap: the All Leads city filter
   * carries 946 values on production, and selecting them all would put roughly
   * 20 KB of city names into the query string. Turn it on where the list is
   * short and bounded.
   */
  selectAll?: boolean;
  /** Overrides the trigger button's sizing classes (defaults to the compact
   * inline-filter-bar look used on the All Leads page). */
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  // Reset search when closed
  useEffect(() => { if (!open) setQuery(''); }, [open]);

  /**
   * Matching is split from displaying, because they need different answers.
   *
   * `matches` is every option the search matches, uncapped — that is what
   * "Select all matching (312)" has to act on and count. `filtered` is only
   * what gets rendered, capped so a 9,700-row college list does not put
   * thousands of nodes in the DOM.
   *
   * They used to be the same truncated list, which made Select all quietly
   * wrong: a search with 400 hits selected the first 250 and labelled itself
   * "(250)", so the number looked right and the result was not.
   */
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  const filtered = useMemo(() => matches.slice(0, DISPLAY_LIMIT), [matches]);
  const truncated = matches.length > DISPLAY_LIMIT;

  function toggle(value: string) {
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  }

  /**
   * What "Select all" acts on: the search results while a query is typed,
   * everything otherwise. Acting on the whole list while the reader is looking
   * at four matches would select things they cannot see.
   */
  const bulkTarget = matches;
  const allBulkSelected =
    bulkTarget.length > 0 && bulkTarget.every((o) => selected.includes(o.value));
  const someBulkSelected = bulkTarget.some((o) => selected.includes(o.value));

  function toggleAll() {
    const values = bulkTarget.map((o) => o.value);
    if (allBulkSelected) {
      const drop = new Set(values);
      // Only clears what is in view — a selection made under a different search
      // survives, which is what the checkbox in front of them says it will do.
      onChange(selected.filter((v) => !drop.has(v)));
    } else {
      onChange(Array.from(new Set([...selected, ...values])));
    }
  }

  // Button label
  const btnLabel = useMemo(() => {
    if (selected.length === 0) return null;
    if (selected.length === 1) {
      return options.find((o) => o.value === selected[0])?.label ?? selected[0];
    }
    if (selected.length === 2) {
      return selected.map((v) => options.find((o) => o.value === v)?.label ?? v).join(', ');
    }
    return `${selected.length} selected`;
  }, [selected, options]);

  return (
    <div ref={ref} className="relative flex-1 min-w-[calc(50%-0.25rem)] sm:flex-none sm:min-w-0">
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring flex items-center gap-1.5',
          triggerClassName ?? 'h-8 w-full sm:w-auto sm:min-w-[120px] sm:max-w-[200px]',
          selected.length > 0 ? 'text-foreground border-primary/50' : 'text-muted-foreground'
        )}
      >
        <span className="flex-1 truncate text-left text-xs">
          {btnLabel ?? placeholder}
        </span>
        {selected.length > 0 && (
          <span
            className="flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-primary-foreground shrink-0"
            onClick={(e) => { e.stopPropagation(); onChange([]); }}
            title="Clear"
          >
            {selected.length > 9 ? '9+' : selected.length}
          </span>
        )}
        <ChevronDown className={cn('h-3 w-3 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 w-64 max-w-[calc(100vw-2.5rem)] rounded-md border border-border bg-background shadow-lg flex flex-col">
          {/* Search */}
          <div className="flex items-center gap-1.5 border-b border-border px-2.5 py-1.5 shrink-0">
            <Search className="h-3 w-3 text-muted-foreground shrink-0" />
            <input
              autoFocus
              className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
              placeholder={`Search ${placeholder.toLowerCase()}…`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <button onClick={() => setQuery('')} className="text-muted-foreground hover:text-foreground">
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          {/* Select all */}
          {(selectAll || query.trim().length > 0) && !loading && bulkTarget.length > 0 && (
            <button
              type="button"
              onClick={toggleAll}
              className="flex w-full items-center gap-2 border-b border-border/60 px-2.5 py-1.5 text-xs font-medium hover:bg-muted/50"
            >
              <span
                className={cn(
                  'flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border',
                  allBulkSelected
                    ? 'border-primary bg-primary'
                    : someBulkSelected
                      ? 'border-primary bg-primary/25'
                      : 'border-input',
                )}
              >
                {allBulkSelected && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                {/* A dash, not a tick, when only some are on — a tick would claim
                    the whole list is selected. */}
                {!allBulkSelected && someBulkSelected && <span className="h-0.5 w-2 rounded-full bg-primary" />}
              </span>
              <span className="truncate">
                {allBulkSelected ? 'Clear all' : 'Select all'}
                {query.trim() && ` matching (${bulkTarget.length})`}
              </span>
            </button>
          )}

          {/* Options list */}
          <ul className="max-h-56 overflow-y-auto py-0.5">
            {loading && (
              <li className="px-3 py-2 text-xs text-muted-foreground">Loading…</li>
            )}
            {!loading && filtered.length === 0 && (
              <li className="px-3 py-2 text-xs text-muted-foreground">No results</li>
            )}
            {/* Said out loud, because Select all acts on all {matches.length}
                while only the first {DISPLAY_LIMIT} are listed — without this the
                counts would appear to disagree. */}
            {!loading && truncated && (
              <li className="border-b border-border/40 bg-muted/20 px-2.5 py-1.5 text-[11px] text-muted-foreground">
                Showing first {DISPLAY_LIMIT} of {matches.length}. Select all still applies to all {matches.length}.
              </li>
            )}
            {!loading && filtered.map((opt) => {
              const checked = selected.includes(opt.value);
              return (
                <li
                  key={opt.value}
                  onClick={() => toggle(opt.value)}
                  className="flex cursor-pointer items-center gap-2 px-2.5 py-1.5 text-xs hover:bg-muted/50 select-none"
                >
                  <span className={cn(
                    'flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border',
                    checked ? 'bg-primary border-primary' : 'border-input'
                  )}>
                    {checked && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                  </span>
                  <span className="truncate">{opt.label}</span>
                </li>
              );
            })}
            {!query && options.length > 250 && (
              <li className="px-3 py-1.5 text-[10px] text-muted-foreground italic border-t border-border/40">
                Showing 250 of {options.length} — type to search all
              </li>
            )}
          </ul>

          {/* Footer: selected chips + clear link */}
          {selected.length > 0 && (
            <div className="border-t border-border/60 px-2.5 py-1.5 flex items-center justify-between gap-2 shrink-0">
              <div className="flex flex-wrap gap-1 flex-1 min-w-0">
                {selected.slice(0, 4).map((v) => {
                  const lbl = options.find((o) => o.value === v)?.label ?? v;
                  return (
                    <span key={v} className="inline-flex items-center gap-0.5 rounded bg-primary/15 border border-primary/30 px-1.5 py-0.5 text-[10px] text-primary">
                      <span className="max-w-[80px] truncate">{lbl}</span>
                      <button onClick={(e) => { e.stopPropagation(); toggle(v); }} className="hover:text-destructive ml-0.5">
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </span>
                  );
                })}
                {selected.length > 4 && (
                  <span className="text-[10px] text-muted-foreground self-center">+{selected.length - 4} more</span>
                )}
              </div>
              <button onClick={() => onChange([])} className="text-[10px] text-muted-foreground hover:text-destructive shrink-0">
                Clear
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
