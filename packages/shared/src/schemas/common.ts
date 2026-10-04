import { z } from 'zod';
import { normalizeCEP, isValidCEP } from '../utils/cep.js';
import { isValidCNPJ, isValidCPF, onlyDigits } from '../utils/documents.js';
import { isValidPhone, normalizePhone } from '../utils/phone.js';

/** Reusable Zod building blocks with Brazilian validations and pt-BR messages. */

export const zId = z.string().min(1, 'Identificador obrigatório');

/** Integer amount in cents. */
export const zCents = z
  .number({ error: 'Informe um valor' })
  .int('Valor deve estar em centavos')
  .min(0, 'Valor não pode ser negativo');

export const zCPF = z
  .string()
  .transform(onlyDigits)
  .refine(isValidCPF, { message: 'CPF inválido' });

export const zCNPJ = z
  .string()
  .transform(onlyDigits)
  .refine(isValidCNPJ, { message: 'CNPJ inválido' });

export const zDocument = z
  .string()
  .transform(onlyDigits)
  .refine((v) => (v.length === 11 ? isValidCPF(v) : isValidCNPJ(v)), {
    message: 'CPF/CNPJ inválido',
  });

export const zPhone = z
  .string()
  .transform(normalizePhone)
  .refine(isValidPhone, { message: 'Telefone inválido (informe com DDD)' });

export const zCEP = z
  .string()
  .transform(normalizeCEP)
  .refine(isValidCEP, { message: 'CEP inválido' });

export const zEmail = z.email({ message: 'E-mail inválido' }).trim().toLowerCase();

/** "HH:mm" */
export const zTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Horário inválido (HH:mm)');

export const zSlug = z
  .string()
  .min(3, 'Mínimo de 3 caracteres')
  .max(60)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Use apenas letras minúsculas, números e hífens');

export const zPagination = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type Pagination = z.infer<typeof zPagination>;

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export const zAddress = z.object({
  cep: zCEP,
  street: z.string().trim().min(1, 'Informe a rua'),
  number: z.string().trim().min(1, 'Informe o número'),
  complement: z.string().trim().optional().default(''),
  neighborhood: z.string().trim().min(1, 'Informe o bairro'),
  city: z.string().trim().min(1, 'Informe a cidade'),
  state: z.string().trim().length(2, 'UF inválida').toUpperCase(),
  reference: z.string().trim().optional().default(''),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
});
export type AddressInput = z.input<typeof zAddress>;
export type Address = z.output<typeof zAddress>;
