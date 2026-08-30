'use client';

import { SessionProvider } from 'next-auth/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import { useState } from 'react';
import { Toaster } from '@/components/ui/toaster';
import { CheckInRequiredDialog } from '@/components/attendance/check-in-required-dialog';

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 0,
            refetchOnWindowFocus: true,
            refetchOnMount: true,
          },
        },
      })
  );

  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} storageKey="crm-theme">
      <SessionProvider>
        <QueryClientProvider client={queryClient}>
          {children}
          <Toaster />
          {/* Mounted once for the whole app, beside the Toaster, because the
              routes that can place a call or log a follow-up do not share a
              layout: /dashboard/** has the shell and header, but the standalone
              lead profile page at /leads/[id]/profile does not — and it has a
              Call button. Renders nothing until a request is refused for want
              of attendance. */}
          <CheckInRequiredDialog />
        </QueryClientProvider>
      </SessionProvider>
    </ThemeProvider>
  );
}
