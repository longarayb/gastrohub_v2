import { Injectable } from '@nestjs/common';
import { type CreateUserInput, Role, type UpdateUserInput, assignableRoles } from '@app/shared';
import { AuditAction, AuditService } from '../../core/audit/audit.service.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../core/errors/domain-error.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { type Db, InjectDb } from '../../core/tenancy/db.provider.js';
import { TenantContext } from '../../core/tenancy/tenant-context.js';
import { PasswordService } from '../auth/password.service.js';
import { TokenService } from '../auth/token.service.js';

export interface StoreUserDto {
  id: string;
  membershipId: string;
  name: string;
  email: string;
  phone: string | null;
  role: Role;
  isActive: boolean;
  lastLoginAt: Date | null;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly prisma: PrismaService,
    private readonly ctx: TenantContext,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<StoreUserDto[]> {
    const memberships = await this.db.membership.findMany({
      include: { user: true },
      orderBy: { user: { name: 'asc' } },
    });
    return memberships.map((m) => ({
      id: m.user.id,
      membershipId: m.id,
      name: m.user.name,
      email: m.user.email,
      phone: m.user.phone,
      role: m.role as Role,
      // A user is active in this store only if both the account and the membership are active.
      isActive: m.isActive && m.user.isActive,
      lastLoginAt: m.user.lastLoginAt,
    }));
  }

  /** Creates the user or, if the e-mail already exists, grants access to the current store. */
  async create(input: CreateUserInput & { role: Role }): Promise<StoreUserDto> {
    this.assertCanAssign(input.role);
    const email = input.email.toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });

    let userId: string;
    if (existing) {
      const member = await this.db.membership.findFirst({ where: { userId: existing.id } });
      if (member) throw new ConflictError('Este usuário já tem acesso a esta unidade');
      userId = existing.id;
      await this.db.membership.create({ data: { userId, role: input.role } });
    } else {
      const user = await this.db.user.create({
        data: {
          name: input.name,
          email,
          phone: input.phone ?? null,
          passwordHash: await this.passwords.hash(input.password),
          lastStoreId: this.ctx.tenantId,
          // tenantId injected by the tenant extension (nested create)
          memberships: { create: { role: input.role } },
        },
      });
      userId = user.id;
    }

    await this.audit.log({
      action: AuditAction.USER_CREATED,
      entity: 'User',
      entityId: userId,
      after: { email, role: input.role },
    });
    return this.getOne(userId);
  }

  async update(userId: string, input: UpdateUserInput): Promise<StoreUserDto> {
    const membership = await this.db.membership.findFirst({ where: { userId } });
    if (!membership) throw new NotFoundError('Usuário');
    const before = await this.getOne(userId);

    const currentRole = this.ctx.role;
    // Managers cannot change owners.
    if (membership.role === Role.OWNER && currentRole !== Role.OWNER) {
      throw new ForbiddenError('Apenas o dono pode alterar outro dono');
    }
    if (input.role) this.assertCanAssign(input.role);

    const demotingOrDisablingOwner =
      membership.role === Role.OWNER &&
      ((input.role && input.role !== Role.OWNER) || input.isActive === false);
    if (demotingOrDisablingOwner) {
      const owners = await this.db.membership.count({
        where: { role: Role.OWNER, isActive: true },
      });
      if (owners <= 1) throw new ValidationError('A unidade precisa ter pelo menos um dono ativo');
    }
    if (userId === this.ctx.userId && input.isActive === false) {
      throw new ValidationError('Você não pode desativar o próprio usuário');
    }

    await this.db.$transaction(async (tx) => {
      await tx.membership.update({
        where: { id: membership.id },
        data: { role: input.role, isActive: input.isActive },
      });
      if (input.name || input.phone !== undefined || input.password) {
        await tx.user.update({
          where: { id: userId },
          data: {
            name: input.name,
            phone: input.phone,
            passwordHash: input.password ? await this.passwords.hash(input.password) : undefined,
          },
        });
      }
    });

    // Role/status changes take effect immediately: force a new login on other devices.
    if (input.role || input.isActive === false || input.password) {
      await this.tokens.revokeAllForUser(userId);
    }

    const after = await this.getOne(userId);
    await this.audit.log({
      action: AuditAction.USER_UPDATED,
      entity: 'User',
      entityId: userId,
      before: { role: before.role, isActive: before.isActive, name: before.name },
      after: { role: after.role, isActive: after.isActive, name: after.name },
    });
    return after;
  }

  private async getOne(userId: string): Promise<StoreUserDto> {
    const user = (await this.list()).find((u) => u.id === userId);
    if (!user) throw new NotFoundError('Usuário');
    return user;
  }

  private assertCanAssign(role: Role): void {
    const current = this.ctx.role;
    if (!current || !assignableRoles(current).includes(role)) {
      throw new ForbiddenError('Você não pode atribuir este papel');
    }
  }
}
