'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';

export interface TourStep {
  /** CSS selector of the element to spotlight (e.g. '[data-tour="leads-table"]') */
  target: string;
  title: string;
  body: string;
}

const PAD = 8; // px of breathing room around the spotlit element

interface Rect { top: number; left: number; width: number; height: number }

/**
 * Dimmed-background spotlight tour. Give it steps with data-tour selectors;
 * steps whose target is missing or hidden are skipped automatically, so it's
 * safe across mobile/desktop layout differences. `storageKey` makes it
 * one-time: once finished or skipped it never shows again on that device.
 */
export function OnboardingTour({ steps, storageKey }: { steps: TourStep[]; storageKey: string }) {
  const [active, setActive] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const rafRef = useRef<number | null>(null);

  // Genuinely reachable: rendered, has size, and not translated off-screen
  // horizontally (the mobile sidebar sits at -100% translate — offsetParent
  // alone can't catch that). Below-the-fold is fine; we scroll to it.
  const isReachable = (el: Element): boolean => {
    if ((el as HTMLElement).offsetParent === null) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.right > 0 && r.left < window.innerWidth;
  };

  // Resolve the first reachable target at or after `from`; null when none remain
  const resolveStep = useCallback(
    (from: number): { index: number; el: Element } | null => {
      for (let i = from; i < steps.length; i++) {
        const el = document.querySelector(steps[i].target);
        if (el && isReachable(el)) return { index: i, el };
      }
      return null;
    },
    [steps],
  );

  const measure = useCallback((el: Element) => {
    const r = el.getBoundingClientRect();
    setRect({ top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 });
  }, []);

  const goTo = useCallback(
    (from: number) => {
      const found = resolveStep(from);
      if (!found) {
        localStorage.setItem(storageKey, 'done');
        setActive(false);
        return;
      }
      setStepIndex(found.index);
      found.el.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior });
      // measure after scroll has settled
      rafRef.current = requestAnimationFrame(() => measure(found.el));
    },
    [resolveStep, measure, storageKey],
  );

  // Launch once the first target actually exists. Data (the leads table)
  // renders asynchronously, so poll for up to ~15s instead of checking once.
  useEffect(() => {
    if (localStorage.getItem(storageKey)) return;
    let cancelled = false;
    let attempts = 0;
    const tryStart = () => {
      if (cancelled) return;
      const found = resolveStep(0);
      if (found) {
        setActive(true);
        goTo(found.index);
      } else if (++attempts < 25) {
        setTimeout(tryStart, 600);
      }
    };
    const t = setTimeout(tryStart, 900);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the spotlight glued to its target on resize/scroll
  useEffect(() => {
    if (!active) return;
    const sync = () => {
      const el = document.querySelector(steps[stepIndex]?.target ?? '');
      if (el) measure(el);
    };
    window.addEventListener('resize', sync);
    window.addEventListener('scroll', sync, true);
    return () => {
      window.removeEventListener('resize', sync);
      window.removeEventListener('scroll', sync, true);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [active, stepIndex, steps, measure]);

  const finish = () => {
    localStorage.setItem(storageKey, 'done');
    setActive(false);
  };

  if (!active || !rect) return null;

  const step = steps[stepIndex];
  const isLast = resolveStep(stepIndex + 1) === null;

  // Place the card below the target when there's room, else above
  const spaceBelow = window.innerHeight - (rect.top + rect.height);
  const cardBelow = spaceBelow > 190;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[150]" role="dialog" aria-modal="true" aria-label="Onboarding tour">
        {/* Spotlight — the giant shadow dims everything except the target */}
        <motion.div
          initial={false}
          animate={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          className="absolute rounded-xl ring-2 ring-primary/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.7)]"
        />

        {/* Step card */}
        <motion.div
          key={stepIndex}
          initial={{ opacity: 0, y: cardBelow ? 10 : -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="absolute w-[300px] max-w-[calc(100vw-2rem)] rounded-2xl border border-border bg-background p-4 shadow-2xl"
          style={{
            top: cardBelow ? rect.top + rect.height + 12 : undefined,
            bottom: cardBelow ? undefined : window.innerHeight - rect.top + 12,
            left: Math.min(Math.max(12, rect.left), window.innerWidth - 316),
          }}
        >
          <p className="text-[10px] font-bold uppercase tracking-widest text-primary">
            Step {stepIndex + 1} of {steps.length}
          </p>
          <p className="mt-1 text-sm font-semibold">{step.title}</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{step.body}</p>

          <div className="mt-3 flex items-center justify-between">
            <div className="flex gap-1">
              {steps.map((_, i) => (
                <span
                  key={i}
                  className={cn('h-1.5 w-1.5 rounded-full', i === stepIndex ? 'bg-primary' : 'bg-muted')}
                />
              ))}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={finish}
                className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                Skip
              </button>
              <button
                onClick={() => (isLast ? finish() : goTo(stepIndex + 1))}
                className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-all hover:brightness-110"
              >
                {isLast ? 'Done' : 'Next'}
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
