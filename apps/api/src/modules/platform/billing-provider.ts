/**
 * Billing provider (D042): the point where a Brazilian payment service (Asaas, Mercado Pago or
 * Pagar.me) will create recurring PIX/boleto charges for the platform invoices. This stage ships
 * only the manual provider: invoices are generated here and marked as paid by the admin.
 */
export interface ProviderCustomer {
  organizationId: string;
  name: string;
  document: string | null;
  email: string | null;
}

export interface ProviderCharge {
  invoiceId: string;
  amountCents: number;
  dueDate: string;
  description: string;
}

export interface CreatedCharge {
  /** Id of the charge at the provider. */
  providerRef: string;
  /** Payment page with PIX QR code and/or boleto. */
  providerUrl: string | null;
}

/** Payment confirmed by the provider (webhook), applied as "mark as paid". */
export interface ProviderPaymentEvent {
  providerRef: string;
  paidOn: string;
  method: 'PIX' | 'BOLETO' | 'CARD';
  amountCents: number;
}

export interface BillingProvider {
  /** "MANUAL", "ASAAS"... stored on each invoice. */
  readonly name: string;
  /** Creates the charge of a new invoice; null = nothing to do (manual). */
  createCharge(customer: ProviderCustomer, charge: ProviderCharge): Promise<CreatedCharge | null>;
  cancelCharge(providerRef: string): Promise<void>;
  /** Validates and parses a webhook call; null when it is not a payment confirmation. */
  parseWebhook(
    headers: Record<string, string | undefined>,
    body: unknown,
  ): Promise<ProviderPaymentEvent | null>;
}

export const BILLING_PROVIDER = Symbol('BILLING_PROVIDER');

/** Manual control: the admin generates invoices and records payments by hand. */
export class ManualBillingProvider implements BillingProvider {
  readonly name = 'MANUAL';
  async createCharge(): Promise<CreatedCharge | null> {
    return null;
  }
  async cancelCharge(): Promise<void> {}
  async parseWebhook(): Promise<ProviderPaymentEvent | null> {
    return null;
  }
}
