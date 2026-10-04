'use client';

import { Card, CardDescription, CardHeader, CardTitle } from '@gastrohub/ui/components/card';
import { Page } from '@/components/page';
import { useSession } from '@/lib/auth';

export default function DashboardPage() {
  const session = useSession();
  return (
    <Page title={`Olá, ${session.user.name.split(' ')[0]}!`} description={session.store.tradeName}>
      <Card>
        <CardHeader>
          <CardTitle>Painel do dia</CardTitle>
          <CardDescription>Os indicadores de vendas aparecerão aqui.</CardDescription>
        </CardHeader>
      </Card>
    </Page>
  );
}
