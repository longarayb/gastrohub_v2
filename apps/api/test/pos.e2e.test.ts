import { crc16 } from '@app/shared';
import {
  bearer,
  createTestApp,
  registerStore,
  resetDatabase,
  type RegisteredStore,
  type TestContext,
} from './utils.js';

type Headers = { Authorization: string };
type Order = { id: string; version: number; [key: string]: unknown };

/** Cash register, payments, refunds, PIX, bill split and table operations (D023–D025). */
describe('POS: cash register, payments and tables (e2e)', () => {
  let ctx: TestContext;
  let store: RegisteredStore;
  let owner: Headers;
  let cashier: Headers;
  let waiter: Headers;
  const ids: Record<string, string> = {};
  const tables: Record<string, string> = {};

  const post = (h: Headers, url: string, body: object = {}) =>
    ctx.http().post(url).set(h).send(body);
  const patch = (h: Headers, url: string, body: object = {}) =>
    ctx.http().patch(url).set(h).send(body);
  const get = (h: Headers, url: string) => ctx.http().get(url).set(h);

  async function login(email: string): Promise<Headers> {
    const res = await ctx
      .http()
      .post('/api/auth/login')
      .send({ email, password: 'Senha1234' })
      .expect(200);
    return bearer(res.body.accessToken);
  }

  const item = (productId: string, quantity = 1) => ({ productId, quantity });

  async function order(body: object): Promise<Order> {
    return (await post(owner, '/api/orders', body).expect(201)).body;
  }
  const takeout = (quantity = 1) => order({ type: 'TAKEOUT', items: [item(ids.dish!, quantity)] });
  const tab = (table: string, items: object[], tabLabel?: string) =>
    order({ type: 'DINE_IN', tableId: tables[table], items, tabLabel });

  async function pay(h: Headers, o: Order, body: object, status = 201) {
    return post(h, `/api/orders/${o.id}/payments`, { expectedVersion: o.version, ...body }).expect(
      status,
    );
  }

  async function advance(o: Order, statuses: string[]): Promise<Order> {
    let current = o;
    for (const status of statuses) {
      current = (
        await post(owner, `/api/orders/${o.id}/status`, {
          expectedVersion: current.version,
          status,
        }).expect(200)
      ).body;
    }
    return current;
  }

  const tableList = async () =>
    (await get(owner, '/api/tables').expect(200)).body as {
      id: string;
      name: string;
      session: {
        id: string;
        billRequestedAt: string | null;
        tabs: { orderId: string }[];
      } | null;
    }[];
  const tableOf = async (name: string) => (await tableList()).find((t) => t.name === name)!;

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    store = await registerStore(ctx, { tradeName: 'Caixa Teste' });
    owner = bearer(store.accessToken);
    for (const [email, role] of [
      ['caixa.pdv@teste.com', 'CASHIER'],
      ['garcom.pdv@teste.com', 'WAITER'],
    ] as const) {
      await post(owner, '/api/users', { name: role, email, role, password: 'Senha1234' }).expect(
        201,
      );
    }
    cashier = await login('caixa.pdv@teste.com');
    waiter = await login('garcom.pdv@teste.com');

    const category = await post(owner, '/api/menu/categories', { name: 'Pratos' }).expect(201);
    for (const [key, name, priceCents] of [
      ['dish', 'Prato do dia', 2000],
      ['juice', 'Suco', 800],
    ] as const) {
      ids[key] = (
        await post(owner, '/api/menu/products', {
          categoryId: category.body.id,
          name,
          priceCents,
        }).expect(201)
      ).body.id;
    }
    for (const name of ['A', 'B', 'C', 'D', 'E', 'F']) {
      const list = (await post(owner, '/api/tables', { name }).expect(201)).body as {
        id: string;
        name: string;
      }[];
      tables[name] = list.find((t) => t.name === name)!.id;
    }
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it('cash register: one per operator, blind totals, supply and withdrawal', async () => {
    const opened = await post(cashier, '/api/cash-sessions', { openingCents: 10_000 }).expect(201);
    ids.cashierSession = opened.body.id;
    // Blind close (default): the operator does not see what the system expects.
    expect(opened.body).toMatchObject({ status: 'OPEN', openingCents: 10_000, totals: null });

    const again = await post(cashier, '/api/cash-sessions', { openingCents: 0 }).expect(409);
    expect(again.body.message).toBe('Você já tem um caixa aberto');
    await post(waiter, '/api/cash-sessions', { openingCents: 0 }).expect(403);

    await post(cashier, '/api/cash-sessions/current/movements', {
      type: 'SUPPLY',
      amountCents: 5_000,
      reason: 'Troco extra',
    }).expect(201);
    const tooMuch = await post(cashier, '/api/cash-sessions/current/movements', {
      type: 'WITHDRAWAL',
      amountCents: 20_000,
      reason: 'Depósito',
    }).expect(400);
    expect(tooMuch.body.message).toBe('Sangria maior que o dinheiro no caixa (R$ 150,00)');
    await post(cashier, '/api/cash-sessions/current/movements', {
      type: 'WITHDRAWAL',
      amountCents: 3_000,
      reason: 'Depósito no cofre',
    }).expect(201);
    await post(cashier, '/api/cash-sessions/current/movements', {
      type: 'WITHDRAWAL',
      amountCents: 1_000,
      reason: '',
    }).expect(400);

    const current = await get(cashier, '/api/cash-sessions/current').expect(200);
    expect(current.body.blindClose).toBe(true);
    expect(current.body.session.totals).toBeNull();
    expect(current.body.session.movements).toHaveLength(2);

    // Managers (cash:manage) see the live totals.
    const managed = await get(owner, `/api/cash-sessions/${ids.cashierSession}`).expect(200);
    expect(managed.body.totals.expectedCashCents).toBe(12_000);
    // Operators cannot see someone else's register.
    expect((await get(owner, '/api/cash-sessions/current').expect(200)).body.session).toBeNull();
  });

  it('payments: change only in cash, partial payments, card details, limits', async () => {
    const o = await takeout(2); // 40,00
    await pay(waiter, o, { method: 'PIX', amountCents: 1_000 }, 403);
    const noRegister = await pay(owner, o, { method: 'CASH', amountCents: 1_000 }, 400);
    expect(noRegister.body.message).toBe('Abra o caixa para receber pagamentos');

    const partial = (
      await pay(cashier, o, { method: 'CASH', amountCents: 1_500, receivedCents: 2_000 })
    ).body;
    expect(partial).toMatchObject({
      paidCents: 1_500,
      balanceCents: 2_500,
      paymentStatus: 'PARTIAL',
    });
    expect(partial.payments[0]).toMatchObject({
      method: 'CASH',
      amountCents: 1_500,
      receivedCents: 2_000,
      changeCents: 500,
      cashSessionId: ids.cashierSession,
      status: 'CONFIRMED',
    });

    const above = await pay(cashier, partial, { method: 'PIX', amountCents: 3_000 }, 400);
    expect(above.body.message).toBe('Valor acima do saldo da conta (R$ 25,00)');
    await pay(cashier, partial, { method: 'PIX', amountCents: 1_000, cardBrand: 'VISA' }, 400);
    await pay(cashier, o, { method: 'PIX', amountCents: 1_000 }, 409); // stale version

    const paid = (
      await pay(cashier, partial, {
        method: 'CREDIT_CARD',
        amountCents: 2_500,
        cardBrand: 'VISA',
        authorizationCode: 'NSU123456',
      })
    ).body;
    expect(paid).toMatchObject({ paidCents: 4_000, balanceCents: 0, paymentStatus: 'PAID' });
    expect(paid.payments[1]).toMatchObject({ cardBrand: 'VISA', authorizationCode: 'NSU123456' });
    const again = await pay(cashier, paid, { method: 'PIX', amountCents: 100 }, 400);
    expect(again.body.message).toBe('Esta conta já está paga');

    await advance(paid, ['PREPARING', 'READY', 'DELIVERED']);
  });

  it('takeout and dine-in close only with a zero balance', async () => {
    const o = await advance(await takeout(), ['PREPARING', 'READY']);
    const res = await post(owner, `/api/orders/${o.id}/status`, {
      expectedVersion: o.version,
      status: 'DELIVERED',
    }).expect(400);
    expect(res.body.message).toBe('Falta receber R$ 20,00 para fechar a conta');
  });

  it('online/marketplace payments settle the order without a register', async () => {
    const o = await takeout();
    const paid = (
      await pay(owner, o, { method: 'ONLINE', amountCents: 2_000, externalRef: 'IFOOD-998877' })
    ).body;
    expect(paid.paymentStatus).toBe('PAID');
    expect(paid.payments[0]).toMatchObject({
      method: 'ONLINE',
      cashSessionId: null,
      externalRef: 'IFOOD-998877',
    });
    const register = await get(owner, `/api/cash-sessions/${ids.cashierSession}`).expect(200);
    expect(register.body.totals.methods.map((m: { method: string }) => m.method)).not.toContain(
      'ONLINE',
    );
  });

  it('refunds: permission, reason, register of whoever refunds; totals and cancel guards', async () => {
    let o = await tab('A', [item(ids.dish!)]); // 20,00 + 10% = 22,00
    expect(o.totalCents).toBe(2_200);
    o = (await pay(cashier, o, { method: 'CASH', amountCents: 2_200 })).body;
    const payment = (o.payments as { id: string }[])[0]!;

    const cancel = await post(owner, `/api/orders/${o.id}/status`, {
      expectedVersion: o.version,
      status: 'CANCELED',
      reason: 'Cliente desistiu',
    }).expect(400);
    expect(cancel.body.message).toBe('Estorne os pagamentos antes de cancelar o pedido');
    const itemId = (o.items as { id: string }[])[0]!.id;
    const below = await post(owner, `/api/orders/${o.id}/items/${itemId}/cancel`, {
      expectedVersion: o.version,
      reason: 'Errado',
    }).expect(400);
    expect(below.body.message).toBe(
      'O total ficaria abaixo do valor já pago (R$ 22,00). Estorne um pagamento antes.',
    );

    const refundUrl = `/api/orders/${o.id}/payments/${payment.id}/refund`;
    await post(cashier, refundUrl, { expectedVersion: o.version, reason: 'Cobrado errado' }).expect(
      403,
    );
    const noRegister = await post(owner, refundUrl, {
      expectedVersion: o.version,
      reason: 'Cobrado errado',
    }).expect(400);
    expect(noRegister.body.message).toBe('Abra o seu caixa para fazer o estorno');

    const ownerRegister = await post(owner, '/api/cash-sessions', { openingCents: 0 }).expect(201);
    ids.ownerSession = ownerRegister.body.id;
    const noCash = await post(owner, refundUrl, {
      expectedVersion: o.version,
      reason: 'Cobrado errado',
    }).expect(400);
    expect(noCash.body.message).toBe(
      'Não há dinheiro suficiente neste caixa para o estorno (R$ 0,00)',
    );
    await post(owner, '/api/cash-sessions/current/movements', {
      type: 'SUPPLY',
      amountCents: 5_000,
      reason: 'Fundo de troco',
    }).expect(201);
    await post(owner, refundUrl, { expectedVersion: o.version, reason: 'x' }).expect(400);

    o = (
      await post(owner, refundUrl, { expectedVersion: o.version, reason: 'Cobrado errado' }).expect(
        200,
      )
    ).body;
    expect(o).toMatchObject({ paidCents: 0, balanceCents: 2_200, paymentStatus: 'UNPAID' });
    expect((o.payments as object[])[0]).toMatchObject({
      status: 'REFUNDED',
      refundReason: 'Cobrado errado',
    });
    const row = await ctx.prisma.payment.findUnique({ where: { id: payment.id } });
    expect(row).toMatchObject({
      cashSessionId: ids.cashierSession,
      refundSessionId: ids.ownerSession,
    });
    const audit = await ctx.prisma.auditLog.findFirst({
      where: { tenantId: store.storeId, action: 'payment.refunded', entityId: o.id },
    });
    expect(audit?.reason).toBe('Cobrado errado');
    const twice = await post(owner, refundUrl, {
      expectedVersion: o.version,
      reason: 'Cobrado errado',
    }).expect(400);
    expect(twice.body.message).toBe('Este pagamento já foi estornado');

    // Without payments the tab can be canceled (frees table A).
    await post(owner, `/api/orders/${o.id}/status`, {
      expectedVersion: o.version,
      status: 'CANCELED',
      reason: 'Cliente desistiu',
    }).expect(200);
  });

  it('closing: blind count with difference, conflict, a closed register never changes, reopen', async () => {
    // A PIX received now and refunded after the closing.
    let open = await tab('F', [item(ids.juice!)]); // 8,00 + 0,80
    open = (await pay(cashier, open, { method: 'PIX', amountCents: 880 })).body;

    const before = (await get(owner, `/api/cash-sessions/${ids.cashierSession}`).expect(200)).body;
    const expected = Object.fromEntries(
      (before.totals.methods as { method: string; expectedCents: number }[]).map((m) => [
        m.method,
        m.expectedCents,
      ]),
    );
    // 100 + 50 − 30 (movements) + 15 (cash net of change); the dine-in cash was refunded by the
    // owner's register, so it still counts here.
    expect(expected.CASH).toBe(10_000 + 5_000 - 3_000 + 1_500 + 2_200);
    expect(expected.CREDIT_CARD).toBe(2_500);
    expect(expected.PIX).toBe(880);

    const counts = [
      { method: 'CASH', countedCents: expected.CASH! - 100 },
      { method: 'CREDIT_CARD', countedCents: 2_500 },
      { method: 'PIX', countedCents: 880 },
    ];
    // A movement after the screen was loaded: the closing must be checked again.
    await post(cashier, '/api/cash-sessions/current/movements', {
      type: 'SUPPLY',
      amountCents: 100,
      reason: 'Moedas',
    }).expect(201);
    await post(cashier, `/api/cash-sessions/${ids.cashierSession}/close`, {
      expectedVersion: before.version,
      counts,
    }).expect(409);

    const latest = (await get(cashier, '/api/cash-sessions/current').expect(200)).body.session;
    const closed = (
      await post(cashier, `/api/cash-sessions/${ids.cashierSession}/close`, {
        expectedVersion: latest.version,
        counts,
        notes: 'Faltou troco',
      }).expect(200)
    ).body;
    expect(closed.status).toBe('CLOSED');
    // Cash expected now includes the 1,00 supply: counted 100 short + 1,00 = 2,00 missing.
    expect(closed.counts).toEqual([
      {
        method: 'CASH',
        expectedCents: expected.CASH! + 100,
        countedCents: expected.CASH! - 100,
        differenceCents: -200,
      },
      { method: 'PIX', expectedCents: 880, countedCents: 880, differenceCents: 0 },
      { method: 'CREDIT_CARD', expectedCents: 2_500, countedCents: 2_500, differenceCents: 0 },
    ]);
    expect(closed.differenceCents).toBe(-200);
    expect(closed.totals).not.toBeNull(); // closed: the difference is shown

    const late = await pay(cashier, await takeout(), { method: 'CASH', amountCents: 100 }, 400);
    expect(late.body.message).toBe('Abra o caixa para receber pagamentos');

    // Refund after the closing leaves the owner's open register; the closed one is unchanged.
    const pixId = (open.payments as { id: string }[])[0]!.id;
    await post(owner, `/api/orders/${open.id}/payments/${pixId}/refund`, {
      expectedVersion: open.version,
      reason: 'PIX não caiu',
    }).expect(200);
    const after = (await get(owner, `/api/cash-sessions/${ids.cashierSession}`).expect(200)).body;
    expect(after.counts).toEqual(closed.counts);
    expect(after.totals).toEqual(closed.totals);
    const ownerRegister = (await get(owner, `/api/cash-sessions/${ids.ownerSession}`).expect(200))
      .body;
    expect(
      ownerRegister.totals.methods.find((m: { method: string }) => m.method === 'PIX'),
    ).toMatchObject({ refundedCents: 880, expectedCents: -880 });

    // Reopening: managers only, with a reason; the previous count goes to the audit.
    await post(cashier, `/api/cash-sessions/${ids.cashierSession}/reopen`, {
      expectedVersion: after.version,
      reason: 'Recontagem',
    }).expect(403);
    await post(owner, `/api/cash-sessions/${ids.cashierSession}/reopen`, {
      expectedVersion: after.version,
      reason: '',
    }).expect(400);
    const reopened = (
      await post(owner, `/api/cash-sessions/${ids.cashierSession}/reopen`, {
        expectedVersion: after.version,
        reason: 'Recontagem do dinheiro',
      }).expect(200)
    ).body;
    expect(reopened).toMatchObject({
      status: 'OPEN',
      counts: [],
      reopenReason: 'Recontagem do dinheiro',
    });
    const audit = await ctx.prisma.auditLog.findFirst({
      where: { tenantId: store.storeId, action: 'cash.reopened', entityId: ids.cashierSession },
    });
    expect((audit?.before as { counts: unknown[] }).counts).toHaveLength(3);
    expect((await get(cashier, '/api/cash-sessions/current').expect(200)).body.session.id).toBe(
      ids.cashierSession,
    );
  });

  it('delivery may be delivered with a balance to receive', async () => {
    let o = await order({
      type: 'DELIVERY',
      customer: { name: 'Rita', phone: '(11) 97777-6666' },
      deliveryAddress: {
        cep: '01310100',
        street: 'Avenida Paulista',
        number: '1000',
        neighborhood: 'Bela Vista',
        city: 'São Paulo',
        state: 'SP',
      },
      deliveryFeeCents: 500,
      items: [item(ids.dish!)],
    });
    o = await advance(o, ['PREPARING', 'READY', 'DISPATCHED', 'DELIVERED']);
    expect(o).toMatchObject({ status: 'DELIVERED', paymentStatus: 'UNPAID', balanceCents: 2_500 });

    const receivable = (await get(cashier, '/api/orders?receivable=true').expect(200)).body;
    expect(receivable.map((r: { id: string }) => r.id)).toEqual([o.id]);

    // The courier settles: the cashier receives on the delivered order.
    await pay(cashier, o, { method: 'CASH', amountCents: 2_500, receivedCents: 3_000 });
    expect((await get(cashier, '/api/orders?receivable=true').expect(200)).body).toEqual([]);
  });

  it('PIX: key validation and a BR Code with the order code as txid', async () => {
    const o = await takeout();
    const noKey = await get(cashier, `/api/orders/${o.id}/pix`).expect(400);
    expect(noKey.body.message).toBe('Cadastre a chave PIX na tela Empresa para gerar o QR Code');

    const pix = {
      pixKeyType: 'EMAIL',
      pixMerchantName: 'Caixa Teste',
      pixMerchantCity: 'São Paulo',
    };
    await patch(cashier, '/api/stores/current/pix', { ...pix, pixKey: 'a@b.com' }).expect(403);
    await patch(owner, '/api/stores/current/pix', { ...pix, pixKey: 'sem-arroba' }).expect(400);
    await patch(owner, '/api/stores/current/pix', {
      ...pix,
      pixKeyType: 'CPF',
      pixKey: '111.111.111-11',
    }).expect(400);
    const saved = await patch(owner, '/api/stores/current/pix', {
      ...pix,
      pixKey: ' Caixa@Restaurante.com ',
    }).expect(200);
    expect(saved.body.pixKey).toBe('caixa@restaurante.com');

    const charge = (await get(cashier, `/api/orders/${o.id}/pix`).expect(200)).body;
    const code = o.publicCode as string;
    expect(code).toMatch(/^[A-Z0-9]{1,25}$/);
    expect(charge).toMatchObject({ amountCents: 2_000, txid: code });
    expect(charge.brCode).toContain('br.gov.bcb.pix0121caixa@restaurante.com');
    expect(charge.brCode).toContain('540520.00');
    expect(charge.brCode).toContain(
      `62${String(code.length + 4).padStart(2, '0')}05${String(code.length).padStart(2, '0')}${code}`,
    );
    expect(crc16(charge.brCode.slice(0, -4))).toBe(charge.brCode.slice(-4));

    const share = (await get(cashier, `/api/orders/${o.id}/pix?amountCents=1000`).expect(200)).body;
    expect(share.amountCents).toBe(1_000);
    await get(cashier, `/api/orders/${o.id}/pix?amountCents=2001`).expect(400);

    // Paying by PIX keeps the txid with the payment.
    const paid = (await pay(cashier, o, { method: 'PIX', amountCents: 2_000 })).body;
    expect(paid.payments[0].externalRef).toBe(code);
  });

  it('moves items (or part of a line) to another tab of the same table', async () => {
    const source = await tab('B', [item(ids.dish!, 3), item(ids.juice!)]);
    expect(source.totalCents).toBe(6_800 + 680);
    const dish = (source.items as { id: string; name: string }[]).find(
      (i) => i.name === 'Prato do dia',
    )!;
    const juice = (source.items as { id: string; name: string }[]).find((i) => i.name === 'Suco')!;

    await post(waiter, `/api/orders/${source.id}/move-items`, {
      expectedVersion: source.version,
      items: [{ itemId: dish.id, quantity: 4 }],
    }).expect(400);

    const moved = (
      await post(waiter, `/api/orders/${source.id}/move-items`, {
        expectedVersion: source.version,
        items: [
          { itemId: dish.id, quantity: 1 },
          { itemId: juice.id, quantity: 1 },
        ],
        newTabLabel: 'Ana',
      }).expect(200)
    ).body;
    // Each tab keeps its own 10% service fee.
    expect(moved.source).toMatchObject({
      subtotalCents: 4_000,
      serviceFeeCents: 400,
      totalCents: 4_400,
    });
    expect(moved.target).toMatchObject({
      tabLabel: 'Ana',
      subtotalCents: 2_800,
      serviceFeeCents: 280,
      totalCents: 3_080,
      tableSessionId: source.tableSessionId,
    });
    expect(moved.source.items.find((i: { id: string }) => i.id === dish.id).quantity).toBe(2);
    expect(moved.target.items.map((i: { status: string }) => i.status)).toEqual([
      'QUEUED',
      'QUEUED',
    ]);
    expect((await tableOf('B')).session!.tabs).toHaveLength(2);

    // Back to an existing tab needs its version; a tab of another table is refused.
    await post(waiter, `/api/orders/${moved.target.id}/move-items`, {
      expectedVersion: moved.target.version,
      items: [{ itemId: moved.target.items[0].id, quantity: 1 }],
      targetOrderId: source.id,
    }).expect(400);
    const elsewhere = await tab('C', [item(ids.juice!)]);
    const otherTable = await post(waiter, `/api/orders/${moved.target.id}/move-items`, {
      expectedVersion: moved.target.version,
      items: [{ itemId: moved.target.items[0].id, quantity: 1 }],
      targetOrderId: elsewhere.id,
      targetExpectedVersion: elsewhere.version,
    }).expect(400);
    expect(otherTable.body.message).toBe('A conta de destino precisa estar na mesma mesa');

    // A paid part cannot leave the tab below what was paid.
    const paid = (await pay(cashier, moved.source, { method: 'PIX', amountCents: 4_000 })).body;
    await post(waiter, `/api/orders/${paid.id}/move-items`, {
      expectedVersion: paid.version,
      items: [{ itemId: dish.id, quantity: 1 }],
      targetOrderId: moved.target.id,
      targetExpectedVersion: moved.target.version,
    }).expect(400);

    const audit = await ctx.prisma.auditLog.findFirst({
      where: { tenantId: store.storeId, action: 'order.items_moved', entityId: source.id },
    });
    expect(audit).not.toBeNull();
  });

  it('transfers a tab, changes, merges and splits tables; pre-bill marks the table', async () => {
    let onD = await tab('D', [item(ids.juice!)]);
    onD = (
      await post(waiter, `/api/orders/${onD.id}/transfer`, {
        expectedVersion: onD.version,
        tableId: tables.E,
      }).expect(200)
    ).body;
    expect((await tableOf('D')).session).toBeNull();
    expect((await tableOf('E')).session!.tabs.map((t) => t.orderId)).toEqual([onD.id]);

    // The party moves from E to D (free); C is occupied.
    const sessionE = (await tableOf('E')).session!.id;
    const busy = await post(waiter, `/api/tables/sessions/${sessionE}/change-table`, {
      fromTableId: tables.E,
      toTableId: tables.C,
    }).expect(400);
    expect(busy.body.message).toBe('A mesa C está ocupada. Para juntar, use Juntar mesas.');
    await post(waiter, `/api/tables/sessions/${sessionE}/change-table`, {
      fromTableId: tables.E,
      toTableId: tables.D,
    }).expect(200);
    expect((await tableOf('E')).session).toBeNull();
    expect((await tableOf('D')).session!.id).toBe(sessionE);

    // Merge C into D: one session with both tables and both tabs.
    const sessionC = (await tableOf('C')).session!;
    await post(waiter, `/api/tables/sessions/${sessionE}/merge`, {
      sourceSessionId: sessionC.id,
    }).expect(200);
    const merged = await tableOf('C');
    expect(merged.session!.id).toBe(sessionE);
    expect(merged.session!.tabs).toHaveLength(2);

    // Split: C leaves again, taking its own tab to a new session; D keeps the other.
    const cTab = sessionC.tabs[0]!.orderId;
    await post(waiter, `/api/tables/sessions/${sessionE}/split`, {
      tableId: tables.C,
      orderIds: [cTab],
    }).expect(200);
    const afterSplit = await tableList();
    const c = afterSplit.find((t) => t.name === 'C')!.session!;
    const d = afterSplit.find((t) => t.name === 'D')!.session!;
    expect(c.id).not.toBe(sessionE);
    expect(c.tabs.map((t) => t.orderId)).toEqual([cTab]);
    expect(d.id).toBe(sessionE);
    expect(d.tabs.map((t) => t.orderId)).toEqual([onD.id]);
    // Only merged tables can be split.
    await post(waiter, `/api/tables/sessions/${sessionE}/split`, {
      tableId: tables.D,
    }).expect(400);

    // Pre-bill: "aguardando pagamento" until a new round is sent.
    await post(waiter, `/api/tables/sessions/${sessionE}/bill-request`).expect(200);
    expect((await tableOf('D')).session!.billRequestedAt).not.toBeNull();
    const current = (await get(waiter, `/api/orders/${onD.id}`).expect(200)).body;
    await post(waiter, `/api/orders/${onD.id}/items`, {
      expectedVersion: current.version,
      items: [item(ids.juice!)],
    }).expect(201);
    expect((await tableOf('D')).session!.billRequestedAt).toBeNull();
  });
});
