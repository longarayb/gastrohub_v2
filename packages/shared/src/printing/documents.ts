/**
 * Printed documents (D036): production ticket per sector, "CANCELADO" slip, delivery copy,
 * pre-bill, cash close and courier settlement, and the printer test page. Pure builders of the
 * document model; the same output is previewed in the panel and encoded by the agent.
 */
import { CASH_MOVEMENT_TYPE_LABELS } from '../domain/cash-session.js';
import type { SettlementDto } from '../delivery/types.js';
import { type TaskDetails } from '../domain/kds.js';
import { splitEvenly } from '../domain/bill-split.js';
import {
  ACCENT_TEST_LINE,
  type PaperWidth,
  type PrintDocument,
  type PrintLine,
  type PrinterProfile,
} from '../domain/printing.js';
import { ORDER_TYPE_LABELS, type OrderType } from '../domain/order-status.js';
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from '../orders/payment-methods.js';
import type { OrderDetailDto } from '../orders/types.js';
import { formatBRL } from '../utils/money.js';
import type { CashSessionDetailDto } from '../pos/types.js';
import { formatPhone } from '../utils/phone.js';

const TZ = 'America/Sao_Paulo';
const clock = (iso: string) =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(
    new Date(iso),
  );
const dateTime = (iso: string) =>
  new Intl.DateTimeFormat('pt-BR', {
    timeZone: TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));

const t = (text: string, extra: Omit<Extract<PrintLine, { kind: 'text' }>, 'kind' | 'text'> = {}) =>
  ({ kind: 'text', text, ...extra }) as const;
const cols = (left: string, right: string, bold = false) =>
  ({ kind: 'columns', left, right, bold }) as const;
const divider = (char: '-' | '=' = '-') => ({ kind: 'divider', char }) as const;
const NOT_FISCAL = t('Não é documento fiscal', { align: 'center' });

// ---------------------------------------------------------------------------
// Production ticket (one per round and sector)

export interface KitchenTicketInput {
  sectorName: string;
  orderNumber: number;
  orderType: OrderType;
  /** "Mesa 5 · Ana", "Mariana", "Balcão". */
  title: string;
  roundNumber: number;
  sentAt: string;
  waiterName?: string | null;
  sourceLabel?: string | null;
  orderNotes?: string | null;
  tasks: { name: string; quantity: number; details: TaskDetails }[];
  beep?: boolean;
}

/** Big and readable, removals white on black (as on the KDS). */
export function kitchenTicketDocument(input: KitchenTicketInput): PrintDocument {
  const lines: PrintLine[] = [
    ...(input.beep ? [{ kind: 'beep' } as const] : []),
    t(input.sectorName.toUpperCase(), { align: 'center', bold: true }),
    t(`#${input.orderNumber}`, { align: 'center', size: 'double', bold: true }),
    t(`${ORDER_TYPE_LABELS[input.orderType].toUpperCase()} · ${input.title}`, {
      align: 'center',
      size: 'tall',
      bold: true,
      invert: input.orderType === 'DELIVERY',
    }),
    t(
      [
        input.roundNumber > 1 ? `Rodada ${input.roundNumber}` : null,
        clock(input.sentAt),
        input.waiterName,
        input.sourceLabel,
      ]
        .filter(Boolean)
        .join(' · '),
      { align: 'center' },
    ),
    divider('='),
  ];
  for (const task of input.tasks) {
    const d = task.details;
    lines.push(
      t(`${task.quantity}x ${task.name}${d.size ? ` (${d.size})` : ''}`, {
        size: 'tall',
        bold: true,
      }),
    );
    if (d.comboOf) lines.push(t(`   do ${d.comboOf}`));
    for (const f of d.flavors) {
      lines.push(t(`   ${f.fraction ? `${f.fraction} ` : ''}${f.name}`, { bold: true }));
      if (f.note) lines.push(t(`     Obs.: ${f.note}`));
    }
    for (const m of d.modifiers.filter((x) => !x.removal)) {
      lines.push(t(`   + ${m.quantity > 1 ? `${m.quantity}x ` : ''}${m.name}`));
    }
    for (const r of d.removals) lines.push(t(r.toUpperCase(), { invert: true, size: 'tall' }));
    const plainNote = d.note
      ?.split(/[,;\n]+/)
      .map((p) => p.trim())
      .filter((p) => p && !d.removals.some((r) => r.toLowerCase() === p.toLowerCase()))
      .join(', ');
    if (plainNote) lines.push(t(`   Obs.: ${plainNote}`, { bold: true }));
    lines.push(divider());
  }
  if (input.orderNotes) lines.push(t(`OBS. DO PEDIDO: ${input.orderNotes}`, { bold: true }));
  lines.push(t(`${input.tasks.reduce((n, x) => n + x.quantity, 0)} item(ns)`, { align: 'right' }));
  return {
    title: `Comanda · ${input.sectorName} · #${input.orderNumber}`,
    lines,
  };
}

