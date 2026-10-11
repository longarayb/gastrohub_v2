'use client';

import { BILLING_INTERVAL_LABELS, formatBRL, formatCNPJ, formatCPF } from '@app/shared';
import { Button } from '@app/ui/components/button';
import { Input } from '@app/ui/components/input';
import { EmptyState, ListSkeleton } from '@app/ui/components/states';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@app/ui/components/table';
import { Building2, Plus, Search } from 'lucide-react';
import Link from 'next/link';
import { useDeferredValue, useState } from 'react';
import { SubscriptionBadge } from '@/components/common';
import { Page } from '@/components/page';
import { formatCalendarDate, useCustomers } from '@/lib/queries';

const formatDocument = (d: string | null) =>
  !d ? '—' : d.length === 11 ? formatCPF(d) : formatCNPJ(d);

export default function CustomersPage() {
  const [q, setQ] = useState('');
  const deferred = useDeferredValue(q);
  const { data, isLoading } = useCustomers(deferred);

  return (
    <Page
      title="Clientes"
      description="Restaurantes que usam a plataforma, com plano e situação da mensalidade."
      actions={
        <Button asChild>
          <Link href="/clientes/novo">
            <Plus /> Novo cliente
          </Link>
        </Button>
      }
    >
      <div className="relative max-w-md">
        <Search
          className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          className="pl-9"
          placeholder="Nome, CNPJ/CPF ou endereço do cardápio"
          aria-label="Buscar cliente"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      {isLoading ? (
        <ListSkeleton rows={6} />
      ) : !data?.length ? (
        <EmptyState icon={Building2} title="Nenhum cliente encontrado" />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cliente</TableHead>
              <TableHead>Situação</TableHead>
              <TableHead>Plano</TableHead>
              <TableHead className="text-right">Unidades</TableHead>
              <TableHead>Próximo vencimento</TableHead>
              <TableHead className="text-right">Mensalidade</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((c) => (
              <TableRow key={c.id}>
                <TableCell>
                  <Link
                    href={`/clientes/${c.id}` as never}
                    className="font-semibold hover:underline"
                  >
                    {c.name}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {formatDocument(c.document)}
                    {c.ownerEmail ? ` · ${c.ownerEmail}` : ''}
                    {!c.isActive ? ' · desativado' : ''}
                  </p>
                </TableCell>
                <TableCell>
                  <SubscriptionBadge status={c.status} />
                  {c.daysOverdue > 0 && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {c.daysOverdue} dias de atraso
                    </p>
                  )}
                  {c.trialEndsOn && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      até {formatCalendarDate(c.trialEndsOn)}
                    </p>
                  )}
                </TableCell>
                <TableCell>{c.planName ?? '—'}</TableCell>
                <TableCell className="text-right tabular-nums">{c.stores}</TableCell>
                <TableCell>{formatCalendarDate(c.nextDueDate)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {c.periodCents != null ? formatBRL(c.periodCents) : '—'}
                  {c.interval && c.interval !== 'MONTHLY' && (
                    <p className="text-xs text-muted-foreground">
                      {BILLING_INTERVAL_LABELS[c.interval]}
                    </p>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Page>
  );
}
