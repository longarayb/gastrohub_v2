'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { FullPageSpinner } from '@/components/page';
import { useAuth } from '@/lib/auth';
import { homeFor } from '@/lib/routes';

/** Sends each role to its main screen. */
export default function HomePage() {
  const { status, session } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === 'unauthenticated') router.replace('/login');
    if (status === 'authenticated' && session) router.replace(homeFor(session.role) as never);
  }, [status, session, router]);

  return <FullPageSpinner />;
}
