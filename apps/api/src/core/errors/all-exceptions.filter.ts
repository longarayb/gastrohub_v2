import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { type ApiErrorBody, ErrorCode } from '@app/shared';
import type { Request, Response } from 'express';
import { ZodError } from 'zod';
import { DomainError } from './domain-error.js';

const STATUS_TO_CODE: Record<number, ErrorCode> = {
  400: ErrorCode.VALIDATION,
  401: ErrorCode.UNAUTHORIZED,
  403: ErrorCode.FORBIDDEN,
  404: ErrorCode.NOT_FOUND,
  409: ErrorCode.CONFLICT,
  422: ErrorCode.BUSINESS_RULE,
  429: ErrorCode.RATE_LIMITED,
};

const DEFAULT_MESSAGES: Record<number, string> = {
  400: 'Requisição inválida',
  401: 'Não autenticado',
  403: 'Você não tem permissão para esta ação',
  404: 'Recurso não encontrado',
  409: 'Conflito com dados existentes',
  429: 'Muitas requisições. Aguarde um instante e tente novamente.',
  500: 'Erro interno. Tente novamente em instantes.',
};

/** Prisma known request errors, matched structurally to avoid importing the generated client. */
interface PrismaKnownError {
  code: string;
  meta?: { target?: string[] | string; modelName?: string };
}
function isPrismaKnownError(e: unknown): e is PrismaKnownError & Error {
  return (
    e instanceof Error &&
    e.name === 'PrismaClientKnownRequestError' &&
    typeof (e as { code?: unknown }).code === 'string'
  );
}

export function toErrorBody(exception: unknown): ApiErrorBody {
  if (exception instanceof DomainError) {
    return {
      statusCode: exception.statusCode,
      code: exception.code,
      message: exception.message,
      details: exception.details,
    };
  }

  if (exception instanceof ZodError) {
    return {
      statusCode: 400,
      code: ErrorCode.VALIDATION,
      message: exception.issues[0]?.message ?? 'Dados inválidos',
      details: exception.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    };
  }

  if (isPrismaKnownError(exception)) {
    if (exception.code === 'P2002') {
      return {
        statusCode: 409,
        code: ErrorCode.CONFLICT,
        message: 'Já existe um registro com esses dados',
        details: { fields: exception.meta?.target },
      };
    }
    if (exception.code === 'P2025') {
      return { statusCode: 404, code: ErrorCode.NOT_FOUND, message: 'Registro não encontrado' };
    }
    if (exception.code === 'P2003') {
      return {
        statusCode: 409,
        code: ErrorCode.CONFLICT,
        message: 'Este registro está vinculado a outros dados e não pode ser alterado',
      };
    }
  }

  if (exception instanceof HttpException) {
    // Business errors use DomainError (pt-BR); HttpExceptions come from Nest internals
    // with English messages, so we prefer our pt-BR default for the status.
    const status = exception.getStatus();
    return {
      statusCode: status,
      code: STATUS_TO_CODE[status] ?? ErrorCode.INTERNAL,
      message: DEFAULT_MESSAGES[status] ?? exception.message,
    };
  }

  return {
    statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
    code: ErrorCode.INTERNAL,
    message: DEFAULT_MESSAGES[500] as string,
  };
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') throw exception;

    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request & { id?: string }>();
    const res = ctx.getResponse<Response>();
    const body = toErrorBody(exception);
    body.requestId = req.id;

    if (body.statusCode >= 500) {
      this.logger.error(
        { err: exception, path: req.url, requestId: req.id },
        'Unhandled exception',
      );
    }

    res.status(body.statusCode).json(body);
  }
}
