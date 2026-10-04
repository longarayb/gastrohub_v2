import { ErrorCode } from '@app/shared';

/**
 * Base class for expected business errors. Messages are user-facing (pt-BR).
 * Thrown from services and translated to the standard API error body by the global filter.
 */
export class DomainError extends Error {
  constructor(
    message: string,
    readonly code: ErrorCode = ErrorCode.BUSINESS_RULE,
    readonly statusCode = 422,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class NotFoundError extends DomainError {
  constructor(entity = 'Registro', details?: unknown) {
    super(`${entity} não encontrado(a)`, ErrorCode.NOT_FOUND, 404, details);
  }
}

export class ConflictError extends DomainError {
  constructor(message: string, details?: unknown) {
    super(message, ErrorCode.CONFLICT, 409, details);
  }
}

export class ForbiddenError extends DomainError {
  constructor(message = 'Você não tem permissão para esta ação') {
    super(message, ErrorCode.FORBIDDEN, 403);
  }
}

export class UnauthorizedError extends DomainError {
  constructor(message = 'Sessão inválida ou expirada. Faça login novamente.') {
    super(message, ErrorCode.UNAUTHORIZED, 401);
  }
}

export class ValidationError extends DomainError {
  constructor(message = 'Dados inválidos', details?: unknown) {
    super(message, ErrorCode.VALIDATION, 400, details);
  }
}
