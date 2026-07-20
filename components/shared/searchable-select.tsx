'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SearchableSelectOption {
  value: string;
  label: string;
}

const INPUT_CLASS =
  'flex h-9 w-full items-center rounded-md border border-input bg-background px-3 text-[13px] text-foreground shadow-sm transition-all duration-150 placeholder:text-muted-foreground/60 hover:border-primary/40 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/15';

/** Single-value dropdown with an in-list search box — for long option lists (cities, courses, colleges…). */
export function SearchableSelect({
  options, value, onChange, placeholder, disabled,
}: {
  options: SearchableSelectOption[];
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    const list = !q ? options : options.filter((o) => o.label.toLowerCase().includes(q));
    return list.slice(0, 200);
  }, [options, query]);

  const label = options.find((o) => o.value === value)?.label;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((o) => !o)}
        className={cn(
          INPUT_CLASS, 'justify-between gap-2 cursor-pointer',
          disabled && 'cursor-not-allowed bg-muted/50 text-muted-foreground/90 hover:border-input'
        )}
      >
        <span className={cn('truncate text-left', !label && 'text-muted-foreground/60')}>
          {label ?? (placeholder ?? '— Select —')}
        </span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
      </button>

      {open && !disabled && (
        <div className="absolute z-50 mt-1 w-full rounded-md border border-border bg-background shadow-lg overflow-hidden">
          <div className="flex items-center gap-1.5 border-b border-border px-2.5 py-1.5">
            <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search…"
              className="flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground/60"
            />
          </div>

          <ul className="max-h-48 overflow-y-auto py-1">
            {filtered.length === 0 && (
              <li className="px-3 py-2 text-xs text-muted-foreground">No results</li>
            )}
            {filtered.map((opt) => {
              const checked = opt.value === value;
              return (
                <li
                  key={opt.value}
                  onClick={() => { onChange(opt.value); setOpen(false); setQuery(''); }}
                  className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-[13px] hover:bg-muted/50"
                >
                  <span className={cn(
                    'flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border border-input',
                    checked && 'border-primary bg-primary'
                  )}>
                    {checked && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                  </span>
                  <span className="truncate">{opt.label}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
