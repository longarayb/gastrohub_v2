'use client';

import { Permission, hasPermission } from '@app/shared';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { FullPageSpinner } from '@/components/page';
import { useAuth } from '@/lib/auth';

/** Sends each role to its main screen. */
export default function HomePage() {
  const { status, session } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === 'unauthenticated') router.replace('/login');
    if (status === 'authenticated' && session) {
      const role = session.role;
      const target = hasPermission(role, Permission.REPORTS_READ)
        ? '/painel'
        : hasPermission(role, Permission.STORE_MANAGE)
          ? '/configuracoes/empresa'
          : '/conta/senha';
      router.replace(target as never);
    }
  }, [status, session, router]);

  return <FullPageSpinner />;
}
