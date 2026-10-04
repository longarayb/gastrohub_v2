/** BullMQ queue names. */
export const QUEUES = {
  /** E-mails and other notifications. */
  NOTIFICATIONS: 'notifications',
  /** Print jobs (kitchen tickets, receipts) — consumed by a local print agent in the future. */
  PRINT: 'print',
  /** Marketplace / fiscal / payment integrations (Phase 2+). */
  INTEGRATIONS: 'integrations',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];
