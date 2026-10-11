'use client';

import { formatBRL } from '@app/shared';
import { Button } from '@app/ui/components/button';
import { Segmented } from '@app/ui/components/segmented';
import { toast } from '@app/ui/components/sonner';
import { EmptyState, ListSkeleton } from '@app/ui/components/states';
import { ReceiptText } from 'lucide-react';
import { useState } from 'react';
import { InvoiceTable } from '@/components/invoices';
import { Page } from '@/components/page';
import { apiPost, errorMessage } from '@/lib/api';
import { useInvoices, useRefresh } from '@/lib/queries';

const FILTERS = [
  { value: 'OVERDUE', label: 'Atrasadas' },
  { value: 'DUE_SOON', label: 'A vencer' },
  { value: 'OPEN', label: 'Em aberto' },
  { value: 'PAID', label: 'Pagas' },
  { value: 'CANCELED', label: 'Canceladas' },
] as const;
type Filter = (typeof FILTERS)[number]['value'];

/**
 * Monthly fees, manual control (D042): generate the period's invoices, record payments
 * (unblocks the customer right away) and cancel with a reason.
 */
export default function InvoicesPage() {
  const [filter, setFilter] = useState<Filter>('OVERDUE');
  const { data, isLoading } = useInvoices(filter);
  const refresh = useRefresh();
  const [busy, setBusy] = useState(false);
  const total = (data ?? []).reduce((sum, i) => sum + i.amountCents, 0);

  async function generate() {
    setBusy(true);
    try {
      const res = await apiPost<{ created: number }>('/invoices/generate', {});
      toast.success(
        res.created
          ? `${res.created} mensalidade(s) gerada(s)`
          : 'Nenhuma mensalidade nova a gerar',
      );
      await refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page
      title="Mensalidades"
      description="Controle manual: gere as mensalidades do período e registre os pagamentos."
      actions={
        <Button onClick={() => void generate()} loading={busy}>
          Gerar mensalidades do período
        </Button>
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented label="Situação" value={filter} onChange={setFilter} options={FILTERS} />
        {data && data.length > 0 && (
          <p className="text-sm text-muted-foreground">
            {data.length} mensalidade(s) ·{' '}
            <span className="font-bold text-foreground tabular-nums">{formatBRL(total)}</span>
          </p>
        )}
      </div>
      {isLoading ? (
        <ListSkeleton rows={5} />
      ) : !data?.length ? (
        <EmptyState icon={ReceiptText} title="Nenhuma mensalidade nesta situação" />
      ) : (
        <InvoiceTable invoices={data} />
      )}
    </Page>
  );
}
