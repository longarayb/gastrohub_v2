import fs from 'node:fs';
import path from 'node:path';
import { buildRelationMap, injectTenant, scopeArgs } from './tenant-extension.js';
import { TENANT_MODELS } from './tenant-models.js';

// Synthetic data model mirroring the shape Prisma exposes at runtime.
const relations = buildRelationMap({
  models: {
    User: { fields: [{ name: 'memberships', kind: 'object', type: 'Membership' }] },
    Membership: { fields: [{ name: 'user', kind: 'object', type: 'User' }] },
    AuditLog: { fields: [] },
    BusinessHours: { fields: [] },
  },
});

describe('scopeArgs', () => {
  it('adds tenantId to where clauses', () => {
    expect(
      scopeArgs(relations, 'AuditLog', 'findMany', { where: { entity: 'Order' } }, 't1'),
    ).toEqual({
      where: { entity: 'Order', tenantId: 't1' },
    });
    expect(scopeArgs(relations, 'AuditLog', 'count', undefined, 't1')).toEqual({
      where: { tenantId: 't1' },
    });
    expect(scopeArgs(relations, 'Membership', 'findUnique', { where: { id: 'm1' } }, 't1')).toEqual(
      {
        where: { id: 'm1', tenantId: 't1' },
      },
    );
  });

  it('overrides a tenantId filter coming from the caller', () => {
    const args = scopeArgs(
      relations,
      'AuditLog',
      'findMany',
      { where: { tenantId: 'other' } },
      't1',
    );
    expect(args.where).toEqual({ tenantId: 't1' });
  });

  it('injects tenantId on create and createMany', () => {
    expect(scopeArgs(relations, 'AuditLog', 'create', { data: { action: 'x' } }, 't1')).toEqual({
      data: { action: 'x', tenantId: 't1' },
    });
    const many = scopeArgs(
      relations,
      'BusinessHours',
      'createMany',
      { data: [{ weekday: 1 }, { weekday: 2 }] },
      't1',
    );
    expect(many.data).toEqual([
      { weekday: 1, tenantId: 't1' },
      { weekday: 2, tenantId: 't1' },
    ]);
  });

  it('blocks cross-tenant writes and tenant changes', () => {
    expect(() =>
      scopeArgs(relations, 'AuditLog', 'create', { data: { tenantId: 'other' } }, 't1'),
    ).toThrow(/Cross-tenant/);
    expect(() =>
      scopeArgs(
        relations,
        'AuditLog',
        'update',
        { where: { id: '1' }, data: { tenantId: 'x' } },
        't1',
      ),
    ).toThrow(/cannot be changed/);
  });

  it('scopes upsert where, create and update', () => {
    const args = scopeArgs(
      relations,
      'BusinessHours',
      'upsert',
      { where: { id: '1' }, create: { weekday: 1 }, update: { weekday: 2 } },
      't1',
    );
    expect(args).toEqual({
      where: { id: '1', tenantId: 't1' },
      create: { weekday: 1, tenantId: 't1' },
      update: { weekday: 2 },
    });
  });
});

describe('injectTenant (nested writes)', () => {
  it('injects into nested creates of tenant models under non-tenant models', () => {
    const data = injectTenant(
      relations,
      'User',
      { name: 'Ana', memberships: { create: [{ role: 'OWNER' }] } },
      't1',
      true,
    );
    expect(data).toEqual({
      name: 'Ana',
      memberships: { create: [{ role: 'OWNER', tenantId: 't1' }] },
    });
  });

  it('injects into nested createMany and connectOrCreate', () => {
    const data = injectTenant(
      relations,
      'User',
      {
        memberships: {
          createMany: { data: [{ role: 'CASHIER' }] },
          connectOrCreate: { where: { id: 'm' }, create: { role: 'WAITER' } },
        },
      },
      't1',
      false,
    );
    expect(data.memberships).toEqual({
      createMany: { data: [{ role: 'CASHIER', tenantId: 't1' }] },
      connectOrCreate: { where: { id: 'm' }, create: { role: 'WAITER', tenantId: 't1' } },
    });
  });
});

describe('TENANT_MODELS registry', () => {
  it('lists every model that has a tenantId column', () => {
    const schema = fs.readFileSync(
      path.join(import.meta.dirname, '..', '..', '..', 'prisma', 'schema.prisma'),
      'utf8',
    );
    const modelsWithTenant = [...schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)]
      .filter(([, , body]) => /^\s+tenantId\s+String/m.test(body ?? ''))
      .map(([, name]) => name);

    expect(modelsWithTenant.length).toBeGreaterThan(0);
    for (const model of modelsWithTenant) {
      expect(TENANT_MODELS.has(model as string), `${model} missing from TENANT_MODELS`).toBe(true);
    }
  });
});
