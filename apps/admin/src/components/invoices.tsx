'use client';

import {
  PLATFORM_PAYMENT_METHODS,
  PLATFORM_PAYMENT_METHOD_LABELS,
  type PlatformInvoiceDto,
  type PlatformPaymentMethod,
  billingDate,
  formatBRL,
} from '@app/shared';
import { Button } from '@app/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@app/ui/components/dialog';
import { Input } from '@app/ui/components/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@app/ui/components/select';
import { toast } from '@app/ui/components/sonner';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@app/ui/components/table';
import Link from 'next/link';
import { useEffect, useId, useState } from 'react';
import { InvoiceBadge, ReasonDialog } from '@/components/common';
import { Field } from '@/components/form';
import { apiPost, errorMessage } from '@/lib/api';
import { formatCalendarDate, useRefresh } from '@/lib/queries';

/** Manual payment (D042): method, date and note; unblocks the customer right away. */
export function PayInvoiceDialog({
  invoice,
  onOpenChange,
}: {
  invoice: PlatformInvoiceDto | null;
  onOpenChange: (open: boolean) => void;
}) {
  const refresh = useRefresh();
  const dateId = useId();
  const noteId = useId();
  const [paidOn, setPaidOn] = useState(billingDate(new Date()));
  const [method, setMethod] = useState<PlatformPaymentMethod>('PIX');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (invoice) {
      setPaidOn(billingDate(new Date()));
      setMethod('PIX');
      setNote('');
    }
  }, [invoice]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!invoice) return;
    setBusy(true);
    try {
      await apiPost(`/invoices/${invoice.id}/pay`, {
        expectedVersion: invoice.version,
        paidOn,
        paymentMethod: method,
        note: note || null,
      });
      await refresh();
      toast.success('Pagamento registrado. O cliente foi liberado.');
      onOpenChange(false);
    } catch (error) {
      toast.error(errorMessage(error));
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={!!invoice} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>Registrar pagamento</DialogTitle>
            {invoice && (
              <DialogDescription>
                {invoice.customerName} · {formatBRL(invoice.amountCents)} · vencimento{' '}
                {formatCalendarDate(invoice.dueDate)}
              </DialogDescription>
            )}
          </DialogHeader>
          <Field label="Forma de pagamento">
            <Select value={method} onValueChange={(v) => setMethod(v as PlatformPaymentMethod)}>
              <SelectTrigger aria-label="Forma de pagamento">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PLATFORM_PAYMENT_METHODS.map((m) => (
                  <SelectItem key={m} value={m}>
                    {PLATFORM_PAYMENT_METHOD_LABELS[m]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Data do pagamento" htmlFor={dateId}>
            <Input
              id={dateId}
              type="date"
              max={billingDate(new Date())}
              value={paidOn}
              onChange={(e) => setPaidOn(e.target.value)}
            />
          </Field>
          <Field label="Observação (opcional)" htmlFor={noteId}>
            <Input
              id={noteId}
              value={note}
              maxLength={300}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Voltar
            </Button>
            <Button type="submit" loading={busy}>
              Registrar pagamento
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Invoice list with the manual actions (pay, cancel). */
export function InvoiceTable({
  invoices,
  showCustomer = true,
}: {
  invoices: PlatformInvoiceDto[];
  showCustomer?: boolean;
}) {
  const refresh = useRefresh();
  const [paying, setPaying] = useState<PlatformInvoiceDto | null>(null);
  const [canceling, setCanceling] = useState<PlatformInvoiceDto | null>(null);

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            {showCustomer && <TableHead>Cliente</TableHead>}
            <TableHead>Período</TableHead>
            <TableHead>Vencimento</TableHead>
            <TableHead className="text-right">Valor</TableHead>
            <TableHead>Situação</TableHead>
            <TableHead className="text-right">Ações</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {invoices.map((i) => (
            <TableRow key={i.id}>
              {showCustomer && (
                <TableCell>
                  <Link
                    href={`/clientes/${i.organizationId}` as never}
                    className="font-semibold hover:underline"
                  >
                    {i.customerName}
                  </Link>
                </TableCell>
              )}
              <TableCell className="text-sm">
                {formatCalendarDate(i.periodStart)} a {formatCalendarDate(i.periodEnd)}
                {i.details?.extraStores ? (
                  <p className="text-xs text-muted-foreground">
                    {i.details.planName} + {i.details.extraStores} unidade(s) adicional(is)
                  </p>
                ) : null}
              </TableCell>
              <TableCell>{formatCalendarDate(i.dueDate)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatBRL(i.amountCents)}</TableCell>
              <TableCell>
                <InvoiceBadge status={i.displayStatus} daysOverdue={i.daysOverdue} />
                {i.status === 'PAID' && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatCalendarDate(i.paidOn)} ·{' '}
                    {i.paymentMethod ? PLATFORM_PAYMENT_METHOD_LABELS[i.paymentMethod] : ''}
                    {i.paymentNote ? ` · ${i.paymentNote}` : ''}
                  </p>
                )}
                {i.status === 'CANCELED' && i.cancelReason && (
                  <p className="mt-1 text-xs text-muted-foreground">{i.cancelReason}</p>
                )}
              </TableCell>
              <TableCell className="text-right">
                {i.status === 'OPEN' && (
                  <div className="flex justify-end gap-1">
                    <Button size="sm" onClick={() => setPaying(i)}>
                      Registrar pagamento
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setCanceling(i)}>
                      Cancelar
                    </Button>
                  </div>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <PayInvoiceDialog invoice={paying} onOpenChange={(o) => !o && setPaying(null)} />
      <ReasonDialog
        open={!!canceling}
        onOpenChange={(o) => !o && setCanceling(null)}
        title="Cancelar mensalidade"
        description="A mensalidade fica dispensada (não é gerada de novo)."
        confirmLabel="Cancelar mensalidade"
        destructive
        onConfirm={async (reason) => {
          try {
            await apiPost(`/invoices/${canceling!.id}/cancel`, {
              expectedVersion: canceling!.version,
              reason,
            });
            toast.success('Mensalidade cancelada');
          } catch (error) {
            toast.error(errorMessage(error));
            throw error;
          } finally {
            await refresh();
          }
        }}
      />
    </>
  );
}
