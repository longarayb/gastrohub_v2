'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { FullPageSpinner } from '@/components/page';
import { AdminShell } from '@/components/shell';
import { useAuth } from '@/lib/auth';

/** Every admin screen requires a platform session with the second factor done. */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { status } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (status === 'unauthenticated') router.replace('/login' as never);
  }, [status, router, pathname]);

  if (status !== 'authenticated') return <FullPageSpinner />;
  return <AdminShell>{children}</AdminShell>;
}
