import { withAuth } from 'next-auth/middleware';
import { NextResponse } from 'next/server';
import type { Role } from '@prisma/client';

// Role-based route access map — more specific routes take precedence over broader ones
const ROLE_ROUTES: Record<string, Role[]> = {
  '/dashboard/super-admin': ['SUPER_ADMIN'],
  '/dashboard/operations': ['SUPER_ADMIN', 'OPERATIONS'],
  '/dashboard/reports': ['SUPER_ADMIN', 'REPORTS'],
  // More specific than '/dashboard/reports' above — TLs (and REPORTS/SA) can
  // view Analytics even though the broader /dashboard/reports/* tree
  // (Lead Approvals, Org Hierarchy) stays REPORTS/SUPER_ADMIN only.
  '/dashboard/reports/analytics': ['SUPER_ADMIN', 'COUNSELLING_TL', 'REPORTS'],
  // REPORTS included so the Manage Permissions "Assign Leads" toggle can
  // actually grant this page — REPORTS gets the same global TL/agent picker
  // SUPER_ADMIN sees (enforced client + API side by the ASSIGN_LEADS feature
  // flag). The more specific /team rule below still keeps the TL's own-team
  // view TL/SA-only.
  '/dashboard/counselling-tl': ['SUPER_ADMIN', 'REPORTS', 'COUNSELLING_TL'],
  '/dashboard/counselling-tl/team': ['SUPER_ADMIN', 'COUNSELLING_TL'],
  '/dashboard/counselling-agent': ['SUPER_ADMIN', 'COUNSELLING_AGENT'],
  '/dashboard/counselling-agent/due-today': ['SUPER_ADMIN', 'COUNSELLING_AGENT'],
  '/dashboard/counselling-agent/scheduled-calls': ['SUPER_ADMIN', 'REPORTS', 'COUNSELLING_TL', 'COUNSELLING_AGENT'],
  // More specific than the blanket '/dashboard/super-admin' rule above —
  // REPORTS can reach this one page if granted APPROVE_RECEIPTS via the
  // permission matrix (enforced client + API side by that feature flag).
  '/dashboard/super-admin/receipt-approvals': ['SUPER_ADMIN', 'REPORTS'],
  // Same exception, same reasoning: the Reports & Performance page lives under
  // /dashboard/super-admin/* but only reads /api/analytics/*, which gate on
  // VIEW_REPORTS — a REPORTS default. Without this more-specific rule the
  // blanket '/dashboard/super-admin' entry above redirects them to /dashboard.
  // COUNSELLING_TL included as well: /api/analytics/summary and
  // /api/analytics/breakdown pin a TL to their own team (ignoring any teamId
  // in the request), so this page shows them their team's stats only.
  '/dashboard/super-admin/performance': ['SUPER_ADMIN', 'REPORTS', 'COUNSELLING_TL'],
};

export default withAuth(
  function middleware(req) {
    const token = req.nextauth.token;
    const pathname = req.nextUrl.pathname;

    if (!token) {
      return NextResponse.redirect(new URL('/login', req.url));
    }

    // Find the most specific (longest) matching route to avoid broad rules
    // blocking access that a more specific rule would allow.
    let bestRoute = '';
    let bestRoles: Role[] = [];
    for (const [route, allowedRoles] of Object.entries(ROLE_ROUTES)) {
      if (pathname.startsWith(route) && route.length > bestRoute.length) {
        bestRoute = route;
        bestRoles = allowedRoles;
      }
    }

    if (bestRoute && !bestRoles.includes(token.role as Role)) {
      return NextResponse.redirect(new URL('/dashboard', req.url));
    }

    return NextResponse.next();
  },
  {
    callbacks: {
      // A token flagged `invalidated` belongs to a user deactivated
      // mid-session — treat it as logged out.
      authorized: ({ token }) => !!token && !token.invalidated,
    },
  }
);

export const config = {
  matcher: ['/dashboard/:path*', '/leads/:path*'],
};
