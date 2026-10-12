'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { ForcedPasswordChange } from '@/components/forced-password-change';
import { FullPageSpinner } from '@/components/page';
import { AdminShell } from '@/components/shell';
import { useAuth } from '@/lib/auth';

/** Every admin screen requires a platform session with the second factor done. */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { status, admin } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (status === 'unauthenticated') router.replace('/login' as never);
  }, [status, router, pathname]);

  if (status !== 'authenticated') return <FullPageSpinner />;
  // Temporary password: changed right after the 2FA, before any other screen.
  if (admin?.passwordChangeRequired) return <ForcedPasswordChange />;
  return <AdminShell>{children}</AdminShell>;
}
