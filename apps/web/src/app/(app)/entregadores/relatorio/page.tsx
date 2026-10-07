'use client';

import { type DeliveryReportRowDto, formatBRL, toBusinessDate } from '@app/shared';
import { Button } from '@app/ui/components/button';
import { Card, CardContent, CardHeader, CardTitle } from '@app/ui/components/card';
import { Input } from '@app/ui/components/input';
import { Skeleton } from '@app/ui/components/misc';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@app/ui/components/table';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { BalanceText } from '@/components/delivery/courier-dialogs';
import { Page } from '@/components/page';
import { useDeliveryReport } from '@/lib/delivery';

const minutes = (m: number | null) => (m == null ? '—' : `${m} min`);

function TimesTable({ title, rows }: { title: string; rows: DeliveryReportRowDto[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma entrega no período.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead className="text-right">Entregas</TableHead>
                <TableHead className="text-right">Não entregues</TableHead>
                <TableHead className="text-right">Saída → entrega</TableHead>
                <TableHead className="text-right">Pedido → entrega</TableHead>
                <TableHead className="text-right">Atrasadas</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.key}>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell className="tabular text-right">{r.deliveries}</TableCell>
                  <TableCell className="tabular text-right">{r.failures}</TableCell>
                  <TableCell className="tabular text-right">
                    {minutes(r.avgDeliveryMinutes)}
                  </TableCell>
                  <TableCell className="tabular text-right">{minutes(r.avgTotalMinutes)}</TableCell>
                  <TableCell className="tabular text-right">{r.late}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

/** Delivery report: fees apart from sales, times per area and courier, who owes whom. */
export default function DeliveryReportPage() {
  const [from, setFrom] = useState(() => toBusinessDate());
  const [to, setTo] = useState(() => toBusinessDate());
  const { data, isLoading, error } = useDeliveryReport(from, to);

  return (
    <Page
      title="Relatório de entregas"
      description="Por data de negócio. A taxa de entrega aparece separada do valor dos produtos."
      actions={
        <Button asChild variant="ghost">
          <Link href={'/entregadores' as never}>
            <ArrowLeft /> Entregadores
          </Link>
        </Button>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="date"
          aria-label="De"
          className="w-40"
          value={from}
          onChange={(e) => e.target.value && setFrom(e.target.value)}
        />
        <span className="text-sm text-muted-foreground">até</span>
        <Input
          type="date"
          aria-label="Até"
          className="w-40"
          value={to}
          onChange={(e) => e.target.value && setTo(e.target.value)}
        />
      </div>

      {error ? (
        <p className="text-sm text-destructive">{(error as Error).message}</p>
      ) : isLoading || !data ? (
        <Skeleton className="h-64" />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              ['Pedidos entregues', String(data.orders)],
              ['Produtos', formatBRL(data.productsCents)],
              ['Taxas de entrega', formatBRL(data.deliveryFeesCents)],
            ].map(([label, value]) => (
              <Card key={label}>
                <CardContent className="space-y-1 pt-6">
                  <p className="text-sm text-muted-foreground">{label}</p>
                  <p className="tabular text-2xl font-semibold">{value}</p>
                </CardContent>
              </Card>
            ))}
          </div>
          <TimesTable title="Por área" rows={data.byArea} />
          <TimesTable title="Por entregador" rows={data.byCourier} />
          <Card>
            <CardHeader>
              <CardTitle>Quem deve a quem</CardTitle>
            </CardHeader>
            <CardContent>
              {data.balances.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum saldo em aberto.</p>
              ) : (
                <ul className="divide-y text-sm">
                  {data.balances.map((b) => (
                    <li key={b.courierId} className="flex flex-wrap justify-between gap-2 py-2">
                      <span className="font-medium">{b.name}</span>
                      <span className="flex gap-4">
                        <BalanceText cents={b.balanceCents} />
                        {b.courierOwesCents > 0 && (
                          <span className="tabular text-destructive">
                            Faltas no período: {formatBRL(b.courierOwesCents)}
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </Page>
  );
}
