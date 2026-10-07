/** Payment methods (no validation code: light for the browser bundles). */

export const PAYMENT_METHODS = [
  'CASH',
  'PIX',
  'CREDIT_CARD',
  'DEBIT_CARD',
  'MEAL_VOUCHER',
  'ONLINE',
  'OTHER',
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: 'Dinheiro',
  PIX: 'PIX',
  CREDIT_CARD: 'Cartão de crédito',
  DEBIT_CARD: 'Cartão de débito',
  MEAL_VOUCHER: 'Vale-refeição',
  ONLINE: 'Pagamento online',
  OTHER: 'Outro',
};
