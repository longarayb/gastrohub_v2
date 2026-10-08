import { describe, expect, it } from 'vitest';
import { ACCENT_TEST_LINE, printerProfile, renderText } from '../domain/printing.js';
import type { OrderDetailDto } from '../orders/types.js';
import {
  cancelSlipDocument,
  deliveryCopyDocument,
  kitchenTicketDocument,
  testPageDocument,
} from './documents.js';

const text = (lines: string[]) => lines.join('\n');

describe('kitchen ticket', () => {
  it('is big and readable, with removals white on black', () => {
    const doc = kitchenTicketDocument({
      sectorName: 'Cozinha',
      orderNumber: 12,
      orderType: 'DELIVERY',
      title: 'Mariana',
      roundNumber: 1,
      sentAt: '2026-10-08T22:40:00Z',
      tasks: [
        {
          name: 'X-Burguer',
          quantity: 2,
          details: {
            size: null,
            flavors: [],
            modifiers: [{ name: 'Bacon', quantity: 1, removal: false }],
            note: 'sem cebola, bem passado',
            removals: ['sem cebola'],
            comboOf: 'Combo X-Burguer',
          },
        },
      ],
    });
    expect(doc.title).toBe('Comanda · Cozinha · #12');
    const out = text(renderText(doc, 80));
    expect(out).toContain('#12');
    expect(out).toContain('▌DELIVERY · Mariana▐');
    expect(out).toContain('2x X-Burguer');
    expect(out).toContain('do Combo X-Burguer');
    expect(out).toContain('+ Bacon');
    expect(out).toContain('▌SEM CEBOLA▐');
    expect(out).toContain('Obs.: bem passado');
    expect(out).not.toMatch(/Obs\.: sem cebola/);
    expect(out).toContain('19:40'); // São Paulo time
    const big = doc.lines.find((l) => l.kind === 'text' && l.text === '#12');
    expect(big).toMatchObject({ size: 'double' });
  });

  it('cancel slip for the sector', () => {
    const out = text(
      renderText(
        cancelSlipDocument({
          sectorName: 'Bar',
          orderNumber: 7,
          title: 'Mesa 3',
          canceledAt: '2026-10-08T22:40:00Z',
          wholeOrder: true,
          items: [],
          reason: 'Cliente desistiu',
        }),
        58,
      ),
    );
    expect(out).toContain('▌CANCELADO▐');
    expect(out).toContain('PEDIDO INTEIRO CANCELADO');
    expect(out).toContain('Motivo: Cliente desistiu');
  });
});

describe('delivery copy', () => {
  const order = {
    number: 15,
    createdAt: '2026-10-08T22:00:00Z',
    customerName: 'Mariana Souza',
    customerPhone: '11991234567',
    deliveryAddress: {
      cep: '01311000',
      street: 'Avenida Paulista',
      number: '1500',
      complement: 'Apto 82',
      neighborhood: 'Bela Vista',
      city: 'São Paulo',
      state: 'SP',
      reference: 'Portaria 24h',
    },
    delivery: { areaName: 'Centro expandido' },
    items: [
      {
        name: 'Pizza',
        sizeName: 'Grande',
        quantity: 1,
        status: 'QUEUED',
        totalCents: 8190,
        notes: null,
        snapshot: { modifiers: [], flavors: [] },
      },
    ],
    subtotalCents: 8190,
    orderDiscountCents: 0,
    couponDiscountCents: 0,
    couponCode: null,
    serviceFeeCents: 0,
    serviceFeeBps: 0,
    deliveryFeeCents: 600,
    totalCents: 8790,
    paidCents: 0,
    expectedPaymentMethod: 'CASH',
    changeForCents: 10_000,
    pixReportedAt: null,
    notes: 'Interfone quebrado',
  } as unknown as OrderDetailDto;

  it('has the address, what to charge and the change to take', () => {
    const out = text(renderText(deliveryCopyDocument({ storeName: 'Cantina', order }), 80));
    expect(out).toContain('VIA DE ENTREGA');
    expect(out).toContain('Tel.: (11) 99123-4567');
    expect(out).toContain('Avenida Paulista, 1500 - Apto 82');
    expect(out).toContain('Ref.: Portaria 24h');
    expect(out).toMatch(/TOTAL\s+R\$\s87,90/);
    expect(out).toContain('▌LEVAR R$ 12,10 DE TROCO▐');
    expect(out).toContain('Não é documento fiscal');
  });

  it('paid orders say not to charge; reported PIX is flagged', () => {
    const paid = text(
      renderText(
        deliveryCopyDocument({ storeName: 'C', order: { ...order, paidCents: 8790 } }),
        80,
      ),
    );
    expect(paid).toContain('PAGO - NÃO COBRAR');
    const pix = text(
      renderText(
        deliveryCopyDocument({
          storeName: 'C',
          order: { ...order, expectedPaymentMethod: 'PIX', pixReportedAt: '2026-10-08T22:05:00Z' },
        }),
        80,
      ),
    );
    expect(pix).toContain('PIX INFORMADO PELO CLIENTE: CONFERIR');
  });
});

describe('test page', () => {
  it('has the accents line and the printer setup', () => {
    const out = text(
      renderText(
        testPageDocument({
          storeName: 'Cantina',
          printerName: 'Cozinha',
          agentName: 'PC do caixa',
          profile: printerProfile('elgin-i9'),
          width: 58,
          withoutAccents: false,
        }),
        58,
      ),
    );
    expect(out).toContain(ACCENT_TEST_LINE.slice(0, 20));
    expect(out).toContain('58 mm (32 colunas)');
    expect(out).toContain('Elgin');
  });
});
