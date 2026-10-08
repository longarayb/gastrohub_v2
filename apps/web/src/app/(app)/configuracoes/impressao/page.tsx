'use client';

import { Skeleton } from '@app/ui/components/misc';
import { AgentsCard } from '@/components/printing/agents-card';
import { PrintersCard } from '@/components/printing/printers-card';
import { PrintQueueCard } from '@/components/printing/queue-card';
import { PrintSettingsCard, SectorRoutingCard } from '@/components/printing/routing-card';
import { Page } from '@/components/page';
import { usePrintStatus } from '@/lib/printing';

/** Automatic printing (D035–D037): computers, printers, sectors, settings and the queue. */
export default function PrintingPage() {
  const { data: status, isLoading } = usePrintStatus();
  return (
    <Page
      title="Impressão"
      description="Comandas na cozinha e no bar, via de entrega e pré-conta impressas sozinhas, sem abrir o navegador"
      className="max-w-4xl"
    >
      {isLoading || !status ? (
        <Skeleton className="h-64" />
      ) : (
        <>
          <AgentsCard agents={status.agents} />
          <PrintersCard printers={status.printers} agents={status.agents} />
          <SectorRoutingCard
            key={JSON.stringify(status.sectors)}
            sectors={status.sectors}
            printers={status.printers}
          />
          <PrintSettingsCard
            key={JSON.stringify(status.settings)}
            settings={status.settings}
            printers={status.printers}
          />
          <PrintQueueCard />
        </>
      )}
    </Page>
  );
}