/** Slip to the sector when something already printed is canceled. */
export function cancelSlipDocument(input: {
  sectorName: string;
  orderNumber: number;
  title: string;
  canceledAt: string;
  wholeOrder: boolean;
  items: { name: string; quantity: number }[];
  reason?: string | null;
}): PrintDocument {
  return {
    title: `Cancelado · ${input.sectorName} · #${input.orderNumber}`,
    lines: [
      { kind: 'beep' },
      t('CANCELADO', { align: 'center', size: 'double', invert: true }),
      t(`#${input.orderNumber} · ${input.title}`, { align: 'center', size: 'tall', bold: true }),
      t(`${input.sectorName} · ${clock(input.canceledAt)}`, { align: 'center' }),
      divider('='),
      ...(input.wholeOrder
        ? [t('PEDIDO INTEIRO CANCELADO: NÃO PREPARE', { bold: true, size: 'tall' })]
        : input.items.map((i) => t(`${i.quantity}x ${i.name}`, { size: 'tall', bold: true }))),
      ...(input.reason ? [t(`Motivo: ${input.reason}`)] : []),
    ],
  };
}

// ---------------------------------------------------------------------------
// Customer-facing documents

function itemLines(order: Pick<OrderDetailDto, 'items'>): PrintLine[] {
  const lines: PrintLine[] = [];
  for (const item of order.items.filter((i) => i.status !== 'CANCELED')) {
    lines.push(
      cols(
        `${item.quantity}x ${item.name}${item.sizeName ? ` ${item.sizeName}` : ''}`,
        formatBRL(item.totalCents),
      ),
    );
    for (const m of item.snapshot.modifiers)
      lines.push(t(`   + ${m.quantity > 1 ? `${m.quantity}x ` : ''}${m.name}`));
    if (item.snapshot.flavors.length > 1) {
      lines.push(t(`   ${item.snapshot.flavors.map((f) => f.name).join(' / ')}`));
    }
    if (item.notes) lines.push(t(`   Obs.: ${item.notes}`));
  }
  return lines;
}

function totalLines(order: OrderDetailDto): PrintLine[] {
  const lines: PrintLine[] = [cols('Subtotal', formatBRL(order.subtotalCents))];
  if (order.orderDiscountCents > 0)
    lines.push(cols('Desconto', `- ${formatBRL(order.orderDiscountCents)}`));
  if (order.couponDiscountCents > 0) {
    lines.push(
      cols(`Cupom ${order.couponCode ?? ''}`.trim(), `- ${formatBRL(order.couponDiscountCents)}`),
    );
  }
  if (order.serviceFeeCents > 0) {
    lines.push(
      cols(`Serviço ${order.serviceFeeBps / 100}% (opcional)`, formatBRL(order.serviceFeeCents)),
    );
  }
  if (order.deliveryFeeCents > 0)
    lines.push(cols('Taxa de entrega', formatBRL(order.deliveryFeeCents)));
  lines.push({
    kind: 'columns',
    left: 'TOTAL',
    right: formatBRL(order.totalCents),
    bold: true,
    size: 'tall',
  });
  return lines;
}

