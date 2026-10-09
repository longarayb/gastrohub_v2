'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider, useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { TooltipProvider } from '@app/ui/components/misc';
import { Toaster } from '@app/ui/components/sonner';
import { ApiError } from '@/lib/api';
import { AuthProvider } from '@/lib/auth';

/** Browser bar color (phones) follows the theme in use: the page background token. */
function ThemeColor() {
  const { resolvedTheme } = useTheme();
  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]');
    const color = getComputedStyle(document.documentElement).getPropertyValue('--background');
    if (meta && color) meta.setAttribute('content', color.trim());
  }, [resolvedTheme]);
  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            // Do not retry client errors (4xx); retry network/server errors once.
            retry: (count, error) =>
              !(error instanceof ApiError && error.status >= 400 && error.status < 500) &&
              count < 1,
          },
        },
      }),
  );

  return (
    // Dark by default (docs/DESIGN.md); "Sistema" follows the OS live. Saved per device.
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
      <ThemeColor />
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <TooltipProvider>
            {children}
            <Toaster />
          </TooltipProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
