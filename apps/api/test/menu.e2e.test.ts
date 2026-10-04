import { endOfBusinessDay } from '@app/shared';
import sharp from 'sharp';
import {
  bearer,
  createTestApp,
  registerStore,
  resetDatabase,
  type RegisteredStore,
  type TestContext,
} from './utils.js';

describe('Menu (e2e)', () => {
  let ctx: TestContext;
  let store: RegisteredStore;
  let other: RegisteredStore;
  let auth: { Authorization: string };

  const api = () => ctx.http();
  const post = (url: string, body?: object) =>
    api()
      .post(url)
      .set(auth)
      .send(body ?? {});
  const patch = (url: string, body: object) => api().patch(url).set(auth).send(body);
  const get = (url: string) => api().get(url).set(auth);

  // Shared fixtures created along the suite
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    store = await registerStore(ctx, { tradeName: 'Cantina Teste' });
    other = await registerStore(ctx, { tradeName: 'Outra Loja' });
    auth = bearer(store.accessToken);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it('creates production sectors; the first one is the default', async () => {
    const kitchen = await post('/api/menu/sectors', { name: 'Cozinha' }).expect(201);
    const bar = await post('/api/menu/sectors', { name: 'Bar' }).expect(201);
    const pizza = await post('/api/menu/sectors', { name: 'Pizzaria' }).expect(201);
    expect(kitchen.body.isDefault).toBe(true);
    expect(bar.body.isDefault).toBe(false);
    ids.kitchen = kitchen.body.id;
    ids.bar = bar.body.id;
    ids.pizzaSector = pizza.body.id;

    await patch(`/api/menu/sectors/${ids.bar}`, { name: 'Bar', isDefault: true }).expect(200);
    const list = await get('/api/menu/sectors').expect(200);
    expect(list.body.filter((s: { isDefault: boolean }) => s.isDefault)).toHaveLength(1);
  });

  it('creates reusable modifier groups', async () => {
    const ponto = await post('/api/menu/modifier-groups', {
      name: 'Ponto da carne',
      options: [{ name: 'Mal passado' }, { name: 'Ao ponto' }, { name: 'Bem passado' }],
    }).expect(201);
    const adicionais = await post('/api/menu/modifier-groups', {
      name: 'Adicionais',
      options: [
        { name: 'Bacon', priceCents: 500, maxQuantity: 2 },
        { name: 'Ovo', priceCents: 300 },
      ],
    }).expect(201);
    const molhos = await post('/api/menu/modifier-groups', {
      name: 'Molhos',
      options: [{ name: 'Maionese verde' }, { name: 'Barbecue', priceCents: 200 }],
    }).expect(201);
    ids.ponto = ponto.body.id;
    ids.adicionais = adicionais.body.id;
    ids.molhos = molhos.body.id;
    ids.bacon = adicionais.body.options[0].id;
    expect(adicionais.body.options.map((o: { name: string }) => o.name)).toEqual(['Bacon', 'Ovo']);
  });

  it('creates categories with inherited groups, channels and schedules', async () => {
    const lanches = await post('/api/menu/categories', {
      name: 'Lanches',
      modifierLinks: [
        { groupId: ids.adicionais, minSelect: 0, maxSelect: 4 },
        { groupId: ids.molhos, minSelect: 0, maxSelect: 2 },
      ],
    }).expect(201);
    const bebidas = await post('/api/menu/categories', { name: 'Bebidas' }).expect(201);
    const almoco = await post('/api/menu/categories', {
      name: 'Almoço executivo',
      channels: ['DINE_IN', 'COUNTER'],
      schedules: [{ weekday: 1, opensAt: '11:00', closesAt: '15:00' }],
    }).expect(201);
    ids.lanches = lanches.body.id;
    ids.bebidas = bebidas.body.id;
    ids.almoco = almoco.body.id;
    expect(lanches.body.modifierLinks.map((l: { groupName: string }) => l.groupName)).toEqual([
      'Adicionais',
      'Molhos',
    ]);
    expect(almoco.body.channels).toEqual(['DINE_IN', 'COUNTER']);

    const invalid = await post('/api/menu/categories', {
      name: 'X',
      modifierLinks: [{ groupId: ids.adicionais, minSelect: 3, maxSelect: 1 }],
    }).expect(400);
    expect(invalid.body.message).toBe('O mínimo não pode ser maior que o máximo');
  });

  it('reorders categories', async () => {
    const res = await post('/api/menu/categories/reorder', {
      ids: [ids.bebidas, ids.lanches, ids.almoco],
    }).expect(200);
    expect(res.body.map((c: { name: string }) => c.name)).toEqual([
      'Bebidas',
      'Lanches',
      'Almoço executivo',
    ]);
    await post('/api/menu/categories/reorder', { ids: [ids.bebidas] }).expect(400);
  });

  it('creates a standard product that overrides and disables inherited groups', async () => {
    const res = await post('/api/menu/products', {
      categoryId: ids.lanches,
      name: 'X-Burguer Pão Brioche',
      description: 'Hambúrguer artesanal 160 g',
      priceCents: 3290,
      promoPriceCents: 2990,
      sku: '101',
      sectorId: ids.kitchen,
      modifierLinks: [
        { groupId: ids.ponto, minSelect: 1, maxSelect: 1 },
        { groupId: ids.adicionais, minSelect: 0, maxSelect: 2 },
        { groupId: ids.molhos, isDisabled: true },
      ],
    }).expect(201);
    ids.burger = res.body.id;
    expect(res.body).toMatchObject({
      sku: '101',
      sectorName: 'Cozinha',
      price: { fromCents: 2990, toCents: 2990, hasPromo: true },
    });

    const dup = await post('/api/menu/products', {
      categoryId: ids.lanches,
      name: 'Outro',
      priceCents: 100,
      sku: '101',
    }).expect(409);
    expect(dup.body.message).toBe('Este código interno já está em uso por outro produto');

    await post('/api/menu/products', {
      categoryId: ids.lanches,
      name: 'Sem preço',
    }).expect(400);
    const promo = await post('/api/menu/products', {
      categoryId: ids.lanches,
      name: 'Promo errada',
      priceCents: 1000,
      promoPriceCents: 1500,
    }).expect(400);
    expect(promo.body.message).toBe('O preço promocional deve ser menor que o preço normal');
  });

  it('creates a sized drink and a combo that references it', async () => {
    const cola = await post('/api/menu/products', {
      categoryId: ids.bebidas,
      kind: 'SIZED',
      name: 'Refrigerante Cola',
      sectorId: ids.bar,
      sizes: [
        { name: 'Lata 350 ml', priceCents: 700 },
        { name: '600 ml', priceCents: 900 },
        { name: '2 L', priceCents: 1600, promoPriceCents: 1400 },
      ],
    }).expect(201);
    ids.cola = cola.body.id;
    ids.cola2l = cola.body.sizes[2].id;
    expect(cola.body.price).toEqual({ fromCents: 700, toCents: 1400, hasPromo: true });

    const lata = await post('/api/menu/products', {
      categoryId: ids.bebidas,
      name: 'Guaraná lata',
      priceCents: 700,
      sectorId: ids.bar,
    }).expect(201);
    ids.guarana = lata.body.id;

    const sizedCombo = await post('/api/menu/modifier-groups', {
      name: 'Escolha a bebida',
      options: [{ productId: ids.cola }],
    }).expect(400);
    expect(sizedCombo.body.message).toMatch(/preço único/);

    const drinks = await post('/api/menu/modifier-groups', {
      name: 'Escolha a bebida',
      options: [{ productId: ids.guarana, priceCents: 0 }],
    }).expect(201);
    ids.drinkGroup = drinks.body.id;
    expect(drinks.body.options[0]).toMatchObject({
      displayName: 'Guaraná lata',
      productId: ids.guarana,
    });
  });

  it('builds pizzas: category sizes, flavor prices per size and crust priced by size', async () => {
    const pizzas = await post('/api/menu/categories', { name: 'Pizzas', kind: 'PIZZA' }).expect(
      201,
    );
    ids.pizzas = pizzas.body.id;

    // Flavors need the category sizes first.
    await post('/api/menu/products', {
      categoryId: ids.pizzas,
      name: 'Calabresa',
      flavorPrices: [],
    }).expect(400);

    const sized = await api()
      .put(`/api/menu/categories/${ids.pizzas}/sizes`)
      .set(auth)
      .send({
        sizes: [
          { name: 'Broto', maxFlavors: 1, slices: 4 },
          { name: 'Grande', maxFlavors: 3, slices: 8 },
        ],
      })
      .expect(200);
    ids.broto = sized.body.sizes[0].id;
    ids.grande = sized.body.sizes[1].id;

    const crust = await post('/api/menu/modifier-groups', {
      name: 'Borda',
      options: [
        {
          name: 'Catupiry',
          priceCents: 800,
          sizePrices: [{ sizeId: ids.grande, priceCents: 1200 }],
        },
      ],
    }).expect(201);
    await patch(`/api/menu/categories/${ids.pizzas}`, {
      name: 'Pizzas',
      kind: 'PIZZA',
      modifierLinks: [{ groupId: crust.body.id, minSelect: 0, maxSelect: 1 }],
    }).expect(200);

    const missingSize = await post('/api/menu/products', {
      categoryId: ids.pizzas,
      name: 'Calabresa',
      flavorPrices: [{ sizeId: ids.broto, priceCents: 3500 }],
    }).expect(400);
    expect(missingSize.body.message).toBe('Informe o preço do sabor em todos os tamanhos');

    const flavorLink = await post('/api/menu/products', {
      categoryId: ids.pizzas,
      name: 'Calabresa',
      flavorPrices: [
        { sizeId: ids.broto, priceCents: 3500 },
        { sizeId: ids.grande, priceCents: 6500 },
      ],
      modifierLinks: [{ groupId: ids.adicionais }],
    }).expect(400);
    expect(flavorLink.body.message).toMatch(/vinculados à categoria/);

    const calabresa = await post('/api/menu/products', {
      categoryId: ids.pizzas,
      name: 'Calabresa',
      sectorId: ids.pizzaSector,
      flavorPrices: [
        { sizeId: ids.broto, priceCents: 3500 },
        { sizeId: ids.grande, priceCents: 6500 },
      ],
    }).expect(201);
    ids.calabresa = calabresa.body.id;
    expect(calabresa.body.flavorPrices.map((f: { sizeName: string }) => f.sizeName)).toEqual([
      'Broto',
      'Grande',
    ]);

    await api()
      .patch(`/api/menu/categories/${ids.pizzas}`)
      .set(auth)
      .send({ name: 'Pizzas', kind: 'STANDARD' })
      .expect(400);
  });

  it('builds the catalog with effective groups, pizza groups and option prices by size', async () => {
    const res = await get('/api/menu/catalog?channel=DELIVERY').expect(200);
    const categories = res.body.categories as {
      name: string;
      kind: string;
      modifierGroups: { name: string; options: { sizePrices: unknown[] }[] }[];
      products: {
        id: string;
        modifierGroups: { name: string; minSelect: number; maxSelect: number }[];
        sizes: { name: string; priceCents: number }[];
        availability: { available: boolean };
      }[];
    }[];
    const lanches = categories.find((c) => c.name === 'Lanches')!;
    const burger = lanches.products.find((p) => p.id === ids.burger)!;
    expect(burger.modifierGroups.map((g) => [g.name, g.minSelect, g.maxSelect])).toEqual([
      ['Ponto da carne', 1, 1],
      ['Adicionais', 0, 2],
    ]);

    const pizzas = categories.find((c) => c.kind === 'PIZZA')!;
    expect(pizzas.modifierGroups[0]?.name).toBe('Borda');
    expect(pizzas.modifierGroups[0]?.options[0]?.sizePrices).toEqual([
      { sizeId: ids.grande, priceCents: 1200 },
    ]);
    expect(pizzas.products[0]?.sizes.map((s) => [s.name, s.priceCents])).toEqual([
      ['Broto', 3500],
      ['Grande', 6500],
    ]);

    // Channel restriction: the lunch category is not sold on delivery.
    const almoco = categories.find((c) => c.name === 'Almoço executivo')!;
    expect(almoco.products).toEqual([]);
    expect(res.body.pizzaPricingRule).toBe('HIGHEST');
  });

  it('"Acabou" pauses until the end of the business day and expires on its own', async () => {
    const res = await post(`/api/menu/products/${ids.burger}/pause`, { mode: 'END_OF_DAY' }).expect(
      200,
    );
    const hours = await ctx.prisma.businessHours.findMany({ where: { tenantId: store.storeId } });
    const expected = endOfBusinessDay(hours, new Date());
    expect(res.body.isPaused).toBe(true);
    expect(res.body.pausedUntil).toBe(expected.toISOString());

    const catalog = await get('/api/menu/catalog?channel=DINE_IN').expect(200);
    const burger = catalog.body.categories
      .flatMap((c: { products: { id: string }[] }) => c.products)
      .find((p: { id: string }) => p.id === ids.burger);
    expect(burger.availability.available).toBe(false);
    expect(burger.availability.reasons[0].code).toBe('PRODUCT_PAUSED');

    // Simulate the pause expiring: it no longer blocks the sale.
    await ctx.prisma.product.update({
      where: { id: ids.burger },
      data: { pausedUntil: new Date(Date.now() - 60_000) },
    });
    const later = await get('/api/menu/products?status=paused').expect(200);
    expect(later.body.map((p: { id: string }) => p.id)).not.toContain(ids.burger);

    const indefinite = await post(`/api/menu/products/${ids.burger}/pause`, {
      mode: 'INDEFINITE',
    }).expect(200);
    expect(indefinite.body.pausedUntil).toBeNull();
    await post(`/api/menu/products/${ids.burger}/resume`).expect(200);

    // Single size and single option pauses
    const size = await post(`/api/menu/products/${ids.cola}/sizes/${ids.cola2l}/pause`, {}).expect(
      200,
    );
    expect(size.body.sizes[2].isPaused).toBe(true);
    const option = await post(`/api/menu/modifier-options/${ids.bacon}/pause`, {}).expect(200);
    expect(option.body.options[0].isPaused).toBe(true);
    await post(`/api/menu/modifier-options/${ids.bacon}/resume`).expect(200);
  });

  it('records price changes in the audit trail', async () => {
    const before = await get(`/api/menu/products/${ids.burger}`).expect(200);
    const body = {
      categoryId: ids.lanches,
      name: before.body.name,
      description: before.body.description,
      priceCents: 3490,
      promoPriceCents: null,
      sku: '101',
      sectorId: ids.kitchen,
      modifierLinks: before.body.modifierLinks.map(
        (l: { groupId: string; minSelect: number; maxSelect: number; isDisabled: boolean }) => ({
          groupId: l.groupId,
          minSelect: l.minSelect,
          maxSelect: l.maxSelect,
          isDisabled: l.isDisabled,
        }),
      ),
    };
    await patch(`/api/menu/products/${ids.burger}`, body).expect(200);
    // Same prices again: no new audit entry.
    await patch(`/api/menu/products/${ids.burger}`, { ...body, description: 'Novo texto' }).expect(
      200,
    );

    const audit = await ctx.prisma.auditLog.findMany({
      where: { tenantId: store.storeId, action: 'product.price_changed' },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      entityId: ids.burger,
      before: { priceCents: 3290, promoPriceCents: 2990 },
      after: { priceCents: 3490, promoPriceCents: null },
    });

    // Option price change also audited
    const group = await get(`/api/menu/modifier-groups/${ids.adicionais}`).expect(200);
    await patch(`/api/menu/modifier-groups/${ids.adicionais}`, {
      name: 'Adicionais',
      options: group.body.options.map((o: { id: string; name: string; priceCents: number }) => ({
        id: o.id,
        name: o.name,
        priceCents: o.name === 'Bacon' ? 600 : o.priceCents,
      })),
    }).expect(200);
    const optionAudit = await ctx.prisma.auditLog.findFirst({
      where: { tenantId: store.storeId, entity: 'ModifierGroup' },
    });
    expect(optionAudit?.after).toMatchObject({ options: [{ name: 'Bacon', priceCents: 600 }] });
  });

  it('lets the cashier pause items but not edit the menu', async () => {
    await post('/api/users', {
      name: 'Caixa',
      email: 'caixa.menu@teste.com',
      role: 'CASHIER',
      password: 'Senha1234',
    }).expect(201);
    const login = await api()
      .post('/api/auth/login')
      .send({ email: 'caixa.menu@teste.com', password: 'Senha1234' })
      .expect(200);
    const cashier = bearer(login.body.accessToken);
    await api().post(`/api/menu/products/${ids.guarana}/pause`).set(cashier).send({}).expect(200);
    await api().post(`/api/menu/products/${ids.guarana}/resume`).set(cashier).expect(200);
    await api()
      .patch(`/api/menu/products/${ids.guarana}`)
      .set(cashier)
      .send({ categoryId: ids.bebidas, name: 'Hack', priceCents: 1 })
      .expect(403);
    await api().get('/api/menu/catalog').set(cashier).expect(200);
  });

  it('searches without accents and filters by status and channel', async () => {
    const byName = await get('/api/menu/products?q=pao brioche').expect(200);
    expect(byName.body.map((p: { id: string }) => p.id)).toEqual([ids.burger]);
    const bySku = await get('/api/menu/products?q=101').expect(200);
    expect(bySku.body).toHaveLength(1);
    const byCategory = await get(`/api/menu/products?categoryId=${ids.bebidas}`).expect(200);
    expect(byCategory.body).toHaveLength(2);
  });

  it('duplicates a product (paused, without internal code, with links)', async () => {
    const copy = await post(`/api/menu/products/${ids.burger}/duplicate`).expect(201);
    expect(copy.body).toMatchObject({
      name: 'X-Burguer Pão Brioche (cópia)',
      sku: null,
      isPaused: true,
      pausedUntil: null,
    });
    expect(copy.body.modifierLinks).toHaveLength(3);
    ids.copy = copy.body.id;

    const list = await get(`/api/menu/products?categoryId=${ids.lanches}`).expect(200);
    expect(list.body.map((p: { name: string }) => p.name)).toEqual([
      'X-Burguer Pão Brioche',
      'X-Burguer Pão Brioche (cópia)',
    ]);
  });

  it('uploads a photo converted to WebP with a thumbnail', async () => {
    const png = await sharp({
      create: { width: 1600, height: 1200, channels: 3, background: '#c2410c' },
    })
      .png()
      .toBuffer();
    const res = await api()
      .post(`/api/menu/products/${ids.burger}/image`)
      .set(auth)
      .attach('file', png, { filename: 'foto.png', contentType: 'image/png' })
      .expect(201);
    expect(res.body.imageUrl).toMatch(/\.webp$/);
    expect(res.body.thumbUrl).toMatch(/-thumb\.webp$/);

    const path = new URL(res.body.imageUrl).pathname;
    const file = await api().get(path).expect(200);
    expect(file.headers['content-type']).toBe('image/webp');
    const meta = await sharp(file.body as Buffer).metadata();
    expect(meta.width).toBe(800);
    expect(meta.height).toBe(600);

    const bad = await api()
      .post(`/api/menu/products/${ids.burger}/image`)
      .set(auth)
      .attach('file', Buffer.from('not an image'), { filename: 'x.png', contentType: 'image/png' })
      .expect(400);
    expect(bad.body.message).toBe('Não foi possível ler a imagem. Envie outro arquivo.');
  });

  it('soft-deletes products and releases the internal code', async () => {
    await api().delete(`/api/menu/products/${ids.copy}`).set(auth).expect(204);
    await get(`/api/menu/products/${ids.copy}`).expect(404);
    const deleted = await ctx.prisma.product.findUnique({ where: { id: ids.copy } });
    expect(deleted?.deletedAt).not.toBeNull();

    await api().delete(`/api/menu/categories/${ids.lanches}`).set(auth).expect(409);
  });

  it('isolates the menu between units', async () => {
    const otherAuth = bearer(other.accessToken);
    await api().get(`/api/menu/products/${ids.burger}`).set(otherAuth).expect(404);
    const list = await api().get('/api/menu/products').set(otherAuth).expect(200);
    expect(list.body).toEqual([]);
    // The same internal code can exist in another unit.
    const cat = await api()
      .post('/api/menu/categories')
      .set(otherAuth)
      .send({ name: 'Lanches' })
      .expect(201);
    await api()
      .post('/api/menu/products')
      .set(otherAuth)
      .send({ categoryId: cat.body.id, name: 'X', priceCents: 100, sku: '101' })
      .expect(201);
    // And cannot reference groups from another unit.
    await api()
      .post('/api/menu/products')
      .set(otherAuth)
      .send({
        categoryId: cat.body.id,
        name: 'Y',
        priceCents: 100,
        modifierLinks: [{ groupId: ids.adicionais }],
      })
      .expect(400);
  });
});