/** Delivery copy for the courier: address, what to charge and the change to take. */
export function deliveryCopyDocument(input: {
  storeName: string;
  order: OrderDetailDto;
  mapsUrl?: string | null;
}): PrintDocument {
  const o = input.order;
  const a = o.deliveryAddress;
  const method = o.expectedPaymentMethod as PaymentMethod | null;
  const lines: PrintLine[] = [
    t(input.storeName, { align: 'center', bold: true }),
    t('VIA DE ENTREGA', { align: 'center', bold: true }),
    t(`#${o.number}`, { align: 'center', size: 'double', bold: true }),
    t(dateTime(o.createdAt), { align: 'center' }),
    divider('='),
    t(o.customerName ?? 'Cliente', { size: 'tall', bold: true }),
  ];
  if (o.customerPhone) lines.push(t(`Tel.: ${formatPhone(o.customerPhone)}`, { bold: true }));
  if (a) {
    lines.push(
      t(`${a.street}, ${a.number}${a.complement ? ` - ${a.complement}` : ''}`, { bold: true }),
      t(`${a.neighborhood} - ${a.city}/${a.state}`, { bold: true }),
    );
    if (a.reference) lines.push(t(`Ref.: ${a.reference}`));
  }
  if (o.delivery?.areaName) lines.push(t(`Área: ${o.delivery.areaName}`));
  lines.push(divider(), ...itemLines(o), divider(), ...totalLines(o));
  const balance = Math.max(o.totalCents - o.paidCents, 0);
  if (o.paidCents > 0)
    lines.push(
      cols('Já pago', `- ${formatBRL(o.paidCents)}`),
      cols('A COBRAR', formatBRL(balance), true),
    );
  lines.push(divider());
  if (balance === 0)
    lines.push(t('PAGO - NÃO COBRAR', { align: 'center', size: 'tall', invert: true }));
  else if (method) {
    lines.push(t(`Pagamento: ${PAYMENT_METHOD_LABELS[method]}`, { size: 'tall', bold: true }));
    if (method === 'CASH' && o.changeForCents && o.changeForCents > balance) {
      lines.push(
        t(`Troco para ${formatBRL(o.changeForCents)}`, { bold: true }),
        t(`LEVAR ${formatBRL(o.changeForCents - balance)} DE TROCO`, { invert: true, bold: true }),
      );
    }
  }
  if (o.pixReportedAt && balance > 0) {
    lines.push(t('PIX INFORMADO PELO CLIENTE: CONFERIR', { invert: true }));
  }
  if (o.notes) lines.push(t(`Obs.: ${o.notes}`, { bold: true }));
  if (input.mapsUrl)
    lines.push({ kind: 'feed' }, { kind: 'qr', data: input.mapsUrl, caption: 'Rota no mapa' });
  lines.push({ kind: 'feed' }, NOT_FISCAL);
  return { title: `Via de entrega · #${o.number}`, lines };
}

/** Pre-bill of a table (all its tabs), optional even split and static PIX QR Code. */
export function preBillDocument(input: {
  storeName: string;
  tableNames: string[];
  orders: OrderDetailDto[];
  people?: number | null;
  pixCode?: string | null;
}): PrintDocument {
  const lines: PrintLine[] = [
    t(input.storeName, { align: 'center', bold: true }),
    t('PRÉ-CONTA', { align: 'center', size: 'tall', bold: true }),
    t(`Mesa ${input.tableNames.join(' + ')} · ${dateTime(new Date().toISOString())}`, {
      align: 'center',
    }),
    NOT_FISCAL,
    divider('='),
  ];
  let balance = 0;
  for (const order of input.orders) {
    if (input.orders.length > 1 || order.tabLabel) {
      lines.push(
        t(`Conta #${order.number}${order.tabLabel ? ` · ${order.tabLabel}` : ''}`, { bold: true }),
      );
    }
    lines.push(...itemLines(order), divider(), ...totalLines(order));
    if (order.paidCents > 0) {
      lines.push(
        cols('Já pago', `- ${formatBRL(order.paidCents)}`),
        cols('A pagar', formatBRL(order.balanceCents), true),
      );
    }
    lines.push(divider());
    balance += order.balanceCents;
  }
  if (input.orders.length > 1) lines.push(cols('TOTAL DA MESA', formatBRL(balance), true));
  if (input.people && input.people > 1) {
    lines.push(t(`Dividido por ${input.people} pessoas:`));
    splitEvenly(balance, input.people).forEach((share, i) =>
      lines.push(cols(`Pessoa ${i + 1}`, formatBRL(share))),
    );
  }
  if (input.pixCode)
    lines.push({ kind: 'feed' }, { kind: 'qr', data: input.pixCode, caption: 'Pague com PIX' });
  lines.push({ kind: 'feed' }, t('Obrigado pela preferência!', { align: 'center' }));
  return { title: `Pré-conta · Mesa ${input.tableNames.join(' + ')}`, lines };
}

