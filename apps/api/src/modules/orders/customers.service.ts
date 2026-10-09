import { Injectable } from '@nestjs/common';
import {
  type Address,
  type CourierDto,
  type CustomerDto,
  normalizePhone,
  onlyDigits,
} from '@app/shared';
import { ConflictError, NotFoundError } from '../../core/errors/domain-error.js';
import { type Db, InjectDb } from '../../core/tenancy/db.provider.js';
import { Prisma } from '../../generated/prisma/client.js';

const customerInclude = {
  addresses: { orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }] },
  orders: { select: { createdAt: true }, orderBy: { createdAt: 'desc' }, take: 1 },
  _count: { select: { orders: true } },
} satisfies Prisma.CustomerInclude;
type CustomerRow = Prisma.CustomerGetPayload<{ include: typeof customerInclude }>;

const toDto = (c: CustomerRow): CustomerDto => ({
  id: c.id,
  name: c.name,
  phone: c.phone,
  document: c.document,
  email: c.email,
  notes: c.notes,
  addresses: c.addresses.map((a) => ({
    id: a.id,
    label: a.label,
    isDefault: a.isDefault,
    cep: a.cep,
    street: a.street,
    number: a.number,
    complement: a.complement ?? '',
    neighborhood: a.neighborhood,
    city: a.city,
    state: a.state,
    reference: a.reference ?? '',
    latitude: a.latitude,
    longitude: a.longitude,
  })),
  orderCount: c._count.orders,
  lastOrderAt: c.orders[0]?.createdAt.toISOString() ?? null,
});

@Injectable()
export class CustomersService {
  constructor(@InjectDb() private readonly db: Db) {}

  /** Quick search by phone (digits, partial) or name. */
  async search(q: string): Promise<CustomerDto[]> {
    const digits = onlyDigits(q);
    const customers = await this.db.customer.findMany({
      where:
        digits.length >= 4
          ? { phone: { contains: normalizePhone(digits) } }
          : { name: { contains: q.trim(), mode: 'insensitive' } },
      include: customerInclude,
      orderBy: { updatedAt: 'desc' },
      take: 10,
    });
    return customers.map(toDto);
  }

  async get(id: string): Promise<CustomerDto> {
    const customer = await this.db.customer.findFirst({ where: { id }, include: customerInclude });
    if (!customer) throw new NotFoundError('Cliente');
    return toDto(customer);
  }

  async create(input: {
    name: string;
    phone: string;
    document?: string | null;
    email?: string | null;
    notes?: string | null;
  }) {
    try {
      const created = await this.db.customer.create({
        data: {
          name: input.name,
          phone: input.phone,
          document: input.document ?? null,
          email: input.email ?? null,
          notes: input.notes ?? null,
        },
      });
      return this.get(created.id);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictError('Já existe um cliente com esse telefone');
      }
      throw error;
    }
  }

  async addAddress(
    customerId: string,
    input: Address & { label?: string | null; isDefault?: boolean },
  ) {
    await this.get(customerId);
    await this.db.$transaction(async (tx) => {
      if (input.isDefault) {
        await tx.customerAddress.updateMany({ where: { customerId }, data: { isDefault: false } });
      }
      await tx.customerAddress.create({
        data: {
          customerId,
          label: input.label ?? null,
          cep: input.cep,
          street: input.street,
          number: input.number,
          complement: input.complement || null,
          neighborhood: input.neighborhood,
          city: input.city,
          state: input.state,
          reference: input.reference || null,
          latitude: input.latitude ?? null,
          longitude: input.longitude ?? null,
          isDefault: input.isDefault ?? false,
        },
      });
    });
    return this.get(customerId);
  }

  async listCouriers(): Promise<CourierDto[]> {
    return this.db.courier.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true, phone: true, isActive: true },
    });
  }

  async createCourier(input: {
    name: string;
    phone?: string;
    isActive?: boolean;
  }): Promise<CourierDto> {
    return this.db.courier.create({
      data: { name: input.name, phone: input.phone ?? null, isActive: input.isActive ?? true },
      select: { id: true, name: true, phone: true, isActive: true },
    });
  }
}
