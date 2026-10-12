'use client';

import {
  type InvoiceDisplayStatus,
  SUBSCRIPTION_STATUS_LABELS,
  type SubscriptionStatus,
} from '@app/shared';
import { Badge } from '@app/ui/components/badge';
import { Button } from '@app/ui/components/button';
import { Card } from '@app/ui/components/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@app/ui/components/dialog';
import { Textarea } from '@app/ui/components/textarea';
import { cn } from '@app/ui/lib/utils';
import { useEffect, useId, useState } from 'react';
import { Field } from '@/components/form';

const STATUS_VARIANT: Record<
  SubscriptionStatus,
  'success' | 'info' | 'warning' | 'destructive' | 'secondary'
> = {
  ACTIVE: 'success',
  TRIALING: 'info',
  PAST_DUE: 'warning',
  SUSPENDED: 'destructive',
  CANCELED: 'secondary',
};

/** Subscription status with text (never color alone). */
export function SubscriptionBadge({ status }: { status: SubscriptionStatus | null }) {
  if (!status) return <Badge variant="outline">Sem assinatura</Badge>;
  return <Badge variant={STATUS_VARIANT[status]}>{SUBSCRIPTION_STATUS_LABELS[status]}</Badge>;
}

const INVOICE_LABELS: Record<InvoiceDisplayStatus, string> = {
  OPEN: 'Em aberto',
  DUE_SOON: 'A vencer',
  OVERDUE: 'Atrasada',
  PAID: 'Paga',
  CANCELED: 'Cancelada',
};
const INVOICE_VARIANT: Record<
  InvoiceDisplayStatus,
  'success' | 'info' | 'warning' | 'destructive' | 'secondary' | 'outline'
> = {
  OPEN: 'outline',
  DUE_SOON: 'info',
  OVERDUE: 'warning',
  PAID: 'success',
  CANCELED: 'secondary',
};

export function InvoiceBadge({
  status,
  daysOverdue,
}: {
  status: InvoiceDisplayStatus;
  daysOverdue?: number;
}) {
  return (
    <Badge variant={INVOICE_VARIANT[status]}>
      {INVOICE_LABELS[status]}
      {status === 'OVERDUE' && daysOverdue ? ` · ${daysOverdue} d` : ''}
    </Badge>
  );
}

/** KPI card (docs/DESIGN.md): label, big number, optional note; colored side bar by tone. */
export function Kpi({
  label,
  value,
  note,
  tone = 'neutral',
}: {
  label: string;
  value: React.ReactNode;
  note?: React.ReactNode;
  tone?: 'neutral' | 'positive' | 'attention' | 'critical' | 'info';
}) {
  return (
    <Card
      className={cn(
        'gap-1 border-l-4 p-4',
        tone === 'positive' && 'border-l-signal-positive',
        tone === 'attention' && 'border-l-signal-attention',
        tone === 'critical' && 'border-l-signal-critical',
        tone === 'info' && 'border-l-accent-blue',
        tone === 'neutral' && 'border-l-border',
      )}
    >
      <p className="text-sm font-semibold text-muted-foreground">{label}</p>
      <p className="text-3xl font-extrabold tabular-nums">{value}</p>
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
    </Card>
  );
}

/** Asks for a mandatory reason (every sensitive admin action is audited with it). */
export function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  destructive,
  children,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  /** Extra fields above the reason. */
  children?: React.ReactNode;
  onConfirm: (reason: string) => Promise<unknown>;
}) {
  const id = useId();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setReason('');
      setError(undefined);
    }
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (reason.trim().length < 5) return setError('Informe o motivo (mínimo de 5 caracteres)');
    setBusy(true);
    try {
      await onConfirm(reason.trim());
      onOpenChange(false);
    } catch {
      // The caller shows the error.
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
          {children}
          <Field label="Motivo (fica na auditoria)" error={error} htmlFor={id}>
            <Textarea
              id={id}
              value={reason}
              maxLength={300}
              aria-invalid={!!error}
              onChange={(e) => {
                setReason(e.target.value);
                setError(undefined);
              }}
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Voltar
            </Button>
            <Button type="submit" variant={destructive ? 'destructive' : 'default'} loading={busy}>
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
