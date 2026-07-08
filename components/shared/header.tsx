'use client';

import { usePathname } from 'next/navigation';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { Sun, Moon, Menu } from 'lucide-react';
import { NotificationBell } from '@/components/notifications/notification-bell';
import { PunchClockWidget } from '@/components/attendance/punch-clock-widget';

const PAGE_TITLES: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/dashboard/super-admin': 'User Management',
  '/dashboard/super-admin/teams': 'Team Management',
  '/dashboard/super-admin/org-tree': 'Organisation Hierarchy',
  '/dashboard/super-admin/permissions': 'Permission Matrix',
  '/dashboard/super-admin/performance': 'Performance Dashboard',
  '/dashboard/super-admin/activity-logs': 'Activity Logs',
  '/dashboard/super-admin/feedback-options': 'Feedback Options',
  '/dashboard/operations': 'Upload Leads',
  '/dashboard/reports': 'Lead Approvals',
  '/dashboard/leads': 'All Leads',
  '/dashboard/counselling-tl': 'Assign Leads',
  '/dashboard/counselling-tl/team': 'My Team',
  '/dashboard/counselling-agent': 'My Assigned Leads',
  '/dashboard/counselling-agent/due-today': 'Follow-ups Due Today',
  '/dashboard/counselling-agent/scheduled-calls': 'Scheduled Calls',
  '/dashboard/super-admin/announcements': 'Announcements',
  '/dashboard/announcements': 'Announcements',
  '/dashboard/profile': 'My Profile',
};

export function Header({ onMenuClick }: { onMenuClick?: () => void }) {
  const pathname = usePathname();
  const title = PAGE_TITLES[pathname] ?? 'Counselling CRM';
  const { resolvedTheme, setTheme } = useTheme();

  // Avoid hydration mismatch — only render the button after mount
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const isDark = resolvedTheme === 'dark';

  return (
    <header className="flex h-16 items-center justify-between border-b bg-background px-4 md:px-6">
      <div className="flex items-center gap-3">
        {/* Hamburger — mobile only */}
        <button
          onClick={onMenuClick}
          aria-label="Open navigation menu"
          className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors md:hidden"
        >
          <Menu className="h-5 w-5" />
        </button>
        <h1 className="text-lg md:text-xl font-semibold truncate">{title}</h1>
      </div>

      <div className="flex items-center gap-3">
        <PunchClockWidget />
        <NotificationBell />

        {mounted && (
        <button
          onClick={() => setTheme(isDark ? 'light' : 'dark')}
          aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          className="relative flex h-9 w-16 items-center rounded-full border border-border bg-muted p-1 transition-colors duration-300 hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {/* Track fill */}
          <span
            className={`absolute inset-0 rounded-full transition-colors duration-300 ${
              isDark ? 'bg-slate-700' : 'bg-sky-100'
            }`}
          />

          {/* Sliding thumb */}
          <span
            className={`relative z-10 flex h-7 w-7 items-center justify-center rounded-full shadow-sm transition-all duration-300 ${
              isDark
                ? 'translate-x-7 bg-slate-900'
                : 'translate-x-0 bg-white'
            }`}
          >
            {isDark ? (
              <Moon className="h-3.5 w-3.5 text-blue-400" />
            ) : (
              <Sun className="h-3.5 w-3.5 text-amber-500" />
            )}
          </span>
        </button>
        )}
      </div>
    </header>
  );
}
