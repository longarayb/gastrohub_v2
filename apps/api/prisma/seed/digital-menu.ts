/**
 * Demo digital menu data (D032–D034): the restaurant's own color and description, a blocked
 * phone, an order refused with a reason for the customer, a PIX the customer reported as paid
 * (on the courier's route) and searches from neighborhoods without a delivery area.
 */
import type { PrismaClient } from '../../src/generated/prisma/client.js';

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000);

export async function seedDigitalMenu(
  prisma: PrismaClient,
  tenantId: string,
  users: { managerId: string },
): Promise<{ menuOrders: number }> {
  await prisma.store.update({
    where: { id: tenantId },
    data: {
      brandColor: '#C2410C',
      menuDescription: 'Pizzas, lanches e açaí · entrega no centro e nos Jardins',
    },
  });

  await prisma.blockedPhone.create({
    data: {
      tenantId,
      phone: '11900000000',
      reason: 'Pedidos de trote repetidos',
      createdById: users.managerId,
    },
  });

  // The canceled order came from the menu and was refused: the customer saw the reason.
  const canceled = await prisma.order.findFirst({ where: { tenantId, status: 'CANCELED' } });
  if (canceled) {
    await prisma.order.update({
      where: { id: canceled.id },
      data: {
        source: 'DIGITAL_MENU',
        customerRejectReason: 'TOO_BUSY',
        createdById: null,
      },
    });
  }

  // On the courier's route: paid by PIX, "Já paguei" pressed by the customer (to be checked).
  const onRoad = await prisma.order.findFirst({
    where: { tenantId, status: 'DISPATCHED', expectedPaymentMethod: 'PIX' },
  });
  if (onRoad) {
    await prisma.order.update({
      where: { id: onRoad.id },
      data: { source: 'DIGITAL_MENU', pixReportedAt: minutesAgo(10), createdById: null },
    });
  }

  for (const [neighborhood, minutes] of [
    ['Moema', 30],
    ['Moema', 90],
    ['Liberdade', 50],
  ] as const) {
    await prisma.deliveryQuoteMiss.create({
      data: {
        tenantId,
        neighborhood,
        city: 'São Paulo',
        reason: 'OUT_OF_AREA',
        createdAt: minutesAgo(minutes),
      },
    });
  }

  return {
    menuOrders: await prisma.order.count({ where: { tenantId, source: 'DIGITAL_MENU' } }),
  };
}
