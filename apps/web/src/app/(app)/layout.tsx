'use client';

import { Button } from '@app/ui/components/button';
import { ShieldX } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { EmptyState, FullPageSpinner } from '@/components/page';
import { AppShell } from '@/components/shell/app-shell';
import { useAuth } from '@/lib/auth';
import { RealtimeProvider } from '@/lib/realtime';
import { canAccess, homeFor } from '@/lib/routes';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { status, session } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace(`/login?next=${encodeURIComponent(pathname)}` as never);
    }
  }, [status, router, pathname]);

  if (status !== 'authenticated' || !session) return <FullPageSpinner />;

  return (
    <RealtimeProvider>
      <AppShell>
        {canAccess(session.role, pathname) ? (
          children
        ) : (
          <div className="p-6">
            <EmptyState
              icon={ShieldX}
              title="Acesso não permitido"
              description="Seu perfil não tem permissão para esta tela. Fale com o responsável pela unidade."
              action={
                <Button asChild variant="outline">
                  <Link href={homeFor(session.role) as never}>Ir para o início</Link>
                </Button>
              }
            />
          </div>
        )}
      </AppShell>
    </RealtimeProvider>
  );
}
