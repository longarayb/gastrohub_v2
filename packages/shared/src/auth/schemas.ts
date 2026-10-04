import { z } from 'zod';
import { zCNPJ, zEmail, zPhone, zSlug } from '../schemas/common.js';
import { ROLES, type Role } from './permissions.js';

export const zPassword = z
  .string()
  .min(8, 'A senha deve ter pelo menos 8 caracteres')
  .max(128, 'Senha muito longa')
  .regex(/[A-Za-z]/, 'A senha deve conter letras')
  .regex(/\d/, 'A senha deve conter números');

export const loginSchema = z.object({
  email: zEmail,
  password: z.string().min(1, 'Informe a senha'),
  storeId: z.string().optional(),
});
export type LoginInput = z.input<typeof loginSchema>;

export const registerSchema = z.object({
  ownerName: z.string().trim().min(2, 'Informe seu nome'),
  email: zEmail,
  password: zPassword,
  phone: zPhone,
  tradeName: z.string().trim().min(2, 'Informe o nome do restaurante'),
  legalName: z.string().trim().min(2, 'Informe a razão social'),
  cnpj: zCNPJ,
  slug: zSlug.optional(),
});
export type RegisterInput = z.input<typeof registerSchema>;

export const forgotPasswordSchema = z.object({ email: zEmail });
export type ForgotPasswordInput = z.input<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z
  .object({
    token: z.string().min(10, 'Link inválido'),
    password: zPassword,
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: 'As senhas não conferem',
    path: ['confirmPassword'],
  });
export type ResetPasswordInput = z.input<typeof resetPasswordSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Informe a senha atual'),
    newPassword: zPassword,
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: 'As senhas não conferem',
    path: ['confirmPassword'],
  });
export type ChangePasswordInput = z.input<typeof changePasswordSchema>;

export const switchStoreSchema = z.object({ storeId: z.string().min(1) });

export const zRole = z.enum(ROLES as [Role, ...Role[]], { error: 'Papel inválido' });

export const createUserSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome'),
  email: zEmail,
  phone: zPhone.optional().or(z.literal('').transform(() => undefined)),
  role: zRole,
  password: zPassword,
});
export type CreateUserInput = z.input<typeof createUserSchema>;

export const updateUserSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome').optional(),
  phone: zPhone.optional().or(z.literal('').transform(() => null)),
  role: zRole.optional(),
  isActive: z.boolean().optional(),
  password: zPassword.optional().or(z.literal('').transform(() => undefined)),
});
export type UpdateUserInput = z.input<typeof updateUserSchema>;

/** Payload carried inside the access token. */
export interface AccessTokenPayload {
  sub: string;
  tenantId: string;
  role: Role;
}

export interface SessionUser {
  id: string;
  name: string;
  email: string;
}

export interface SessionStore {
  id: string;
  slug: string;
  tradeName: string;
  logoUrl: string | null;
}

export interface SessionMembership {
  storeId: string;
  tradeName: string;
  role: Role;
}

export interface AuthSession {
  accessToken: string;
  expiresIn: number;
  user: SessionUser;
  store: SessionStore;
  role: Role;
  memberships: SessionMembership[];
}
