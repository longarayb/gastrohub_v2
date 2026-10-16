/**
 * Demo delivery data (D029–D031): areas by neighborhood (with name variations, one paused) and
 * by radius, couriers (one signed in to the courier app), a settled morning route, a route back
 * at the store waiting for the settlement (a cash delivery with change and a failed one), a
 * route on the road now, the simulated courier walking its fixed loop on the dispatch map
 * (D048) and neighborhoods no area covers. Areas, pay and settlement come from
 * the same pure functions the API uses.
 */
import {
  type Address,
  type DeliveryAreaRule,
  courierEarnings,
  effectivePayRule,
  resolveDeliveryArea,
  settlementSummary,
  straightGeometry,
  straightLineMatrix,
} from '@app/shared';
import type { PrismaClient } from '../generated/prisma/client.js';
import {
  DEMO_SIMULATED_LEGS,
  DEMO_SIMULATED_ROUTE,
  DEMO_SIMULATED_ROUTE_METERS,
  DEMO_SIMULATED_ROUTE_SECONDS,
} from './simulated-route.js';

/**
 * Where the demo addresses are: public places and businesses, with the points of OpenStreetMap
 * (looked up once, never at seed time). The Biblioteca Mário de Andrade is left out on purpose:
 * that order shows up in "Marcar no mapa". Parque Trianon has no house number in the map
 * (approximate point: "confira o pino").
 */
const DEMO_POINTS: Record<string, { latitude: number; longitude: number; house: boolean }> = {
  'Avenida Paulista|1578': { latitude: -23.5614961, longitude: -46.6559677, house: true },
  'Avenida Paulista|2073': { latitude: -23.5590407, longitude: -46.6602355, house: true },
  'Rua Frei Caneca|569': { latitude: -23.55418, longitude: -46.6524036, house: true },
  'Rua Jaceguai|520': { latitude: -23.5551932, longitude: -46.6412477, house: true },
  'Rua Peixoto Gomide|949': { latitude: -23.5627983, longitude: -46.6578347, house: false },
  'Avenida Paulista|2424': { latitude: -23.5560722, longitude: -46.6619346, house: true },
};
const pointOf = (a: { street?: string | null; number?: string | null } | null) =>
  a ? (DEMO_POINTS[`${a.street}|${a.number}`] ?? null) : null;

const minutesAgo = (now: Date, minutes: number) => new Date(now.getTime() - minutes * 60_000);