// ---------------------------------------------------------------------------
// Register reports

const signed = (cents: number) => (cents > 0 ? `+${formatBRL(cents)}` : formatBRL(cents));

export function cashCloseDocument(input: {
  storeName: string;
  session: CashSessionDetailDto;
}): PrintDocument {
  const s = input.session;
  const lines: PrintLine[] = [
    t(input.storeName, { align: 'center', bold: true }),
    t(s.status === 'CLOSED' ? 'FECHAMENTO DE CAIXA' : 'CAIXA ABERTO (PARCIAL)', {
      align: 'center',
      bold: true,
    }),
    divider(),
    cols('Operador', s.operatorName),
    cols('Dia', s.businessDate.split('-').reverse().join('/')),
    cols('Abertura', dateTime(s.openedAt)),
  ];
  if (s.closedAt) lines.push(cols('Fechamento', dateTime(s.closedAt)));
  if (s.closedByName && s.closedByName !== s.operatorName)
    lines.push(cols('Fechado por', s.closedByName));
  if (s.reopenedAt) lines.push(t(`Reaberto por ${s.reopenedByName}: ${s.reopenReason}`));
  lines.push(divider(), cols('Troco inicial', formatBRL(s.openingCents)));
  for (const m of s.movements) {
    lines.push(
      cols(
        `${CASH_MOVEMENT_TYPE_LABELS[m.type]}: ${m.reason}`,
        `${m.type === 'WITHDRAWAL' ? '- ' : ''}${formatBRL(m.amountCents)}`,
      ),
    );
  }
  lines.push(cols('Pagamentos', String(s.paymentCount)), divider());
  if (s.counts.length) {
    lines.push(t('Esperado / contado / diferença', { bold: true }));
    for (const c of s.counts) {
      lines.push(
        t(PAYMENT_METHOD_LABELS[c.method]),
        cols(
          `${formatBRL(c.expectedCents)} / ${formatBRL(c.countedCents)}`,
          signed(c.differenceCents),
        ),
      );
    }
    lines.push(divider(), cols('Diferença total', signed(s.differenceCents ?? 0), true));
  } else if (s.totals) {
    lines.push(t('Esperado até agora', { bold: true }));
    for (const m of s.totals.methods.filter(
      (x) => x.method === 'CASH' || x.receivedCents > 0 || x.refundedCents > 0,
    )) {
      lines.push(cols(PAYMENT_METHOD_LABELS[m.method], formatBRL(m.expectedCents)));
    }
  }
  if (s.closingNotes) lines.push(t(`Obs.: ${s.closingNotes}`));
  lines.push(
    { kind: 'feed', lines: 2 },
    t('______________________________', { align: 'center' }),
    t('Assinatura do operador', { align: 'center' }),
  );
  return { title: `Fechamento de caixa · ${s.operatorName}`, lines };
}

