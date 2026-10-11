'use client';

import { Notice } from '@app/ui/components/notice';
import { Headset } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Brand } from '@/components/brand';
import { FullPageSpinner } from '@/components/page';
import { SUPPORT_TOKEN_KEY } from '@/lib/api';

/**
 * Entry of a platform support session (D041): the admin app opens this page with the token in
 * the URL fragment (never sent to servers or logs). It is kept in this tab only and the panel
 * opens; when the session ends, the panel comes back here with `?encerrado=1`.
 */
export default function SupportEntryPage() {
  const [ended, setEnded] = useState(false);

  useEffect(() => {
    const token = new URLSearchParams(window.location.hash.slice(1)).get('token');
    if (token) {
      try {
        sessionStorage.setItem(SUPPORT_TOKEN_KEY, token);
      } catch {
        // Without sessionStorage the support tab cannot keep its session.
      }
      // Full navigation: the auth provider starts again with the support token.
      window.location.replace('/painel');
      return;
    }
    setEnded(true);
  }, []);

  if (!ended) return <FullPageSpinner />;
  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <div className="w-full max-w-md space-y-6">
        <Brand />
        <Notice tone="info" icon={Headset} title="Acesso de suporte encerrado">
          O tempo do atendimento terminou ou ele foi encerrado no painel da plataforma. Você pode
          fechar esta aba.
        </Notice>
      </div>
    </main>
  );
}
