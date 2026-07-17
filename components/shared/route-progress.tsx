'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';

/**
 * Thin animated progress bar across the top of the viewport during page
 * navigation (YouTube/GitHub style). App Router has no navigation events, so:
 * start on any same-origin link click that targets a different path, and
 * finish when `usePathname()` reports the new route has rendered.
 */
export function RouteProgress() {
  const pathname = usePathname();
  const prevPath = useRef(pathname);
  const [width, setWidth] = useState(0);
  const [visible, setVisible] = useState(false);
  const trickleTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopTrickle = () => {
    if (trickleTimer.current) clearInterval(trickleTimer.current);
    trickleTimer.current = null;
  };

  useEffect(() => {
    const start = () => {
      stopTrickle();
      setVisible(true);
      setWidth(12);
      // Creep toward 85% while the new page loads, slowing as it approaches
      trickleTimer.current = setInterval(() => {
        setWidth((w) => (w >= 85 ? w : w + (85 - w) * 0.12));
      }, 180);
    };

    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      const anchor = (e.target as HTMLElement).closest('a');
      if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return;
      const href = anchor.getAttribute('href');
      if (!href || !href.startsWith('/')) return;
      const url = new URL(href, window.location.origin);
      if (url.pathname === window.location.pathname) return;
      start();
    };

    document.addEventListener('click', onClick, true);
    return () => {
      document.removeEventListener('click', onClick, true);
      stopTrickle();
    };
  }, []);

  // Route rendered — snap to 100% and fade out
  useEffect(() => {
    if (pathname === prevPath.current) return;
    prevPath.current = pathname;
    stopTrickle();
    setWidth(100);
    const t = setTimeout(() => {
      setVisible(false);
      setWidth(0);
    }, 350);
    return () => clearTimeout(t);
  }, [pathname]);

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-x-0 top-0 z-[200] h-[3px]"
      style={{ opacity: visible ? 1 : 0, transition: 'opacity 250ms ease 100ms' }}
    >
      <div
        className="h-full rounded-r-full bg-gradient-to-r from-primary via-violet-500 to-primary shadow-[0_0_8px_rgba(99,102,241,0.6)]"
        style={{ width: `${width}%`, transition: 'width 200ms ease' }}
      />
    </div>
  );
}
