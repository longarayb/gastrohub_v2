import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ErrorCode } from '@app/shared';
import { z } from 'zod';
import { toErrorBody } from './all-exceptions.filter.js';
import { ConflictError, DomainError, NotFoundError } from './domain-error.js';

describe('toErrorBody', () => {
  it('maps domain errors', () => {
    expect(toErrorBody(new NotFoundError('Pedido'))).toMatchObject({
      statusCode: 404,
      code: ErrorCode.NOT_FOUND,
      message: 'Pedido não encontrado(a)',
    });
    expect(toErrorBody(new ConflictError('Mesa já está aberta'))).toMatchObject({
      statusCode: 409,
      message: 'Mesa já está aberta',
    });
    expect(toErrorBody(new DomainError('Caixa fechado'))).toMatchObject({
      statusCode: 422,
      code: ErrorCode.BUSINESS_RULE,
    });
  });

  it('maps zod errors to 400 with details', () => {
    const result = z.object({ name: z.string().min(1, 'Informe o nome') }).safeParse({ name: '' });
    const body = toErrorBody(result.error);
    expect(body.statusCode).toBe(400);
    expect(body.message).toBe('Informe o nome');
    expect(body.details).toEqual([{ path: 'name', message: 'Informe o nome' }]);
  });

  it('translates Nest http exceptions to pt-BR', () => {
    expect(toErrorBody(new NotFoundException()).message).toBe('Recurso não encontrado');
    expect(toErrorBody(new ForbiddenException()).code).toBe(ErrorCode.FORBIDDEN);
  });

  it('maps prisma unique violations to 409', () => {
    const err = Object.assign(new Error('Unique constraint'), {
      name: 'PrismaClientKnownRequestError',
      code: 'P2002',
      meta: { target: ['email'] },
    });
    expect(toErrorBody(err)).toMatchObject({ statusCode: 409, code: ErrorCode.CONFLICT });
  });

  it('hides unknown errors', () => {
    expect(toErrorBody(new Error('db password leaked'))).toEqual({
      statusCode: 500,
      code: ErrorCode.INTERNAL,
      message: 'Erro interno. Tente novamente em instantes.',
    });
  });
});
