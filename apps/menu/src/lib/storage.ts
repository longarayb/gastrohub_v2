'use client';

import type { AddressInput, OrderItemData } from '@app/shared';
import { useCallback, useSyncExternalStore } from 'react';

/**
 * Per-device memory of the customer (cart, name/phone/address, recent orders), in the
 * browser only. Every access is guarded: private windows and blocked storage must still work.
 */
function read<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable: the page keeps working for this visit.
  }
  window.dispatchEvent(new StorageEvent('storage', { key }));
}

function subscribe(callback: () => void) {
  window.addEventListener('storage', callback);
  return () => window.removeEventListener('storage', callback);
}

/** A value in localStorage, shared by every component and tab that uses the same key. */
function useStored<T>(key: string, fallback: T): [T, (value: T | null) => void] {
  const raw = useSyncExternalStore(
    subscribe,
    () => {
      try {
        return window.localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    () => null,
  );
  const value = raw ? (read<T>(key, fallback) as T) : fallback;
  const set = useCallback((next: T | null) => write(key, next), [key]);
  return [value, set];
}

// ---- Cart ----

export interface CartLine {
  key: string;
  input: OrderItemData;
  name: string;
  details: string | null;
  unitChargedPriceCents: number;
  totalCents: number;
}

export interface Cart {
  lines: CartLine[];
  type: 'TAKEOUT' | 'DELIVERY';
  couponCode: string;
}

export const EMPTY_CART: Cart = { lines: [], type: 'DELIVERY', couponCode: '' };

export function useCart(slug: string) {
  const [cart, setCart] = useStored<Cart>(`menu:${slug}:cart`, EMPTY_CART);
  return {
    cart,
    setCart: (next: Cart) => setCart(next.lines.length || next.couponCode ? next : null),
    clear: () => setCart(null),
  };
}

// ---- Customer (cleared with "Não é você? Limpar meus dados") ----

export interface SavedCustomer {
  name: string;
  phone: string;
  address: AddressInput | null;
}

export function useSavedCustomer() {
  const [customer, setCustomer] = useStored<SavedCustomer | null>('menu:customer', null);
  return { customer, save: (c: SavedCustomer) => setCustomer(c), clear: () => setCustomer(null) };
}

// ---- Recent orders of this device (links to their tracking pages) ----

export interface RecentOrder {
  slug: string;
  number: number;
  token: string;
  at: string;
}

export function useRecentOrders(slug: string) {
  const [orders, setOrders] = useStored<RecentOrder[]>('menu:orders', []);
  return {
    orders: orders.filter((o) => o.slug === slug),
    add: (order: RecentOrder) =>
      setOrders([order, ...orders.filter((o) => o.token !== order.token)].slice(0, 10)),
    clear: () => setOrders(null),
  };
}

// ---- Privacy notice version accepted on this device (per restaurant) ----

export function useAcceptedPrivacy(slug: string) {
  const [version, setVersion] = useStored<string | null>(`menu:${slug}:privacy`, null);
  return { version, accept: (v: string) => setVersion(v), clear: () => setVersion(null) };
}
