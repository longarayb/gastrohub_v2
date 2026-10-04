import { describe, expect, it } from 'vitest';
import {
  canTransition,
  canTransitionItem,
  initialOrderStatus,
  isSentItem,
  nextStatuses,
  primaryNextStatus,
  salesChannelFor,
  transitionError,
} from './order-status.js';

describe('order transitions', () => {
  it('follows the delivery flow step by step', () => {
    const flow = ['PENDING', 'ACCEPTED', 'PREPARING', 'READY', 'DISPATCHED', 'DELIVERED'] as const;
    for (let i = 0; i < flow.length - 1; i++) {
      expect(canTransition('DELIVERY', flow[i]!, flow[i + 1]!)).toBe(true);
    }
    expect(canTransition('DELIVERY', 'ACCEPTED', 'READY')).toBe(false);
    expect(canTransition('DELIVERY', 'READY', 'DELIVERED')).toBe(false);
  });

  it('takeout has no dispatch step', () => {
    expect(canTransition('TAKEOUT', 'READY', 'DELIVERED')).toBe(true);
    expect(canTransition('TAKEOUT', 'READY', 'DISPATCHED')).toBe(false);
    expect(transitionError('TAKEOUT', 'READY', 'DISPATCHED')).toBe(
      'Somente pedidos de delivery saem para entrega',
    );
  });

  it('dine-in tabs can go back to preparing with a new round and close from ready', () => {
    expect(nextStatuses('DINE_IN', 'READY')).toEqual(['PREPARING', 'DELIVERED']);
    expect(primaryNextStatus('DINE_IN', 'READY')).toBe('DELIVERED');
    expect(primaryNextStatus('DELIVERY', 'READY')).toBe('DISPATCHED');
    expect(primaryNextStatus('TAKEOUT', 'DELIVERED')).toBeNull();
  });

  it('cancels from any non-final status only', () => {
    expect(canTransition('DELIVERY', 'DISPATCHED', 'CANCELED')).toBe(true);
    expect(canTransition('DELIVERY', 'DELIVERED', 'CANCELED')).toBe(false);
    expect(canTransition('DINE_IN', 'CANCELED', 'CANCELED')).toBe(false);
    expect(transitionError('DELIVERY', 'DELIVERED', 'CANCELED')).toBe(
      'Este pedido já foi finalizado',
    );
  });

  it('explains invalid transitions in pt-BR', () => {
    expect(transitionError('DELIVERY', 'PENDING', 'READY')).toBe(
      'Não é possível mudar de "Pendente" para "Pronto"',
    );
    expect(transitionError('DELIVERY', 'READY', 'READY')).toBe('O pedido já está "Pronto"');
    expect(transitionError('DELIVERY', 'PENDING', 'ACCEPTED')).toBeNull();
  });
});

describe('initial status and channel', () => {
  it('staff orders start accepted; online orders pending unless auto-accepted', () => {
    expect(initialOrderStatus('POS')).toBe('ACCEPTED');
    expect(initialOrderStatus('DIGITAL_MENU')).toBe('PENDING');
    expect(initialOrderStatus('DIGITAL_MENU', true)).toBe('ACCEPTED');
    expect(initialOrderStatus('IFOOD')).toBe('PENDING');
  });

  it('maps type and source to the menu sales channel', () => {
    expect(salesChannelFor('DINE_IN', 'POS')).toBe('DINE_IN');
    expect(salesChannelFor('TAKEOUT', 'POS')).toBe('COUNTER');
    expect(salesChannelFor('DELIVERY', 'POS')).toBe('DELIVERY');
    expect(salesChannelFor('DELIVERY', 'DIGITAL_MENU')).toBe('DIGITAL_MENU');
  });
});

describe('item transitions', () => {
  it('moves through the kitchen and can be canceled until served', () => {
    expect(canTransitionItem('DRAFT', 'QUEUED')).toBe(true);
    expect(canTransitionItem('QUEUED', 'PREPARING')).toBe(true);
    expect(canTransitionItem('PREPARING', 'READY')).toBe(true);
    expect(canTransitionItem('READY', 'SERVED')).toBe(true);
    expect(canTransitionItem('SERVED', 'CANCELED')).toBe(false);
    expect(canTransitionItem('PREPARING', 'CANCELED')).toBe(true);
    expect(canTransitionItem('DRAFT', 'READY')).toBe(false);
  });

  it('only items already sent need permission to cancel', () => {
    expect(isSentItem('DRAFT')).toBe(false);
    expect(isSentItem('QUEUED')).toBe(true);
    expect(isSentItem('CANCELED')).toBe(false);
  });
});
