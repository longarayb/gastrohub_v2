import { ACCENT_TEST_LINE, type PaperWidth, type PrintDocument, renderText } from '@app/shared';
import {
  bearer,
  createTestApp,
  registerStore,
  resetDatabase,
  type RegisteredStore,
  type TestContext,
} from './utils.js';

type Headers = { Authorization: string };
type Leased = {
  id: string;
  attempt: number;
  kind: string;
  copies: number;
  printer: { id: string; name: string; paperWidth: PaperWidth };
  document: PrintDocument;
};

const text = (job: Leased) => renderText(job.document, job.printer.paperWidth).join('\n');

/** Printing (D035–D037): agents, printers, outbox from the order flows, lease/ack, documents. */
describe('Printing: agents, queue and documents (e2e)', () => {
  let ctx: TestContext;
  let store: RegisteredStore;
  let owner: Headers;
  let cashier: Headers;
  let waiter: Headers;
  let slug: string;
  const ids: Record<string, string> = {};
  const agents: Record<string, { headers: Headers; token: string }> = {};

  const post = (h: Headers | null, url: string, body: object = {}) => {
    const req = ctx.http().post(url);
    return (h ? req.set(h) : req).send(body);
  };
  const put = (h: Headers, url: string, body: object) => ctx.http().put(url).set(h).send(body);
  const get = (h: Headers, url: string) => ctx.http().get(url).set(h);

  async function login(email: string): Promise<Headers> {
    const res = await post(null, '/api/auth/login', { email, password: 'Senha1234' }).expect(200);
    return bearer(res.body.accessToken);
  }

  async function pairAgent(name: string) {
    const created = await post(owner, '/api/printing/agents', { name }).expect(201);
    const paired = await post(null, '/api/print-agent/pair', {
      store: slug,
      code: created.body.code,
      hostname: `HOST-${name}`,
      version: '1.0.0',
    }).expect(200);
    return {
      id: created.body.agent.id as string,
      headers: bearer(paired.body.accessToken),
      token: paired.body.refreshToken as string,
    };
  }

  const lease = async (agent: string): Promise<Leased[]> =>
    (await post(agents[agent]!.headers, '/api/print-agent/lease', {}).expect(200)).body.jobs;
  const ack = (agent: string, job: Leased, body: object = { result: 'PRINTED' }) =>
    post(agents[agent]!.headers, `/api/print-agent/jobs/${job.id}/ack`, {
      attempt: job.attempt,
      ...body,
    }).expect(200);
  /** Leases and prints everything queued for the agent. */
  async function drain(agent: string): Promise<Leased[]> {
    const jobs = await lease(agent);
    for (const job of jobs) await ack(agent, job);
    return jobs;
  }
  const heartbeat = (agent: string, body: object = {}) =>
    post(agents[agent]!.headers, '/api/print-agent/heartbeat', {
      version: '1.0.0',
      hostname: `HOST-${agent}`,
      memoryMb: 48.3,
      windowsPrinters: ['ELGIN i9(USB)', 'Microsoft Print to PDF'],
      ...body,
    });
  const item = (productId: string | undefined, quantity = 1, notes?: string) => ({
    productId,
    quantity,
    notes,
  });
  const job = (id: string) => ctx.prisma.printJob.findUniqueOrThrow({ where: { id } });

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    store = await registerStore(ctx, { tradeName: 'Cantina Impressa' });
    owner = bearer(store.accessToken);
    slug = (await ctx.prisma.store.findUniqueOrThrow({ where: { id: store.storeId } })).slug;
    for (const [email, role] of [
      ['caixa.print@teste.com', 'CASHIER'],
      ['garcom.print@teste.com', 'WAITER'],
    ] as const) {
      await post(owner, '/api/users', { name: role, email, role, password: 'Senha1234' }).expect(
        201,
      );
    }
    cashier = await login('caixa.print@teste.com');
    waiter = await login('garcom.print@teste.com');
    // Open around the clock (the digital menu test below does not depend on the time).
    await put(owner, '/api/stores/current/hours', { hours: [] }).expect(200);

    ids.kitchen = (await post(owner, '/api/menu/sectors', { name: 'Cozinha' }).expect(201)).body.id;
    ids.bar = (await post(owner, '/api/menu/sectors', { name: 'Bar' }).expect(201)).body.id;
    const category = await post(owner, '/api/menu/categories', { name: 'Lanches' }).expect(201);
    const product = async (name: string, priceCents: number, sectorId?: string) =>
      (
        await post(owner, '/api/menu/products', {
          categoryId: category.body.id,
          name,
          priceCents,
          sectorId,
        }).expect(201)
      ).body.id as string;
    ids.burger = await product('X-Burguer', 2500, ids.kitchen);
    ids.fries = await product('Batata', 1500, ids.kitchen);
    ids.beer = await product('Cerveja', 1200, ids.bar);
    ids.table = (await post(owner, '/api/tables', { name: '7' }).expect(201)).body[0].id;
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it('pairs a computer with a single-use code; the agent can only print', async () => {
    await post(waiter, '/api/printing/agents', { name: 'PC' }).expect(403);
    await post(cashier, '/api/printing/agents', { name: 'PC' }).expect(403);
    const created = await post(owner, '/api/printing/agents', { name: 'PC do caixa' }).expect(201);
    expect(created.body.code).toMatch(/^\d{6}$/);
    expect(created.body.agent).toMatchObject({ state: 'PENDING', online: false });

    const wrong = String((Number(created.body.code) + 1) % 1_000_000).padStart(6, '0');
    await post(null, '/api/print-agent/pair', { store: slug, code: wrong }).expect(400);
    await post(null, '/api/print-agent/pair', { store: 'nao-existe', code: wrong }).expect(400);
    const paired = await post(null, '/api/print-agent/pair', {
      store: slug,
      code: created.body.code,
      hostname: 'CAIXA-01',
      version: '1.0.0',
    }).expect(200);
    expect(paired.body).toMatchObject({
      agent: { id: created.body.agent.id, name: 'PC do caixa' },
      store: { slug },
      printers: [],
    });
    expect(paired.body.refreshToken).toHaveLength(64);
    // Single use.
    await post(null, '/api/print-agent/pair', { store: slug, code: created.body.code }).expect(400);
    const failures = await ctx.prisma.auditLog.count({
      where: { tenantId: store.storeId, action: 'printing.pairing_failed' },
    });
    expect(failures).toBe(2);

    agents.cash = { headers: bearer(paired.body.accessToken), token: paired.body.refreshToken };
    ids.cashAgent = created.body.agent.id;
    // A print agent reads nothing else: no orders, no panel status, no KDS.
    await get(agents.cash.headers, '/api/orders').expect(403);
    await get(agents.cash.headers, '/api/printing/status').expect(403);
    await get(agents.cash.headers, '/api/kds/sectors').expect(403);
    await get(agents.cash.headers, '/api/auth/me').expect(403);

    // The stored credential gives new access tokens (same credential, not rotated).
    const renewed = await post(null, '/api/print-agent/session', {
      token: paired.body.refreshToken,
    }).expect(200);
    expect(renewed.body.accessToken).toBeTruthy();
    expect(renewed.body.refreshToken).toBeUndefined();
    await post(null, '/api/print-agent/session', { token: 'x'.repeat(64) }).expect(401);

    const beat = await heartbeat('cash').expect(200);
    expect(beat.body).toMatchObject({ printers: [], pendingJobs: 0 });
    const status = (await get(cashier, '/api/printing/status').expect(200)).body;
    expect(status.agents[0]).toMatchObject({
      state: 'PAIRED',
      online: true,
      hostname: 'HOST-cash',
      version: '1.0.0',
      memoryMb: 48.3,
      windowsPrinters: ['ELGIN i9(USB)', 'Microsoft Print to PDF'],
    });
    expect(status.alerts).toBe(0);
  });

  it('registers printers per computer, sector mapping and the test page', async () => {
    const kitchenAgent = await pairAgent('PC da cozinha');
    agents.kitchen = { headers: kitchenAgent.headers, token: kitchenAgent.token };
    ids.kitchenAgent = kitchenAgent.id;

    const printer = (body: object) => post(owner, '/api/printing/printers', body);
    const bad = await printer({
      name: 'Cozinha',
      agentId: ids.cashAgent,
      connection: 'NETWORK',
      address: '192.168.0.300',
      profileId: 'elgin-i9',
      paperWidth: 80,
    }).expect(400);
    expect(bad.body.details?.[0]?.path ?? bad.body.details).toBeTruthy();
    await printer({
      name: 'X',
      agentId: ids.cashAgent,
      connection: 'VIRTUAL',
      profileId: 'nope',
      paperWidth: 80,
    }).expect(400);

    ids.cashPrinter = (
      await printer({
        name: 'Caixa',
        agentId: ids.cashAgent,
        connection: 'VIRTUAL',
        profileId: 'elgin-i9',
        paperWidth: 80,
      }).expect(201)
    ).body.id;
    ids.kitchenPrinter = (
      await printer({
        name: 'Cozinha',
        agentId: ids.kitchenAgent,
        connection: 'NETWORK',
        address: '192.168.0.50',
        profileId: 'epson-tm-t20',
        paperWidth: 80,
      }).expect(201)
    ).body.id;
    ids.barPrinter = (
      await printer({
        name: 'Bar',
        agentId: ids.cashAgent,
        connection: 'USB',
        address: 'ELGIN i9(USB)',
        profileId: 'elgin-i9',
        paperWidth: 58,
      }).expect(201)
    ).body.id;

    await put(cashier, '/api/printing/sectors', { sectors: [] }).expect(403);
    const sectors = await put(owner, '/api/printing/sectors', {
      sectors: [
        { sectorId: ids.kitchen, printerId: ids.kitchenPrinter, copies: 2 },
        { sectorId: ids.bar, printerId: ids.barPrinter, copies: 1 },
      ],
    }).expect(200);
    expect(sectors.body).toEqual(
      expect.arrayContaining([
        { sectorId: ids.kitchen, name: 'Cozinha', printerId: ids.kitchenPrinter, copies: 2 },
      ]),
    );
    await put(owner, '/api/printing/sectors', {
      sectors: [{ sectorId: ids.bar, printerId: ids.barPrinter, copies: 4 }],
    }).expect(400);
    const settings = await put(owner, '/api/printing/settings', {
      cashPrinterId: ids.cashPrinter,
      deliveryCopyOnAccept: true,
      deliveryCopies: 1,
      cancelSlips: true,
      holdAfterMinutes: 30,
    }).expect(200);
    expect(settings.body.cashPrinterId).toBe(ids.cashPrinter);

    // Each agent only gets its own printers.
    const beat = (await heartbeat('cash').expect(200)).body;
    expect(beat.printers.map((p: { name: string }) => p.name).sort()).toEqual(['Bar', 'Caixa']);

    await post(owner, `/api/printing/printers/${ids.barPrinter}/test`).expect(200);
    const jobs = await lease('cash');
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ kind: 'TEST_PAGE', attempt: 1, printer: { name: 'Bar' } });
    expect(text(jobs[0]!)).toContain(ACCENT_TEST_LINE.slice(0, 20));
    expect(text(jobs[0]!)).toContain('58 mm (32 colunas)');
    await ack('cash', jobs[0]!);
    expect((await job(jobs[0]!.id)).status).toBe('PRINTED');
    expect(await lease('kitchen')).toEqual([]);
  });

  it('prints one ticket per sector when the order is sent, and each new round', async () => {
    const tab = (
      await post(waiter, '/api/orders', {
        type: 'DINE_IN',
        tableId: ids.table,
        tabLabel: 'Ana',
        items: [item(ids.burger, 2, 'sem cebola'), item(ids.beer)],
      }).expect(201)
    ).body;
    ids.tab = tab.id;

    const kitchen = await drain('kitchen');
    expect(kitchen).toHaveLength(1);
    expect(kitchen[0]).toMatchObject({ kind: 'KITCHEN_TICKET', copies: 2 });
    const ticket = text(kitchen[0]!);
    expect(ticket).toContain(`#${tab.number}`);
    expect(ticket).toContain('Mesa 7 · Ana');
    expect(ticket).toContain('2x X-Burguer');
    expect(ticket).toContain('▌SEM CEBOLA▐');
    expect(ticket).not.toContain('Cerveja');
    const bar = await drain('cash');
    expect(bar).toHaveLength(1);
    expect(text(bar[0]!)).toContain('1x Cerveja');
    // Idempotent: nothing more to print.
    expect(await lease('kitchen')).toEqual([]);

    // Draft round: nothing printed until it is sent.
    let current = (
      await post(waiter, `/api/orders/${tab.id}/items`, {
        expectedVersion: tab.version,
        items: [item(ids.fries)],
        send: false,
      }).expect(201)
    ).body;
    expect(await lease('kitchen')).toEqual([]);
    current = (
      await post(waiter, `/api/orders/${tab.id}/send`, { expectedVersion: current.version }).expect(
        200,
      )
    ).body;
    const round2 = await drain('kitchen');
    expect(round2).toHaveLength(1);
    expect(text(round2[0]!)).toMatch(/Rodada 2/);
    expect(text(round2[0]!)).toContain('1x Batata');
    expect(text(round2[0]!)).not.toContain('X-Burguer');
    ids.tabVersion = String(current.version);
  });

  it('a canceled item gets a CANCELADO slip if printed, or is removed from a ticket not printed yet', async () => {
    let tab = (await get(owner, `/api/orders/${ids.tab}`).expect(200)).body;
    const burger = tab.items.find((i: { name: string }) => i.name === 'X-Burguer');
    tab = (
      await post(cashier, `/api/orders/${tab.id}/items/${burger.id}/cancel`, {
        expectedVersion: tab.version,
        reason: 'Cliente desistiu',
      }).expect(200)
    ).body;
    const slips = await drain('kitchen');
    expect(slips).toHaveLength(1);
    expect(slips[0]!.kind).toBe('CANCEL_SLIP');
    expect(text(slips[0]!)).toMatch(/CANCELADO[\s\S]*2x X-Burguer[\s\S]*Motivo: Cliente desistiu/);

    // A new round not printed yet (the agent is offline): canceling rewrites the ticket.
    tab = (
      await post(waiter, `/api/orders/${tab.id}/items`, {
        expectedVersion: tab.version,
        items: [item(ids.burger), item(ids.fries, 3)],
        send: true,
      }).expect(201)
    ).body;
    const fries = tab.items.find(
      (i: { name: string; quantity: number }) => i.name === 'Batata' && i.quantity === 3,
    );
    tab = (
      await post(cashier, `/api/orders/${tab.id}/items/${fries.id}/cancel`, {
        expectedVersion: tab.version,
        reason: 'Acabou',
      }).expect(200)
    ).body;
    let jobs = await lease('kitchen');
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.kind).toBe('KITCHEN_TICKET');
    expect(text(jobs[0]!)).toContain('1x X-Burguer');
    expect(text(jobs[0]!)).not.toContain('3x Batata');
    await ack('kitchen', jobs[0]!);

    // Whole round canceled before printing: the ticket is discarded, no slip.
    tab = (
      await post(waiter, `/api/orders/${tab.id}/items`, {
        expectedVersion: tab.version,
        items: [item(ids.fries)],
        send: true,
      }).expect(201)
    ).body;
    const last = tab.items.at(-1);
    await post(cashier, `/api/orders/${tab.id}/items/${last.id}/cancel`, {
      expectedVersion: tab.version,
      reason: 'Lançado errado',
    }).expect(200);
    jobs = await lease('kitchen');
    expect(jobs).toEqual([]);
    const discarded = await ctx.prisma.printJob.findFirst({
      where: { orderId: tab.id, status: 'DISCARDED' },
    });
    expect(discarded?.lastError).toBe('Cancelado antes de imprimir');
  });

  it('digital orders print on accept; delivery gets the courier copy on the cash printer', async () => {
    const preview = await post(null, `/api/public/${slug}/cart`, {
      type: 'TAKEOUT',
      items: [item(ids.burger)],
    }).expect(200);
    const digital = await post(null, `/api/public/${slug}/orders`, {
      type: 'TAKEOUT',
      items: [item(ids.burger)],
      customer: { name: 'Cliente Cardápio', phone: '(11) 97000-1234' },
      expectedPaymentMethod: 'CASH',
      acceptPrivacy: true,
      expectedTotalCents: preview.body.totalCents,
      formStartedAt: Date.now() - 20_000,
    }).expect(201);
    const pending = (await get(owner, '/api/orders?status=PENDING').expect(200)).body;
    const pendingOrder = (pending.items ?? pending).find(
      (o: { publicCode?: string; status: string }) => o.status === 'PENDING',
    );
    expect(digital.body).toBeTruthy();
    expect(await lease('kitchen')).toEqual([]);
    await post(cashier, `/api/orders/${pendingOrder.id}/status`, {
      expectedVersion: pendingOrder.version,
      status: 'ACCEPTED',
    }).expect(200);
    const tickets = await drain('kitchen');
    expect(tickets).toHaveLength(1);
    expect(text(tickets[0]!)).toContain('Cardápio digital');

    const delivery = (
      await post(cashier, '/api/orders', {
        type: 'DELIVERY',
        customer: { name: 'Maria Entrega', phone: '(11) 98888-7777' },
        deliveryAddress: {
          cep: '01310100',
          street: 'Avenida Paulista',
          number: '1000',
          complement: 'Apto 12',
          neighborhood: 'Bela Vista',
          city: 'São Paulo',
          state: 'SP',
        },
        deliveryFeeCents: 700,
        items: [item(ids.burger), item(ids.beer)],
        expectedPaymentMethod: 'CASH',
        changeForCents: 5000,
      }).expect(201)
    ).body;
    ids.delivery = delivery.id;
    const cashJobs = await drain('cash');
    expect(cashJobs.map((j) => j.kind).sort()).toEqual(['DELIVERY_COPY', 'KITCHEN_TICKET']);
    const copy = text(cashJobs.find((j) => j.kind === 'DELIVERY_COPY')!);
    expect(copy).toContain('VIA DE ENTREGA');
    expect(copy).toContain('Avenida Paulista, 1000 - Apto 12');
    expect(copy).toContain('Maria Entrega');
    expect(copy).toContain('LEVAR R$ 6,00 DE TROCO');
    expect(copy).toContain('Não é documento fiscal');
    expect((await drain('kitchen')).map((j) => j.kind)).toEqual(['KITCHEN_TICKET']);

    // Courier copy turned off.
    await put(owner, '/api/printing/settings', {
      cashPrinterId: ids.cashPrinter,
      deliveryCopyOnAccept: false,
      deliveryCopies: 1,
      cancelSlips: true,
      holdAfterMinutes: 30,
    }).expect(200);
    await post(cashier, '/api/orders', {
      type: 'DELIVERY',
      customer: { name: 'Outra Pessoa', phone: '(11) 98888-6666' },
      deliveryAddress: {
        cep: '01310100',
        street: 'Avenida Paulista',
        number: '900',
        neighborhood: 'Bela Vista',
        city: 'São Paulo',
        state: 'SP',
      },
      deliveryFeeCents: 700,
      items: [item(ids.beer)],
    }).expect(201);
    expect((await drain('cash')).map((j) => j.kind)).toEqual(['KITCHEN_TICKET']);
  });

  it('at-least-once: retries with backoff, expired leases print as possible duplicates', async () => {
    await post(owner, `/api/printing/printers/${ids.cashPrinter}/test`).expect(200);
    const [first] = await lease('cash');
    await ack('cash', first!, { result: 'FAILED', error: 'Sem papel', printerStatus: 'PAPER_OUT' });
    let row = await job(first!.id);
    expect(row).toMatchObject({ status: 'PENDING', attempts: 1, lastError: 'Sem papel' });
    expect(row.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
    let status = (await get(waiter, '/api/printing/status').expect(200)).body;
    expect(status.printers.find((p: { id: string }) => p.id === ids.cashPrinter).status).toBe(
      'PAPER_OUT',
    );
    expect(status.alerts).toBeGreaterThanOrEqual(1);
    // Backoff: not leased again right away.
    expect(await lease('cash')).toEqual([]);

    await ctx.prisma.printJob.update({
      where: { id: first!.id },
      data: { nextAttemptAt: new Date(Date.now() - 1000), failingSince: new Date(0) },
    });
    status = (await get(waiter, '/api/printing/status').expect(200)).body;
    expect(status.failing.map((j: { id: string }) => j.id)).toContain(first!.id);

    const [second] = await lease('cash');
    expect(second!.attempt).toBe(2);
    expect(text(second!)).not.toContain('POSSÍVEL 2ª VIA');
    // No answer and the lease expires: it may have printed.
    await ctx.prisma.printJob.update({
      where: { id: first!.id },
      data: { leaseUntil: new Date(Date.now() - 1000) },
    });
    const [third] = await lease('cash');
    expect(third!.attempt).toBe(3);
    expect(text(third!)).toContain('POSSÍVEL 2ª VIA');
    // The late answer of attempt 2 is ignored; attempt 3 is accepted.
    const late = await ack('cash', second!);
    expect(late.body.accepted).toBe(false);
    const ok = await ack('cash', third!, { result: 'PRINTED', printerStatus: 'OK' });
    expect(ok.body.accepted).toBe(true);
    row = await job(first!.id);
    expect(row).toMatchObject({ status: 'PRINTED', lastError: null, failingSince: null });
  });

  it('late jobs print marked as late; old ones are held for a decision', async () => {
    await post(owner, `/api/printing/printers/${ids.cashPrinter}/test`).expect(200);
    await post(owner, `/api/printing/printers/${ids.cashPrinter}/test`).expect(200);
    await post(owner, `/api/printing/printers/${ids.cashPrinter}/test`).expect(200);
    const queued = await ctx.prisma.printJob.findMany({
      where: { status: 'PENDING', printerId: ids.cashPrinter },
      orderBy: { createdAt: 'asc' },
    });
    expect(queued).toHaveLength(3);
    const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);
    await ctx.prisma.printJob.update({
      where: { id: queued[0]!.id },
      data: { createdAt: minutesAgo(5) },
    });
    for (const q of queued.slice(1)) {
      await ctx.prisma.printJob.update({
        where: { id: q.id },
        data: { createdAt: minutesAgo(45) },
      });
    }
    const jobs = await lease('cash');
    expect(jobs.map((j) => j.id)).toEqual([queued[0]!.id]);
    expect(text(jobs[0]!)).toContain('IMPRESSÃO ATRASADA');
    await ack('cash', jobs[0]!);

    const status = (await get(waiter, '/api/printing/status').expect(200)).body;
    expect(status.held.map((j: { id: string }) => j.id).sort()).toEqual(
      [queued[1]!.id, queued[2]!.id].sort(),
    );
    // Anyone who prints decides: print now (marked as late) or discard (audited).
    await post(waiter, `/api/printing/jobs/${queued[1]!.id}/held`, { action: 'PRINT' }).expect(200);
    await post(waiter, `/api/printing/jobs/${queued[2]!.id}/held`, { action: 'DISCARD' }).expect(
      200,
    );
    await post(waiter, `/api/printing/jobs/${queued[2]!.id}/held`, { action: 'PRINT' }).expect(400);
    const released = await lease('cash');
    expect(released.map((j) => j.id)).toEqual([queued[1]!.id]);
    expect(text(released[0]!)).toContain('IMPRESSÃO ATRASADA');
    await ack('cash', released[0]!);
    const audit = await ctx.prisma.auditLog.count({
      where: { tenantId: store.storeId, action: 'printing.job_discarded', entityId: queued[2]!.id },
    });
    expect(audit).toBe(1);
  });

  it('reprints as 2ª VIA and prints documents on demand', async () => {
    const tickets = await ctx.prisma.printJob.findMany({
      where: { orderId: ids.tab, kind: 'KITCHEN_TICKET', reprintOfId: null, status: 'PRINTED' },
      orderBy: { createdAt: 'asc' },
    });
    const reprint = await post(waiter, `/api/printing/jobs/${tickets[0]!.id}/reprint`, {}).expect(
      200,
    );
    expect(reprint.body).toMatchObject({ reprintOfId: tickets[0]!.id, status: 'PENDING' });
    const [again] = await drain('kitchen');
    expect(again!.id).toBe(reprint.body.id);
    expect(text(again!)).toContain('2ª VIA');

    // Second copy of every ticket of the order, each on its sector printer.
    const all = await post(cashier, `/api/printing/orders/${ids.tab}`, {
      document: 'KITCHEN_TICKETS',
    }).expect(200);
    expect(all.body.queued).toBe(tickets.length);
    const reprinted = [...(await drain('kitchen')), ...(await drain('cash'))];
    expect(reprinted).toHaveLength(tickets.length);
    expect(reprinted.every((j) => text(j).includes('2ª VIA'))).toBe(true);

    await post(cashier, `/api/printing/orders/${ids.delivery}`, {
      document: 'DELIVERY_COPY',
    }).expect(200);
    const [copy] = await drain('cash');
    expect(copy!.kind).toBe('DELIVERY_COPY');
    expect(text(copy!)).toContain('2ª VIA');
    await post(cashier, `/api/printing/orders/${ids.tab}`, { document: 'DELIVERY_COPY' }).expect(
      400,
    );

    const preBill = await post(waiter, '/api/printing/pre-bill', {
      orderIds: [ids.tab],
      people: 2,
    }).expect(200);
    expect(preBill.body.queued).toBe(1);
    const [bill] = await drain('cash');
    expect(bill!.kind).toBe('PRE_BILL');
    expect(text(bill!)).toMatch(/PRÉ-CONTA[\s\S]*Mesa 7[\s\S]*Pessoa 2/);
    await post(waiter, '/api/printing/pre-bill', { orderIds: [ids.delivery] }).expect(400);

    const session = await post(cashier, '/api/cash-sessions', { openingCents: 10_000 }).expect(201);
    await post(waiter, `/api/printing/cash-sessions/${session.body.id}`, {}).expect(403);
    await post(cashier, `/api/printing/cash-sessions/${session.body.id}`, {}).expect(200);
    const [cash] = await drain('cash');
    expect(cash!.kind).toBe('CASH_CLOSE');

    const jobs = (await get(waiter, `/api/printing/jobs?orderId=${ids.tab}`).expect(200)).body;
    expect(jobs.length).toBeGreaterThan(3);
    expect(jobs[0]).toMatchObject({ orderId: ids.tab, orderNumber: expect.any(Number) });
    const preview = (await get(waiter, `/api/printing/jobs/${jobs[0].id}/preview`).expect(200))
      .body;
    expect(preview.document.lines.length).toBeGreaterThan(3);
  });

  it('other stores see nothing; revoked agents and removed printers stop printing', async () => {
    const other = await registerStore(ctx, { tradeName: 'Outra Cantina' });
    const otherOwner = bearer(other.accessToken);
    const status = (await get(otherOwner, '/api/printing/status').expect(200)).body;
    expect(status.agents).toEqual([]);
    expect(status.printers).toEqual([]);
    const someJob = await ctx.prisma.printJob.findFirstOrThrow({
      where: { tenantId: store.storeId },
    });
    await post(otherOwner, `/api/printing/jobs/${someJob.id}/reprint`, {}).expect(404);

    // Removing a printer discards what was waiting for it and frees its sectors.
    await post(owner, `/api/printing/printers/${ids.barPrinter}/test`).expect(200);
    await ctx.http().delete(`/api/printing/printers/${ids.barPrinter}`).set(owner).expect(204);
    expect(
      await ctx.prisma.printJob.count({ where: { printerId: ids.barPrinter, status: 'PENDING' } }),
    ).toBe(0);
    const sector = await ctx.prisma.productionSector.findUniqueOrThrow({ where: { id: ids.bar } });
    expect(sector.printerId).toBeNull();

    await post(owner, `/api/printing/agents/${ids.kitchenAgent}/revoke`).expect(200);
    await heartbeat('kitchen').expect(401);
    await post(null, '/api/print-agent/session', { token: agents.kitchen!.token }).expect(401);
    const after = (await get(owner, '/api/printing/status').expect(200)).body;
    expect(after.agents.find((a: { id: string }) => a.id === ids.kitchenAgent).state).toBe(
      'REVOKED',
    );
  });
});