export async function seedDelivery(
  prisma: PrismaClient,
  tenantId: string,
  users: { courierUserId: string; managerId: string; cashierId: string },
): Promise<{ areas: number; runs: number }> {
  const now = new Date();
  const store = await prisma.store.update({
    where: { id: tenantId },
    // Store pay rule: per delivery + a daily paid in the first settlement of the day.
    data: { courierPerDeliveryCents: 400, courierFeeShareBps: 0, courierDailyCents: 3000 },
  });

  // ---- Areas ----
  const areaData = [
    {
      name: 'Centro expandido',
      kind: 'NEIGHBORHOOD' as const,
      neighborhoods: ['Bela Vista', 'Bixiga', 'Consolação', 'Consolacao'],
      city: 'São Paulo',
      feeCents: 600,
      etaMinutes: 35,
      minimumOrderCents: 3000,
      freeAboveCents: 15_000,
    },
    {
      name: 'Jardins',
      kind: 'NEIGHBORHOOD' as const,
      neighborhoods: ['Jardim Paulista', 'Jardins', 'Cerqueira César'],
      city: 'São Paulo',
      feeCents: 700,
      etaMinutes: 40,
    },
    {
      name: 'Pinheiros',
      kind: 'NEIGHBORHOOD' as const,
      neighborhoods: ['Pinheiros', 'Alto de Pinheiros'],
      city: 'São Paulo',
      feeCents: 900,
      etaMinutes: 50,
      pausedReason: 'Chuva forte',
    },
    {
      name: 'Até 5 km',
      kind: 'RADIUS' as const,
      neighborhoods: [],
      radiusMeters: 5000,
      feeCents: 1200,
      etaMinutes: 55,
    },
  ];
  const areas: DeliveryAreaRule[] = [];
  for (const [i, a] of areaData.entries()) {
    areas.push(await prisma.deliveryArea.create({ data: { tenantId, ...a, sortOrder: i } }));
  }

  // ---- Couriers: Gustavo uses the app (entregador@demo.local); Helena has her own pay ----
  const gustavo = await prisma.courier.findFirstOrThrow({
    where: { tenantId, name: 'Gustavo Motoboy' },
  });
  await prisma.courier.update({
    where: { id: gustavo.id },
    data: { userId: users.courierUserId },
  });
  const helena = await prisma.courier.update({
    where: {
      id: (await prisma.courier.findFirstOrThrow({ where: { tenantId, name: 'Helena Bike' } })).id,
    },
    data: { perDeliveryCents: 500, dailyCents: 0 },
  });

  // ---- Saved addresses with their point (the dispatch map starts right) ----
  for (const address of await prisma.customerAddress.findMany({ where: { tenantId } })) {
    const point = pointOf(address);
    if (!point) continue;
    await prisma.customerAddress.update({
      where: { id: address.id },
      data: {
        latitude: point.latitude,
        longitude: point.longitude,
        geoSource: 'GEOCODER',
        geoPrecision: point.house ? 'HOUSE' : 'STREET',
      },
    });
  }

  // ---- Delivery data of every delivery order (area resolved from the address) ----
  const orders = await prisma.order.findMany({
    where: { tenantId, type: 'DELIVERY' },
    orderBy: { createdAt: 'asc' },
  });
  const storePoint =
    store.latitude != null && store.longitude != null
      ? { latitude: store.latitude, longitude: store.longitude }
      : null;
  for (const o of orders) {
    const address = o.deliveryAddress as Address | null;
    const resolved =
      address && ['POS', 'DIGITAL_MENU', 'WAITER_APP'].includes(o.source)
        ? resolveDeliveryArea(address, areas, { store: storePoint, now })
        : null;
    const area = resolved?.ok ? resolved.area : null;
    const point = pointOf(address);
    await prisma.orderDelivery.create({
      data: {
        tenantId,
        orderId: o.id,
        latitude: point?.latitude ?? null,
        longitude: point?.longitude ?? null,
        geoSource: point ? 'GEOCODER' : null,
        geoPrecision: point ? (point.house ? 'HOUSE' : 'STREET') : null,
        // Already tried: without a point, the order waits in "Marcar no mapa".
        geocodedAt: address ? now : null,
        areaId: area?.id ?? null,
        areaName: area?.name ?? null,
        areaSource: area ? 'AUTO' : 'NONE',
        etaMinutes: area?.etaMinutes ?? null,
        suggestedFeeCents: area ? o.deliveryFeeCents : null,
      },
    });
  }
  const find = (customerName: string, status: string) => {
    const o = orders.find((x) => x.customerName === customerName && x.status === status);
    if (!o) throw new Error(`Pedido de delivery do seed não encontrado: ${customerName} ${status}`);
    return o;
  };
  const stopFor = async (
    runId: string,
    orderId: string,
    sequence: number,
    data: Record<string, unknown>,
  ) => {
    await prisma.deliveryStop.create({
      data: { tenantId, runId, orderId, sequence, ...data } as never,
    });
    await prisma.orderDelivery.update({
      where: { orderId },
      data: { attempts: { increment: 1 } },
    });
  };

  // ---- Morning route of Gustavo, already settled (pay accumulated in his balance) ----
  const paid = find('Rafael Lima', 'DELIVERED');
  const morning = await prisma.cashSession.findFirstOrThrow({
    where: { tenantId, status: 'CLOSED' },
  });
  const runA = await prisma.deliveryRun.create({
    data: {
      tenantId,
      courierId: gustavo.id,
      businessDate: paid.businessDate,
      status: 'SETTLED',
      departedAt: paid.dispatchedAt ?? minutesAgo(now, 140),
      returnedAt: minutesAgo(now, 115),
      createdById: users.cashierId,
    },
  });
  await stopFor(runA.id, paid.id, 1, {
    dispatchedAt: paid.dispatchedAt ?? minutesAgo(now, 140),
    deliveredAt: paid.deliveredAt ?? minutesAgo(now, 120),
    collectedMethod: 'CREDIT_CARD',
    collectedCents: paid.totalCents,
  });
  const rule = effectivePayRule(
    {
      perDeliveryCents: store.courierPerDeliveryCents,
      feeShareBps: store.courierFeeShareBps,
      dailyCents: store.courierDailyCents,
    },
    gustavo,
  );
  const earnings = courierEarnings(rule, {
    deliveries: 1,
    deliveryFeesCents: paid.deliveryFeeCents,
    includeDaily: true,
  });
  // Paid by card at the counter before: nothing to collect, only the pay.
  const summary = settlementSummary({
    stops: [],
    countedCashCents: 0,
    countedCardCents: 0,
    earningsCents: earnings.totalCents,
    previousBalanceCents: 0,
    payoutCents: 0,
    deductShortage: false,
  });
  const settlement = await prisma.courierSettlement.create({
    data: {
      tenantId,
      courierId: gustavo.id,
      cashSessionId: morning.id,
      businessDate: paid.businessDate,
      settledById: users.managerId,
      settledAt: minutesAgo(now, 110),
      deliveries: 1,
      failedDeliveries: 0,
      deliveryFeesCents: paid.deliveryFeeCents,
      expectedCashCents: summary.expectedCashCents,
      countedCashCents: 0,
      cashDifferenceCents: 0,
      expectedCardCents: 0,
      countedCardCents: 0,
      cardDifferenceCents: 0,
      otherCents: 0,
      perDeliveryCents: earnings.perDeliveryCents,
      feeShareCents: earnings.feeShareCents,
      dailyCents: earnings.dailyCents,
      earningsCents: earnings.totalCents,
      previousBalanceCents: 0,
      payoutCents: 0,
      shortageDeductedCents: 0,
      newBalanceCents: summary.newBalanceCents,
      courierOwesCents: 0,
      notes: 'Pagamento acumulado para o fim da semana',
    },
  });
  await prisma.deliveryRun.update({
    where: { id: runA.id },
    data: { settlementId: settlement.id },
  });
  await prisma.courierLedgerEntry.create({
    data: {
      tenantId,
      courierId: gustavo.id,
      type: 'EARNING',
      amountCents: earnings.totalCents,
      settlementId: settlement.id,
      reason: 'Acerto · 1 entrega(s) + diária',
      createdById: users.managerId,
      createdAt: minutesAgo(now, 110),
    },
  });

  // ---- Helena's route: back at the store, waiting for the settlement ----
  const receivable = find('Mariana Souza', 'DELIVERED');
  const failed = find('Carla Mendes', 'READY');
  const departed = receivable.dispatchedAt ?? minutesAgo(now, 60);
  const runB = await prisma.deliveryRun.create({
    data: {
      tenantId,
      courierId: helena.id,
      businessDate: receivable.businessDate,
      status: 'RETURNED',
      departedAt: departed,
      returnedAt: minutesAgo(now, 15),
      createdById: users.cashierId,
    },
  });
  await prisma.order.update({ where: { id: receivable.id }, data: { courierId: helena.id } });
  // Paid in cash at the door, with change for a 50 or 100 note.
  const received = Math.ceil(receivable.totalCents / 5000) * 5000;
  await stopFor(runB.id, receivable.id, 1, {
    dispatchedAt: departed,
    deliveredAt: receivable.deliveredAt ?? minutesAgo(now, 40),
    collectedMethod: 'CASH',
    collectedCents: receivable.totalCents,
    receivedCents: received,
    changeCents: received - receivable.totalCents,
  });
  // Customer absent: the order came back to the store and waits to go again.
  const failedAt = minutesAgo(now, 25);
  await stopFor(runB.id, failed.id, 2, {
    dispatchedAt: minutesAgo(now, 45),
    failedAt,
    failureReason: 'CUSTOMER_ABSENT',
    failureNote: 'Ninguém atendeu no interfone',
  });
  await prisma.order.update({
    where: { id: failed.id },
    data: { version: { increment: 2 } },
  });
  await prisma.orderStatusHistory.createMany({
    data: [
      {
        tenantId,
        orderId: failed.id,
        fromStatus: 'READY',
        toStatus: 'DISPATCHED',
        userId: users.cashierId,
        reason: `Saída · ${helena.name}`,
        createdAt: minutesAgo(now, 45),
      },
      {
        tenantId,
        orderId: failed.id,
        fromStatus: 'DISPATCHED',
        toStatus: 'READY',
        userId: users.cashierId,
        reason: 'Entrega não realizada: Cliente ausente (Ninguém atendeu no interfone)',
        createdAt: failedAt,
      },
    ],
  });
  await prisma.auditLog.create({
    data: {
      tenantId,
      userId: users.cashierId,
      action: 'delivery.failed',
      entity: 'Order',
      entityId: failed.id,
      reason: 'Ninguém atendeu no interfone',
      after: { number: failed.number, reason: 'CUSTOMER_ABSENT' },
      createdAt: failedAt,
    },
  });

  // ---- Gustavo on the road now (his phone shows this route) ----
  const onRoad = find('Juliana Alves', 'DISPATCHED');
  const runC = await prisma.deliveryRun.create({
    data: {
      tenantId,
      courierId: gustavo.id,
      openCourierId: gustavo.id,
      businessDate: onRoad.businessDate,
      status: 'OUT',
      departedAt: onRoad.dispatchedAt ?? minutesAgo(now, 15),
      createdById: users.cashierId,
    },
  });
  await stopFor(runC.id, onRoad.id, 1, { dispatchedAt: runC.departedAt });
  const julianaPoint = pointOf(onRoad.deliveryAddress as Address | null);
  if (storePoint && julianaPoint) {
    // Straight-line estimate, as the API without a routing service (D048).
    const { distances, durations } = straightLineMatrix([storePoint, julianaPoint]);
    const meters = distances[0]![1]!;
    const seconds = durations[0]![1]!;
    await prisma.deliveryRun.update({
      where: { id: runC.id },
      data: {
        routeGeometry: straightGeometry([storePoint, julianaPoint]),
        routeSource: 'STRAIGHT',
        routeDistanceMeters: meters,
        routeDurationSeconds: seconds,
      },
    });
    await prisma.deliveryStop.updateMany({
      where: { runId: runC.id },
      data: {
        legDistanceMeters: meters,
        legDurationSeconds: seconds,
        etaAt: new Date(runC.departedAt.getTime() + seconds * 1000),
      },
    });
  }

  // ---- The simulated courier on its loop (positions come from the API, never from here) ----
  const simulated = await prisma.courier.findFirstOrThrow({ where: { tenantId, simulated: true } });
  const loopOrders = [find('Rafael Lima', 'DISPATCHED'), find('Otávio Nunes', 'DISPATCHED')];
  const runD = await prisma.deliveryRun.create({
    data: {
      tenantId,
      courierId: simulated.id,
      openCourierId: simulated.id,
      businessDate: loopOrders[0]!.businessDate,
      status: 'OUT',
      departedAt: loopOrders[0]!.dispatchedAt ?? minutesAgo(now, 5),
      createdById: users.cashierId,
      routeGeometry: DEMO_SIMULATED_ROUTE,
      routeDistanceMeters: DEMO_SIMULATED_ROUTE_METERS,
      routeDurationSeconds: DEMO_SIMULATED_ROUTE_SECONDS,
      routeSource: 'OSRM',
    },
  });
  let clock = runD.departedAt.getTime();
  for (const [i, order] of loopOrders.entries()) {
    const leg = DEMO_SIMULATED_LEGS[i]!;
    clock += leg.durationSeconds * 1000 + (i > 0 ? 180_000 : 0);
    await stopFor(runD.id, order.id, i + 1, {
      dispatchedAt: runD.departedAt,
      legDistanceMeters: leg.distanceMeters,
      legDurationSeconds: leg.durationSeconds,
      etaAt: new Date(clock),
    });
  }

  // ---- Neighborhoods of recent customers no area covers ("Bairros sem área") ----
  // Public places (squares and stations), never a home address.
  for (const [name, phone, neighborhood, street, cep, complement] of [
    [
      'Bruno Costa',
      '11900000031',
      'Vila Madalena',
      'Praça Benedito Calixto',
      '05406040',
      'Feira da praça',
    ],
    [
      'Lívia Prado',
      '11900000032',
      'Vila Madalena',
      'Rua Heitor Penteado',
      '01257010',
      'Estação Vila Madalena',
    ],
    [
      'Thiago Rocha',
      '11900000033',
      'Liberdade',
      'Avenida da Liberdade',
      '01503000',
      'Estação Japão-Liberdade',
    ],
  ] as const) {
    await prisma.customer.create({
      data: {
        tenantId,
        name,
        phone,
        addresses: {
          create: {
            tenantId,
            label: 'Trabalho',
            isDefault: true,
            cep,
            street,
            number: 's/n',
            complement,
            neighborhood,
            city: 'São Paulo',
            state: 'SP',
          },
        },
      },
    });
  }

  return { areas: areas.length, runs: 4 };
}