export function courierSettlementDocument(input: {
  storeName: string;
  settlement: SettlementDto;
}): PrintDocument {
  const s = input.settlement;
  const lines: PrintLine[] = [
    t(input.storeName, { align: 'center', bold: true }),
    t('ACERTO DO ENTREGADOR', { align: 'center', bold: true }),
    t(s.courierName, { align: 'center', size: 'tall', bold: true }),
    t(dateTime(s.settledAt), { align: 'center' }),
    divider(),
    cols('Entregas', String(s.deliveries)),
  ];
  if (s.failedDeliveries) lines.push(cols('Não entregues', String(s.failedDeliveries)));
  lines.push(
    cols('Taxas de entrega', formatBRL(s.deliveryFeesCents)),
    divider(),
    cols('Dinheiro esperado', formatBRL(s.expectedCashCents)),
    cols('Dinheiro contado', formatBRL(s.countedCashCents)),
    cols('Diferença', signed(s.cashDifferenceCents), true),
    cols('Cartão esperado', formatBRL(s.expectedCardCents)),
    cols('Comprovantes', formatBRL(s.countedCardCents)),
    cols('Diferença', signed(s.cardDifferenceCents), true),
  );
  if (s.otherCents) lines.push(cols('PIX e outros', formatBRL(s.otherCents)));
  lines.push(
    divider(),
    cols('Por entrega', formatBRL(s.perDeliveryCents)),
    cols('% da taxa', formatBRL(s.feeShareCents)),
    cols('Diária', formatBRL(s.dailyCents)),
    cols('Remuneração', formatBRL(s.earningsCents), true),
    cols('Saldo anterior', signed(s.previousBalanceCents)),
  );
  if (s.shortageDeductedCents)
    lines.push(cols('Falta descontada', `- ${formatBRL(s.shortageDeductedCents)}`));
  if (s.payoutCents) lines.push(cols('Pago agora', `- ${formatBRL(s.payoutCents)}`));
  lines.push(cols('NOVO SALDO', formatBRL(s.newBalanceCents), true));
  if (s.courierOwesCents) lines.push(cols('Entregador deve', formatBRL(s.courierOwesCents), true));
  if (s.notes) lines.push(t(`Obs.: ${s.notes}`));
  lines.push(
    { kind: 'feed', lines: 2 },
    t('______________________________', { align: 'center' }),
    t('Assinatura do entregador', { align: 'center' }),
  );
  return { title: `Acerto · ${s.courierName}`, lines };
}

// ---------------------------------------------------------------------------
// Test page

/** Shows the paper width, the styles and the accents line the owner checks on the spot. */
export function testPageDocument(input: {
  storeName: string;
  printerName: string;
  agentName: string;
  profile: PrinterProfile;
  width: PaperWidth;
  withoutAccents: boolean;
}): PrintDocument {
  const columns = input.width === 58 ? 32 : 48;
  return {
    title: `Teste · ${input.printerName}`,
    lines: [
      { kind: 'beep' },
      t('TESTE DE IMPRESSÃO', { align: 'center', size: 'double', bold: true }),
      t(input.storeName, { align: 'center' }),
      divider('='),
      cols('Impressora', input.printerName),
      cols('Computador', input.agentName),
      cols('Perfil', `${input.profile.brand} ${input.profile.model}`),
      cols('Papel', `${input.width} mm (${columns} colunas)`),
      cols('Acentos', input.withoutAccents ? 'desligados' : input.profile.codepage.toUpperCase()),
      divider(),
      t('Confira os acentos:', { bold: true }),
      t(ACCENT_TEST_LINE, { size: 'tall' }),
      t(
        'Se saírem símbolos estranhos, troque o perfil (outra página de código) ou use "sem acentos".',
      ),
      divider(),
      t('Normal'),
      t('Negrito', { bold: true }),
      t('Grande', { size: 'double' }),
      t('SEM CEBOLA', { invert: true, size: 'tall' }),
      cols('Coluna à esquerda', 'R$ 12,34'),
      t('1234567890'.repeat(Math.ceil(columns / 10)).slice(0, columns)),
      { kind: 'qr', data: 'Teste de QR Code', caption: 'QR Code' },
      t(new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC', { align: 'center' }),
    ],
  };
}
