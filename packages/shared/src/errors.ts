/** Standard API error payload returned by every endpoint on failure. */
export interface ApiErrorBody {
  statusCode: number;
  code: ErrorCode;
  message: string;
  details?: unknown;
  requestId?: string;
}

export const ErrorCode = {
  VALIDATION: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  BUSINESS_RULE: 'BUSINESS_RULE',
  RATE_LIMITED: 'RATE_LIMITED',
  /** Overdue organization in read-only mode: no new sales (D042). */
  READ_ONLY: 'READ_ONLY_MODE',
  /** Plan limit or module not included (D042). */
  PLAN_LIMIT: 'PLAN_LIMIT',
  /** Platform admin with a temporary password: only the password change is allowed. */
  PASSWORD_CHANGE_REQUIRED: 'PASSWORD_CHANGE_REQUIRED',
  /** Public demo unit: sensitive actions are refused (D045). */
  DEMO_MODE: 'DEMO_MODE',
  INTERNAL: 'INTERNAL_ERROR',
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/** Message of the actions refused in the public demo unit (D045). */
export const DEMO_MODE_MESSAGE =
  'Indisponível no ambiente de demonstração. Pedidos, caixa, mesas, cozinha, entregas e relatórios estão liberados.';
