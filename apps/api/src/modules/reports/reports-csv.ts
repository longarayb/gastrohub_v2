import {
  LOSS_KIND_LABELS,
  type LossesReportDto,
  PAYMENT_METHOD_LABELS,
  REPORT_CHANNEL_LABELS,
  type SalesReportDto,
  type TimesReportDto,
  formatDateTime,
  toCsv,
} from '@app/shared';
import { ValidationError } from '../../core/errors/domain-error.js';

const WEEKDAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const minutes = (seconds: number | null) =>
  seconds === null ? null : Math.round((seconds / 60) * 10) / 10;
const brDate = (date: string) => date.split('-').reverse().join('/');

/** CSV of one section of the sales report (Excel pt-BR: `;` and decimal comma). */
export function salesCsv(dto: SalesReportDto, section: string): string {
  switch (section) {
    case 'products':
      return toCsv(dto.products, [
        { header: 'Produto', value: (r) => r.name },
        { header: 'Categoria', value: (r) => r.categoryName },
        { header: 'Quantidade', value: (r) => r.quantity },
        { header: 'Faturamento (R$)', value: (r) => r.revenueCents, format: 'cents' },
        { header: 'Participação (%)', value: (r) => r.sharePct, format: 'percent' },
        { header: 'Acumulado (%)', value: (r) => r.cumulativePct, format: 'percent' },
        { header: 'Curva ABC', value: (r) => r.abc },
      ]);
    case 'categories':
      return toCsv(dto.categories, [
        { header: 'Categoria', value: (r) => r.name },
        { header: 'Quantidade', value: (r) => r.quantity },
        { header: 'Faturamento (R$)', value: (r) => r.revenueCents, format: 'cents' },
        { header: 'Participação (%)', value: (r) => r.sharePct, format: 'percent' },
      ]);
    case 'payments':
      return toCsv(dto.payments, [
        { header: 'Forma de pagamento', value: (r) => PAYMENT_METHOD_LABELS[r.method] },
        { header: 'Pagamentos', value: (r) => r.payments },
        { header: 'Recebido (R$)', value: (r) => r.receivedCents, format: 'cents' },
        { header: 'Estornado (R$)', value: (r) => r.refundedCents, format: 'cents' },
        { header: 'Líquido (R$)', value: (r) => r.netCents, format: 'cents' },
      ]);
    case 'channels':
      return toCsv(dto.channels, [
        { header: 'Canal', value: (r) => REPORT_CHANNEL_LABELS[r.channel] },
        { header: 'Pedidos', value: (r) => r.orders },
        { header: 'Faturamento (R$)', value: (r) => r.revenueCents, format: 'cents' },
      ]);
    case 'days':
      return toCsv(dto.days, [
        { header: 'Dia de negócio', value: (r) => brDate(r.date) },
        { header: 'Pedidos', value: (r) => r.orders },
        { header: 'Faturamento (R$)', value: (r) => r.revenueCents, format: 'cents' },
      ]);
    case 'hours': {
      const rows = dto.heatmap.orders.flatMap((hours, weekday) =>
        hours.map((orders, hour) => ({
          weekday,
          hour,
          orders,
          revenueCents: dto.heatmap.revenueCents[weekday]![hour]!,
        })),
      );
      return toCsv(rows, [
        { header: 'Dia da semana', value: (r) => WEEKDAYS[r.weekday] },
        { header: 'Hora', value: (r) => `${String(r.hour).padStart(2, '0')}h` },
        { header: 'Pedidos', value: (r) => r.orders },
        { header: 'Valor (R$)', value: (r) => r.revenueCents, format: 'cents' },
      ]);
    }
    case 'waiters':
      return toCsv(dto.waiters, [
        { header: 'Garçom', value: (r) => r.name },
        { header: 'Mesas', value: (r) => r.tables },
        { header: 'Itens', value: (r) => r.items },
        { header: 'Valor dos itens (R$)', value: (r) => r.itemsCents, format: 'cents' },
        { header: 'Taxa de serviço (R$)', value: (r) => r.serviceFeeCents, format: 'cents' },
      ]);
    default:
      throw new ValidationError('Seção do relatório desconhecida');
  }
}

export function lossesCsv(dto: LossesReportDto, section: string): string {
  if (section === 'events') {
    return toCsv(dto.events, [
      { header: 'Data e hora', value: (r) => formatDateTime(r.at) },
      { header: 'Dia de negócio', value: (r) => brDate(r.businessDate) },
      { header: 'Tipo', value: (r) => LOSS_KIND_LABELS[r.kind] },
      { header: 'Usuário', value: (r) => r.userName },
      { header: 'Pedido', value: (r) => r.orderNumber },
      { header: 'Descrição', value: (r) => r.description },
      { header: 'Motivo', value: (r) => r.reason },
      { header: 'Valor (R$)', value: (r) => r.cents, format: 'cents' },
      { header: 'Depois de ir para a produção', value: (r) => (r.afterProduction ? 'Sim' : 'Não') },
    ]);
  }
  if (section === 'users') {
    return toCsv(dto.users, [
      { header: 'Usuário', value: (r) => r.name },
      ...Object.entries(LOSS_KIND_LABELS).flatMap(([kind, label]) => [
        {
          header: `${label} (qtd.)`,
          value: (r: (typeof dto.users)[number]) => r.counts[kind as never] ?? 0,
        },
        {
          header: `${label} (R$)`,
          value: (r: (typeof dto.users)[number]) => r.cents[kind as never] ?? 0,
          format: 'cents' as const,
        },
      ]),
      { header: 'Cancelamentos depois da produção', value: (r) => r.afterProduction },
    ]);
  }
  throw new ValidationError('Seção do relatório desconhecida');
}

export function timesCsv(dto: TimesReportDto, section: string): string {
  const stats = [
    { header: 'Itens', value: (r: TimesReportDto['products'][number]) => r.total.count },
    {
      header: 'Espera mediana (min)',
      value: (r: TimesReportDto['products'][number]) => minutes(r.wait.medianSeconds),
    },
    {
      header: 'Preparo mediana (min)',
      value: (r: TimesReportDto['products'][number]) => minutes(r.prep.medianSeconds),
    },
    {
      header: 'Total mediana (min)',
      value: (r: TimesReportDto['products'][number]) => minutes(r.total.medianSeconds),
    },
    {
      header: 'Total P90 (min)',
      value: (r: TimesReportDto['products'][number]) => minutes(r.total.p90Seconds),
    },
    {
      header: 'Acima do limite (%)',
      value: (r: TimesReportDto['products'][number]) => r.total.overLimitPct,
      format: 'percent' as const,
    },
  ];
  if (section === 'sectors')
    return toCsv(dto.sectors, [{ header: 'Setor', value: (r) => r.name }, ...stats]);
  if (section === 'products') {
    return toCsv(dto.products, [
      { header: 'Produto', value: (r) => r.name },
      { header: 'Setor', value: (r) => r.sectorName },
      ...stats,
    ]);
  }
  throw new ValidationError('Seção do relatório desconhecida');
}
