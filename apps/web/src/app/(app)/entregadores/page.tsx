'use client';

import { COURIER_STATUS_LABELS, type CourierDetailDto, Permission, formatPhone } from '@app/shared';
import { Badge } from '@app/ui/components/badge';
import { Button } from '@app/ui/components/button';
import { Skeleton } from '@app/ui/components/misc';
import { toast } from '@app/ui/components/sonner';
import { cn } from '@app/ui/lib/utils';
import { useQueryClient } from '@tanstack/react-query';
import { BarChart3, Bike, HandCoins, Pencil, Plus, ReceiptText, Store } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import {
  BalanceText,
  CourierFormDialog,
  LedgerSheet,
  PaySettingsCard,
} from '@/components/delivery/courier-dialogs';
import { SettlementDialog } from '@/components/delivery/settlement-dialog';
import { elapsedLabel, useNow } from '@/components/orders/common';
import { EmptyState, Page } from '@/components/page';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { deliveryKeys, returnRun, useCourierDetails } from '@/lib/delivery';

const STATUS_BADGE = {
  // Solid badges: the text keeps 4.5:1 in both themes (contrast test of @app/ui).
  AVAILABLE: 'bg-success text-success-foreground',
  ON_ROUTE: 'bg-info text-info-foreground',
  INACTIVE: 'bg-muted text-muted-foreground',
} as const;

function CourierCard({
  courier,
  now,
  onEdit,
  onLedger,
  onSettle,
  onReturn,
  returning,
}: {
  courier: CourierDetailDto;
  now: Date;
  onEdit?: () => void;
  onLedger: () => void;
  onSettle?: () => void;
  onReturn?: () => void;
  returning: boolean;
}) {
  const run = courier.openRun;
  const toSettle = courier.pendingSettlementRuns - (run ? 1 : 0);
  return (
    <article
      aria-label={`Entregador ${courier.name}`}
      className="flex flex-col gap-3 rounded-card border bg-card p-4"
    >
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 font-semibold">
            <Bike className="size-4 text-muted-foreground" aria-hidden />
            {courier.name}
          </p>
          <p className="text-xs text-muted-foreground">
            {courier.phone ? formatPhone(courier.phone) : 'Sem telefone'}
            {courier.userName ? ` · app: ${courier.userName}` : ''}
          </p>
        </div>
        <span
          className={cn(
            'rounded-md px-2 py-0.5 text-xs font-semibold',
            STATUS_BADGE[courier.status],
          )}
        >
          {COURIER_STATUS_LABELS[courier.status]}
        </span>
      </header>
      {run && (
        <p className="text-sm">
          Em rota há {elapsedLabel(run.departedAt, now)} · {run.delivered}/{run.stops} entregue(s)
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <BalanceText cents={courier.balanceCents} />
        {toSettle > 0 && <Badge variant="secondary">{toSettle} saída(s) para acertar</Badge>}
      </div>
      <div className="mt-auto flex flex-wrap gap-2">
        {onSettle && courier.pendingSettlementRuns > 0 && (
          <Button size="sm" onClick={onSettle}>
            <HandCoins /> Acertar
          </Button>
        )}
        {onReturn && run && (
          <Button size="sm" variant="outline" loading={returning} onClick={onReturn}>
            <Store /> Registrar volta
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={onLedger}>
          <ReceiptText /> Extrato
        </Button>
        {onEdit && (
          <Button size="sm" variant="ghost" onClick={onEdit} aria-label={`Editar ${courier.name}`}>
            <Pencil />
          </Button>
        )}
      </div>
    </article>
  );
}

/** Couriers: status, routes, balance, settlement, payouts and pay rule (D030–D031). */
export default function CouriersPage() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const now = useNow();
  const { data, isLoading } = useCourierDetails();
  const [editing, setEditing] = useState<CourierDetailDto | 'new' | null>(null);
  const [ledgerId, setLedgerId] = useState<string | null>(null);
  const [settleId, setSettleId] = useState<string | null>(null);
  const [returning, setReturning] = useState<string | null>(null);
  const canManage = can(Permission.DELIVERY_MANAGE);
  const canCash = can(Permission.CASH_OPERATE);
  const couriers = data ?? [];
  const find = (id: string | null) => couriers.find((c) => c.id === id) ?? null;

  async function registerReturn(courier: CourierDetailDto) {
    setReturning(courier.id);
    try {
      await returnRun(courier.openRun!.id);
      toast.success(`Volta de ${courier.name} registrada`);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setReturning(null);
      void queryClient.invalidateQueries({ queryKey: deliveryKeys.all });
    }
  }

  return (
    <Page
      title="Entregadores"
      description="Quem está em rota, o saldo de cada um e o acerto no caixa."
      actions={
        <>
          {can(Permission.REPORTS_READ) && (
            <Button asChild variant="outline">
              <Link href={'/entregadores/relatorio' as never}>
                <BarChart3 /> Relatório de entregas
              </Link>
            </Button>
          )}
          {canManage && (
            <Button onClick={() => setEditing('new')}>
              <Plus /> Novo entregador
            </Button>
          )}
        </>
      }
    >
      {isLoading ? (
        <Skeleton className="h-40" />
      ) : couriers.length === 0 ? (
        <EmptyState
          icon={Bike}
          title="Nenhum entregador cadastrado"
          description="Cadastre os entregadores para registrar as saídas e fazer o acerto."
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {couriers.map((c) => (
            <CourierCard
              key={c.id}
              courier={c}
              now={now}
              returning={returning === c.id}
              onEdit={canManage ? () => setEditing(c) : undefined}
              onLedger={() => setLedgerId(c.id)}
              onSettle={canCash ? () => setSettleId(c.id) : undefined}
              onReturn={() => void registerReturn(c)}
            />
          ))}
        </div>
      )}

      <PaySettingsCard />

      <CourierFormDialog
        open={!!editing}
        courier={editing === 'new' ? null : editing}
        onOpenChange={(v) => !v && setEditing(null)}
      />
      <LedgerSheet courier={find(ledgerId)} onOpenChange={(v) => !v && setLedgerId(null)} />
      <SettlementDialog courier={find(settleId)} onOpenChange={(v) => !v && setSettleId(null)} />
    </Page>
  );
}
