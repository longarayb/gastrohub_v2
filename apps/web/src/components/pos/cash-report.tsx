'use client';

import {
  CASH_MOVEMENT_TYPE_LABELS,
  type CashSessionDetailDto,
  PAYMENT_METHOD_LABELS,
  formatBRL,
  formatDateTime,
} from '@app/shared';
import { ReceiptDivider, ReceiptRow } from './common';

const signed = (cents: number) => (cents > 0 ? `+${formatBRL(cents)}` : formatBRL(cents));

/** 80 mm closing report of a cash register (expected × counted per method). */
export function CashReport({
  storeName,
  session,
}: {
  storeName: string;
  session: CashSessionDetailDto;
}) {
  return (
    <div className="space-y-1">
      <p className="text-center text-sm font-bold">{storeName}</p>
      <p className="text-center font-bold">
        {session.status === 'CLOSED' ? 'FECHAMENTO DE CAIXA' : 'CAIXA ABERTO (PARCIAL)'}
      </p>
      <ReceiptDivider />
      <ReceiptRow label="Operador" value={session.operatorName} />
      <ReceiptRow label="Dia" value={session.businessDate.split('-').reverse().join('/')} />
      <ReceiptRow label="Abertura" value={formatDateTime(session.openedAt)} />
      {session.closedAt && (
        <ReceiptRow label="Fechamento" value={formatDateTime(session.closedAt)} />
      )}
      {session.closedByName && session.closedByName !== session.operatorName && (
        <ReceiptRow label="Fechado por" value={session.closedByName} />
      )}
      {session.reopenedAt && (
        <p>
          Reaberto por {session.reopenedByName}: {session.reopenReason}
        </p>
      )}
      <ReceiptDivider />
      <ReceiptRow label="Troco inicial" value={formatBRL(session.openingCents)} />
      {session.movements.map((m) => (
        <ReceiptRow
          key={m.id}
          label={`${CASH_MOVEMENT_TYPE_LABELS[m.type]}: ${m.reason}`}
          value={`${m.type === 'WITHDRAWAL' ? '− ' : ''}${formatBRL(m.amountCents)}`}
        />
      ))}
      <ReceiptRow label="Pagamentos" value={session.paymentCount} />
      <ReceiptDivider />
      {session.counts.length > 0 ? (
        <>
          <p className="font-bold">Esperado / contado / diferença</p>
          {session.counts.map((c) => (
            <div key={c.method}>
              <p>{PAYMENT_METHOD_LABELS[c.method]}</p>
              <ReceiptRow
                label={`${formatBRL(c.expectedCents)} / ${formatBRL(c.countedCents)}`}
                value={signed(c.differenceCents)}
              />
            </div>
          ))}
          <ReceiptDivider />
          <ReceiptRow label="Diferença total" value={signed(session.differenceCents ?? 0)} strong />
        </>
      ) : session.totals ? (
        <>
          <p className="font-bold">Esperado até agora</p>
          {session.totals.methods
            .filter((m) => m.method === 'CASH' || m.receivedCents > 0 || m.refundedCents > 0)
            .map((m) => (
              <ReceiptRow
                key={m.method}
                label={PAYMENT_METHOD_LABELS[m.method]}
                value={formatBRL(m.expectedCents)}
              />
            ))}
        </>
      ) : null}
      {session.closingNotes && <p>Obs.: {session.closingNotes}</p>}
      <p className="pt-4 text-center">______________________________</p>
      <p className="text-center">Assinatura do operador</p>
    </div>
  );
}
