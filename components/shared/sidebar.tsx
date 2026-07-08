'use client';

import { useEffect, useState } from 'react';
import { useSession, signOut } from 'next-auth/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useUnreadAnnouncements } from '@/lib/hooks/use-unread-announcements';
import {
  LayoutDashboard, List, Upload, Shield, Settings2, MessageSquare,
  Users, Users2, UserCog, BarChart3, Activity, ClipboardCheck,
  UserCircle, UserCheck, ClipboardList, LogOut, ChevronRight, ChevronDown,
  GitBranch, CalendarClock, X, ChevronsLeft, ChevronsRight,
  GraduationCap, Tag, Globe2, MapPin, CheckSquare, ShieldCheck, Phone,
  Megaphone, Gauge,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';
import type { Role } from '@prisma/client';

// ─── Types ───────────────────────────────────────────────────────────────────

interface NavChild {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  roles: Role[];
  exact?: boolean;
}

interface NavLeaf {
  type: 'leaf';
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  roles: Role[];
  exact?: boolean;
}

interface NavGroup {
  type: 'group';
  key: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  roles: Role[];
  children: NavChild[];
}

type NavEntry = NavLeaf | NavGroup;

// ─── Navigation Definition ───────────────────────────────────────────────────

const NAV: NavEntry[] = [
  {
    type: 'leaf',
    href: '/dashboard',
    label: 'Dashboard',
    icon: LayoutDashboard,
    roles: ['SUPER_ADMIN', 'REPORTS', 'OPERATIONS', 'COUNSELLING_TL', 'COUNSELLING_AGENT'],
    exact: true,
  },
  {
    type: 'leaf',
    href: '/dashboard/leads',
    label: 'All Leads',
    icon: List,
    roles: ['SUPER_ADMIN', 'REPORTS', 'COUNSELLING_TL', 'COUNSELLING_AGENT'],
  },
  {
    type: 'group',
    key: 'manage-leads',
    label: 'Manage Leads',
    icon: ClipboardList,
    roles: ['SUPER_ADMIN', 'OPERATIONS', 'COUNSELLING_TL', 'COUNSELLING_AGENT'],
    children: [
      {
        href: '/dashboard/operations',
        label: 'Upload Leads',
        icon: Upload,
        roles: ['SUPER_ADMIN', 'OPERATIONS'],
        exact: true,
      },
      {
        href: '/dashboard/counselling-tl',
        label: 'Assign Leads',
        icon: UserCheck,
        roles: ['SUPER_ADMIN', 'COUNSELLING_TL'],
        exact: true,
      },
      {
        href: '/dashboard/counselling-agent/scheduled-calls',
        label: 'Scheduled Calls',
        icon: CalendarClock,
        roles: ['SUPER_ADMIN', 'COUNSELLING_TL', 'COUNSELLING_AGENT'],
      },
      {
        href: '/dashboard/super-admin/upload-limits',
        label: 'Upload Limits',
        icon: Gauge,
        roles: ['SUPER_ADMIN'],
      },
    ],
  },
  {
    type: 'group',
    key: 'manage-dropdowns',
    label: 'Manage Dropdowns',
    icon: Settings2,
    roles: ['SUPER_ADMIN'],
    children: [
      {
        href: '/dashboard/super-admin/feedback-options',
        label: 'Manage Feedbacks',
        icon: MessageSquare,
        roles: ['SUPER_ADMIN'],
      },
      {
        href: '/dashboard/super-admin/manage-colleges',
        label: 'Manage Colleges',
        icon: GraduationCap,
        roles: ['SUPER_ADMIN'],
      },
      {
        href: '/dashboard/super-admin/manage-lead-type',
        label: 'Manage Lead Type',
        icon: Tag,
        roles: ['SUPER_ADMIN'],
      },
      {
        href: '/dashboard/super-admin/manage-lead-origin',
        label: 'Manage Lead Origin',
        icon: Globe2,
        roles: ['SUPER_ADMIN'],
      },
      {
        href: '/dashboard/super-admin/manage-zones',
        label: 'Manage Zones',
        icon: MapPin,
        roles: ['SUPER_ADMIN'],
      },
      {
        href: '/dashboard/super-admin/manage-lead-confirmation',
        label: 'Lead Confirmation',
        icon: CheckSquare,
        roles: ['SUPER_ADMIN'],
      },
      {
        href: '/dashboard/super-admin/manage-lead-verification',
        label: 'Lead Verification',
        icon: ShieldCheck,
        roles: ['SUPER_ADMIN'],
      },
      {
        href: '/dashboard/super-admin/manage-data-calling-type',
        label: 'Data Calling Type',
        icon: Phone,
        roles: ['SUPER_ADMIN'],
      },
    ],
  },
  {
    type: 'group',
    key: 'user-management',
    label: 'User Management',
    icon: Users,
    roles: ['SUPER_ADMIN', 'REPORTS', 'COUNSELLING_TL', 'COUNSELLING_AGENT'],
    children: [
      {
        href: '/dashboard/super-admin/permissions',
        label: 'Manage Permissions',
        icon: Shield,
        roles: ['SUPER_ADMIN'],
      },
      {
        href: '/dashboard/super-admin/teams',
        label: 'Manage Teams',
        icon: Users2,
        roles: ['SUPER_ADMIN'],
      },
      {
        href: '/dashboard/super-admin/org-tree',
        label: 'Org Hierarchy',
        icon: GitBranch,
        roles: ['SUPER_ADMIN'],
      },
      {
        href: '/dashboard/reports/hierarchy',
        label: 'Org Hierarchy',
        icon: GitBranch,
        roles: ['REPORTS'],
      },
      {
        href: '/dashboard/counselling-tl/team',
        label: 'View Team',
        icon: Users2,
        roles: ['COUNSELLING_TL'],
      },
      {
        href: '/dashboard/counselling-agent/team',
        label: 'View Team',
        icon: GitBranch,
        roles: ['COUNSELLING_AGENT'],
      },
      {
        href: '/dashboard/super-admin',
        label: 'Manage Users',
        icon: UserCog,
        roles: ['SUPER_ADMIN'],
        exact: true,
      },
    ],
  },
  {
    type: 'leaf',
    href: '/dashboard/super-admin/performance',
    label: 'Reports & Performance',
    icon: BarChart3,
    roles: ['SUPER_ADMIN'],
  },
  {
    type: 'leaf',
    href: '/dashboard/reports/analytics',
    label: 'Analytics',
    icon: BarChart3,
    roles: ['SUPER_ADMIN', 'COUNSELLING_TL', 'REPORTS'],
  },
  {
    type: 'leaf',
    href: '/dashboard/attendance',
    label: 'Agent Time BreakUp',
    icon: CalendarClock,
    roles: ['SUPER_ADMIN', 'COUNSELLING_TL'],
  },
  {
    type: 'leaf',
    href: '/dashboard/reports',
    label: 'Reports & Performance',
    icon: BarChart3,
    roles: ['REPORTS'],
    exact: true,
  },
  {
    type: 'leaf',
    href: '/dashboard/super-admin/activity-logs',
    label: 'Activity Logs',
    icon: Activity,
    roles: ['SUPER_ADMIN'],
  },
  {
    type: 'leaf',
    href: '/dashboard/reports',
    label: 'Lead Approvals',
    icon: ClipboardCheck,
    roles: ['SUPER_ADMIN', 'OPERATIONS'],
    exact: true,
  },
  {
    type: 'leaf',
    href: '/dashboard/super-admin/announcements',
    label: 'Announcements',
    icon: Megaphone,
    roles: ['SUPER_ADMIN'],
  },
  {
    type: 'leaf',
    href: '/dashboard/announcements',
    label: 'Announcements',
    icon: Megaphone,
    roles: ['COUNSELLING_TL', 'COUNSELLING_AGENT'],
  },
  {
    type: 'leaf',
    href: '/dashboard/profile',
    label: 'My Profile',
    icon: UserCircle,
    roles: ['SUPER_ADMIN', 'REPORTS', 'OPERATIONS', 'COUNSELLING_TL', 'COUNSELLING_AGENT'],
  },
];

// ─── Sidebar ─────────────────────────────────────────────────────────────────

interface SidebarProps {
  onClose?: () => void;
  collapsed?: boolean;
  onCollapse?: () => void;
}

export function Sidebar({ onClose, collapsed = false, onCollapse }: SidebarProps) {
  const { data: session } = useSession();
  const pathname = usePathname();
  const userRole = session?.user?.role as Role | undefined;

  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [hovered,   setHovered]   = useState(false);

  // Only show unread badge for TL / Agent roles — SA manages announcements, not reads them
  const showUnread = userRole === 'COUNSELLING_TL' || userRole === 'COUNSELLING_AGENT';
  const { unreadCount } = useUnreadAnnouncements();
  const UNREAD_HREF = '/dashboard/announcements';

  // True when sidebar should visually show expanded state
  const isExpanded = !collapsed || hovered;

  // Auto-expand the group containing the active route (and only that one)
  useEffect(() => {
    const active = NAV.find(
      (entry): entry is NavGroup =>
        entry.type === 'group' &&
        entry.children.some((c) => (c.exact ? pathname === c.href : pathname.startsWith(c.href))),
    );
    setOpenGroup(active ? active.key : null);
  }, [pathname]);

  // Collapse open group when sidebar shrinks
  useEffect(() => {
    if (!isExpanded) setOpenGroup(null);
  }, [isExpanded]);

  const toggleGroup = (key: string) => {
    if (!isExpanded) return;
    setOpenGroup((prev) => (prev === key ? null : key));
  };

  const checkActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname.startsWith(href);

  const initials =
    session?.user?.name
      ?.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2) ?? '?';

  return (
    <aside
      onMouseEnter={() => { if (collapsed) setHovered(true); }}
      onMouseLeave={() => setHovered(false)}
      className={cn(
        'flex h-screen flex-col bg-card border-r overflow-hidden',
        'transition-all duration-300 ease-in-out',
        isExpanded ? 'w-64' : 'w-[64px]',
        // Drop shadow when hover-expanded so it reads as an overlay
        collapsed && hovered && 'shadow-2xl',
      )}
    >
      {/* ── Header ── */}
      <div className="flex h-16 shrink-0 items-center border-b">
        {isExpanded ? (
          /* Expanded header: logo + brand text + collapse button */
          <div className="flex w-full items-center gap-2.5 px-4">
            <svg width="28" height="24" viewBox="0 0 30 26" fill="none" xmlns="http://www.w3.org/2000/svg" className="shrink-0">
              <path d="M18 0L7 13L18 26H24L13 13L24 0H18Z" fill="#E85A42" />
              <path d="M9 0L0 13L9 26H15L6 13L15 0H9Z" fill="#E85A42" opacity="0.55" />
            </svg>
            <div className="min-w-0 flex-1">
              <p className="font-bold text-[15px] leading-tight tracking-tight text-foreground whitespace-nowrap">
                KollegeApply
              </p>
              <p className="text-[10px] text-muted-foreground leading-none mt-0.5 tracking-wide whitespace-nowrap">
                Empowering Education
              </p>
            </div>
            {/* Desktop collapse button */}
            {onCollapse && (
              <button
                onClick={onCollapse}
                title={collapsed ? 'Pin sidebar open' : 'Collapse sidebar'}
                aria-label={collapsed ? 'Pin sidebar open' : 'Collapse sidebar'}
                className="hidden md:flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              >
                {collapsed
                  ? <ChevronsRight className="h-4 w-4" />
                  : <ChevronsLeft  className="h-4 w-4" />}
              </button>
            )}
            {/* Mobile close button */}
            {onClose && (
              <button
                onClick={onClose}
                aria-label="Close menu"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors md:hidden"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        ) : (
          /* Collapsed header: logo centered + pin button */
          <div className="flex w-full flex-col items-center justify-center gap-1 py-2">
            <svg width="24" height="21" viewBox="0 0 30 26" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M18 0L7 13L18 26H24L13 13L24 0H18Z" fill="#E85A42" />
              <path d="M9 0L0 13L9 26H15L6 13L15 0H9Z" fill="#E85A42" opacity="0.55" />
            </svg>
            {onCollapse && (
              <button
                onClick={onCollapse}
                title="Pin sidebar open"
                aria-label="Pin sidebar open"
                className="hidden md:flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-foreground transition-colors"
              >
                <ChevronsRight className="h-3 w-3" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Navigation ── */}
      <nav className="flex-1 overflow-y-auto overflow-x-hidden py-3 px-2">
        <ul className="space-y-0.5">
          {NAV.map((entry, idx) => {
            if (!userRole) return null;

            // ── Leaf ──
            if (entry.type === 'leaf') {
              if (!entry.roles.includes(userRole)) return null;
              const active = checkActive(entry.href, entry.exact);
              const hasUnread = showUnread && entry.href === UNREAD_HREF && unreadCount > 0 && !active;
              return (
                <li key={`${entry.href}-${entry.label}-${idx}`}>
                  {isExpanded ? (
                    <Link
                      href={entry.href}
                      onClick={onClose}
                      className={cn(
                        'group/nav flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-200 ease-premium hover:translate-x-0.5',
                        active
                          ? 'bg-primary text-primary-foreground shadow-sm shadow-primary/25'
                          : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                      )}
                    >
                      <entry.icon className={cn('h-4 w-4 shrink-0 transition-transform duration-200 ease-premium', !active && 'group-hover/nav:scale-110')} />
                      <span className="flex-1">{entry.label}</span>
                      {hasUnread && (
                        <span className="relative flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white animate-pulse">
                          {unreadCount > 9 ? '9+' : unreadCount}
                        </span>
                      )}
                      {active && !hasUnread && <ChevronRight className="h-3 w-3 shrink-0" />}
                    </Link>
                  ) : (
                    <Link
                      href={entry.href}
                      onClick={onClose}
                      title={entry.label}
                      className={cn(
                        'group/nav relative flex h-10 w-10 mx-auto items-center justify-center rounded-lg transition-all duration-200 ease-premium hover:scale-105',
                        active
                          ? 'bg-primary text-primary-foreground shadow-sm shadow-primary/25'
                          : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                      )}
                    >
                      <entry.icon className={cn('h-5 w-5 transition-transform duration-200 ease-premium', !active && 'group-hover/nav:scale-110')} />
                      {hasUnread && (
                        <span className="absolute top-1.5 right-1.5 flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75" />
                          <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
                        </span>
                      )}
                    </Link>
                  )}
                </li>
              );
            }

            // ── Group ──
            if (entry.type === 'group') {
              const visibleChildren = entry.children.filter((c) =>
                c.roles.includes(userRole)
              );
              if (visibleChildren.length === 0) return null;

              const isOpen = isExpanded && openGroup === entry.key;
              const hasActiveChild = visibleChildren.some((c) =>
                checkActive(c.href, c.exact)
              );

              return (
                <li key={entry.key}>
                  {isExpanded ? (
                    <button
                      onClick={() => toggleGroup(entry.key)}
                      className={cn(
                        'w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                        hasActiveChild
                          ? 'text-primary bg-primary/10'
                          : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                      )}
                    >
                      <entry.icon className="h-4 w-4 shrink-0" />
                      <span className="flex-1 text-left">{entry.label}</span>
                      <ChevronDown
                        className={cn(
                          'h-3.5 w-3.5 shrink-0 transition-transform duration-200',
                          isOpen ? 'rotate-0' : '-rotate-90',
                        )}
                      />
                    </button>
                  ) : (
                    <div
                      title={entry.label}
                      className={cn(
                        'flex h-10 w-10 mx-auto items-center justify-center rounded-lg',
                        hasActiveChild
                          ? 'text-primary bg-primary/10'
                          : 'text-muted-foreground',
                      )}
                    >
                      <entry.icon className="h-5 w-5" />
                    </div>
                  )}

                  {/* Children */}
                  <div
                    className={cn(
                      'overflow-hidden transition-all duration-300',
                      isOpen ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0',
                    )}
                  >
                    <ul className="mt-0.5 ml-3 pl-3 border-l border-border/50 space-y-0.5 pb-1">
                      {visibleChildren.map((child) => {
                        const childActive = checkActive(child.href, child.exact);
                        return (
                          <li key={`${child.href}-${child.label}`}>
                            <Link
                              href={child.href}
                              onClick={onClose}
                              className={cn(
                                'flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors',
                                childActive
                                  ? 'bg-primary text-primary-foreground font-medium'
                                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                              )}
                            >
                              <child.icon className="h-3.5 w-3.5 shrink-0" />
                              <span>{child.label}</span>
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                </li>
              );
            }

            return null;
          })}
        </ul>
      </nav>

      <Separator />

      {/* ── Footer ── */}
      {isExpanded ? (
        <div className="p-4 space-y-3">
          <div className="flex items-center gap-3">
            <Avatar className="h-8 w-8 shrink-0">
              <AvatarFallback className="text-xs bg-primary text-primary-foreground">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{session?.user?.name}</p>
              <p className="text-xs text-muted-foreground truncate">
                {userRole?.replace(/_/g, ' ')}
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2 text-muted-foreground"
            onClick={() => signOut({ callbackUrl: '/login' })}
          >
            <LogOut className="h-4 w-4" /> Sign out
          </Button>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2 py-4">
          <Avatar
            className="h-8 w-8 cursor-default"
            title={session?.user?.name ?? ''}
          >
            <AvatarFallback className="text-xs bg-primary text-primary-foreground">
              {initials}
            </AvatarFallback>
          </Avatar>
          <button
            title="Sign out"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
            onClick={() => signOut({ callbackUrl: '/login' })}
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      )}
    </aside>
  );
}
