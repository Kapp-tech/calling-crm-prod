'use client';

import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

interface PinInputProps {
  value: string;
  onChange: (value: string) => void;
  length?: number;
  autoFocus?: boolean;
  disabled?: boolean;
  error?: boolean;
  onComplete?: (value: string) => void;
  /** Overrides the wrapper's alignment classes (defaults to centered — the
   * PIN-gate prompt look). Forms with left-aligned labels pass justify-start
   * so the boxes line up with the rest of the fields. */
  className?: string;
}

/** A row of individual digit boxes for entering a numeric PIN — auto-advances
 * focus as you type, handles backspace/arrow navigation, and accepts a full
 * code pasted in one go. Shared by the PIN-gate prompt and the profile
 * page's set/change-PIN form so both look and behave identically. */
export function PinInput({ value, onChange, length = 6, autoFocus, disabled, error, onComplete, className }: PinInputProps) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (autoFocus) refs.current[0]?.focus();
  }, [autoFocus]);

  const digits = Array.from({ length }, (_, i) => value[i] ?? '');

  function setDigit(index: number, digit: string) {
    const next = digits.slice();
    next[index] = digit;
    const joined = next.join('');
    onChange(joined);
    if (!next.includes('')) onComplete?.(joined);
  }

  function handleChange(index: number, raw: string) {
    const digitsOnly = raw.replace(/\D/g, '');
    if (digitsOnly.length === 0) { setDigit(index, ''); return; }
    if (digitsOnly.length > 1) {
      // Pasted or fast-typed multiple characters into one box — spread them
      // across this box and the following ones.
      const next = value.split('');
      for (let i = 0; i < digitsOnly.length && index + i < length; i++) {
        next[index + i] = digitsOnly[i];
      }
      const joined = next.join('').slice(0, length);
      onChange(joined);
      const lastFilled = Math.min(index + digitsOnly.length, length - 1);
      refs.current[lastFilled]?.focus();
      if (joined.length === length) onComplete?.(joined);
      return;
    }
    setDigit(index, digitsOnly);
    if (index < length - 1) refs.current[index + 1]?.focus();
  }

  function handleKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      refs.current[index - 1]?.focus();
    } else if (e.key === 'ArrowLeft' && index > 0) {
      e.preventDefault();
      refs.current[index - 1]?.focus();
    } else if (e.key === 'ArrowRight' && index < length - 1) {
      e.preventDefault();
      refs.current[index + 1]?.focus();
    }
  }

  return (
    <div className={cn('flex items-center gap-2', className ?? 'justify-center')}>
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => { refs.current[i] = el; }}
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={length}
          disabled={disabled}
          value={d}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onFocus={(e) => e.target.select()}
          className={cn(
            'h-12 w-10 rounded-lg border bg-background text-center text-lg font-semibold tracking-widest outline-none transition-colors',
            'focus:ring-2 focus:ring-ring focus:border-primary',
            error ? 'border-destructive' : 'border-input',
            disabled && 'opacity-50 cursor-not-allowed',
          )}
        />
      ))}
    </div>
  );
}
