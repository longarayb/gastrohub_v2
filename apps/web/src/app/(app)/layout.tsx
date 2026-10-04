'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { FullPageSpinner } from '@/components/page';
import { AppShell } from '@/components/shell/app-shell';
import { useAuth } from '@/lib/auth';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { status } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace(`/login?next=${encodeURIComponent(pathname)}` as never);
    }
  }, [status, router, pathname]);

  if (status !== 'authenticated') return <FullPageSpinner />;
  return <AppShell>{children}</AppShell>;
}
