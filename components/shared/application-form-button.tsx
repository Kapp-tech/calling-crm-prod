'use client';

import { useQuery } from '@tanstack/react-query';
import { FileText, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Opens the college's application landing page, tagged to the agent looking at
 * the lead.
 *
 * The URL is not built here. It comes from /api/landing-pages already resolved
 * for the session user, so the agent ID in the link is decided server-side from
 * the session and can never be spoofed or picked up from the wrong account.
 *
 * The whole list is fetched once and cached, rather than asking per lead: there
 * are a few dozen colleges at most, and an agent opens hundreds of leads in a
 * shift. Sharing the query key with the Landing Pages page means opening one
 * warms the other.
 *
 * Always rendered, never hidden. A college with no link yet still shows the
 * button, disabled and saying why — an absent button looks like a bug the agent
 * should report, whereas a disabled one with a reason is an answer.
 */

interface LandingPageItem {
  id: string;
  college: string;
  url: string;
  /** True when the link needs an agent ID we could not resolve for this user. */
  blocked: boolean;
}

export function ApplicationFormButton({
  college,
  className,
}: {
  college?: string | null;
  className?: string;
}) {
  const { data, isLoading } = useQuery<{ items: LandingPageItem[] }>({
    queryKey: ['landing-pages'],
    queryFn: () => fetch('/api/landing-pages').then((r) => r.json()),
    staleTime: 30 * 60 * 1000,
  });

  const name = college?.trim().toLowerCase();
  // Matched on the college name because that is all a lead carries. The
  // importer resolves the KAPP College ID to the dropdown's own value before
  // storing it, so the two are the same string rather than two spellings.
  const match = name
    ? data?.items.find((i) => i.college.trim().toLowerCase() === name)
    : undefined;

  const reason = isLoading
    ? 'Checking for an application link…'
    : !college
      ? 'This lead has no college set'
      : !match
        ? `No application link is set up for ${college}`
        : match.blocked
          ? 'Your account has no Employee ID, so this link cannot be tagged to you — ask your manager'
          : null;

  const shape =
    'inline-flex items-center gap-1.5 rounded-md px-3 h-9 text-xs font-medium shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

  if (reason) {
    return (
      <button
        type="button"
        disabled
        title={reason}
        className={cn(shape, 'cursor-not-allowed bg-muted text-muted-foreground shadow-none', className)}
      >
        {isLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
        Application Form
      </button>
    );
  }

  return (
    <a
      href={match!.url}
      target="_blank"
      rel="noopener noreferrer"
      title={`Open the ${match!.college} application form — tagged to you`}
      className={cn(shape, 'bg-violet-600 text-white hover:bg-violet-700', className)}
    >
      <FileText className="h-3.5 w-3.5" />
      Application Form
    </a>
  );
}
