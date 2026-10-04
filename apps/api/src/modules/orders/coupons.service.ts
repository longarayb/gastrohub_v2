import { Injectable } from '@nestjs/common';
import type { CouponDto, CouponInput } from '@app/shared';
import { ConflictError, NotFoundError } from '../../core/errors/domain-error.js';
import { type Db, InjectDb } from '../../core/tenancy/db.provider.js';
import { type Coupon, Prisma } from '../../generated/prisma/client.js';

const toDto = (c: Coupon): CouponDto => ({
  id: c.id,
  code: c.code,
  type: c.type,
  value: c.value,
  minOrderCents: c.minOrderCents,
  maxDiscountCents: c.maxDiscountCents,
  validFrom: c.validFrom?.toISOString() ?? null,
  validUntil: c.validUntil?.toISOString() ?? null,
  usageLimit: c.usageLimit,
  usedCount: c.usedCount,
  isActive: c.isActive,
});

type CouponData = Omit<CouponInput, 'validFrom' | 'validUntil'> & {
  validFrom?: Date | null;
  validUntil?: Date | null;
};

@Injectable()
export class CouponsService {
  constructor(@InjectDb() private readonly db: Db) {}

  async list(): Promise<CouponDto[]> {
    const coupons = await this.db.coupon.findMany({ orderBy: { createdAt: 'desc' } });
    return coupons.map(toDto);
  }

  private data(input: CouponData) {
    return {
      code: input.code,
      type: input.type,
      value: input.value,
      minOrderCents: input.minOrderCents ?? null,
      maxDiscountCents: input.maxDiscountCents ?? null,
      validFrom: input.validFrom ?? null,
      validUntil: input.validUntil ?? null,
      usageLimit: input.usageLimit ?? null,
      isActive: input.isActive ?? true,
    };
  }

  private unique<T>(promise: Promise<T>): Promise<T> {
    return promise.catch((error: unknown) => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictError('Já existe um cupom com esse código');
      }
      throw error;
    });
  }

  async create(input: CouponData): Promise<CouponDto> {
    return toDto(await this.unique(this.db.coupon.create({ data: this.data(input) })));
  }

  async update(id: string, input: CouponData): Promise<CouponDto> {
    const coupon = await this.db.coupon.findFirst({ where: { id } });
    if (!coupon) throw new NotFoundError('Cupom');
    return toDto(
      await this.unique(this.db.coupon.update({ where: { id }, data: this.data(input) })),
    );
  }
}
