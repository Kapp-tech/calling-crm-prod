'use client';

import { cn } from '@/lib/utils';
import { ChevronLeft, ChevronRight } from 'lucide-react';

const LIMIT_OPTIONS = [25, 50, 75, 100] as const;

interface PaginationBarProps {
  page: number;
  totalPages: number;
  total: number;
  limit: number;
  onPageChange: (p: number) => void;
  onLimitChange: (l: number) => void;
  disabled?: boolean;
  className?: string;
}

function buildPageWindow(current: number, total: number): (number | '…')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

  const pages: (number | '…')[] = [];

  if (current <= 4) {
    pages.push(1, 2, 3, 4, 5, '…', total);
  } else if (current >= total - 3) {
    pages.push(1, '…', total - 4, total - 3, total - 2, total - 1, total);
  } else {
    pages.push(1, '…', current - 1, current, current + 1, '…', total);
  }

  return pages;
}

export function PaginationBar({
  page, totalPages, total, limit,
  onPageChange, onLimitChange,
  disabled, className,
}: PaginationBarProps) {
  const from = total === 0 ? 0 : (page - 1) * limit + 1;
  const to   = Math.min(page * limit, total);
  const window = buildPageWindow(page, totalPages);

  return (
    <div className={cn('flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 sm:gap-3 px-1 py-2', className)}>
      {/* Left: rows-per-page selector + count */}
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-xs text-muted-foreground whitespace-nowrap">Rows per page</span>
        <select
          value={limit}
          onChange={(e) => { onLimitChange(Number(e.target.value)); onPageChange(1); }}
          disabled={disabled}
          className="h-7 rounded-md border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
        >
          {LIMIT_OPTIONS.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {from}–{to} of {total}
        </span>
      </div>

      {/* Right: page buttons */}
      <div className="flex items-center gap-1 shrink-0">
        {/* Prev */}
        <button
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1 || disabled}
          className="flex h-7 w-7 items-center justify-center rounded-md border border-input text-muted-foreground transition-colors hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
          aria-label="Previous page"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>

        {/* Page numbers */}
        {window.map((entry, i) =>
          entry === '…' ? (
            <span key={`ellipsis-${i}`} className="flex h-7 w-7 items-center justify-center text-xs text-muted-foreground select-none">
              …
            </span>
          ) : (
            <button
              key={entry}
              onClick={() => onPageChange(entry)}
              disabled={disabled}
              className={cn(
                'flex h-7 w-7 items-center justify-center rounded-md border text-xs font-medium transition-colors disabled:opacity-40',
                entry === page
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-input text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              {entry}
            </button>
          )
        )}

        {/* Next */}
        <button
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages || disabled}
          className="flex h-7 w-7 items-center justify-center rounded-md border border-input text-muted-foreground transition-colors hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
          aria-label="Next page"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
