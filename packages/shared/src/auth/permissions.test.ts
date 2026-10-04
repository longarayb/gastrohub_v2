import { describe, expect, it } from 'vitest';
import { isOpenAt } from '../stores/schemas.js';
import { Permission, Role, assignableRoles, hasPermission } from './permissions.js';

describe('permissions', () => {
  it('owner has every permission', () => {
    for (const p of Object.values(Permission)) {
      expect(hasPermission(Role.OWNER, p)).toBe(true);
    }
  });

  it('restricts operational roles', () => {
    expect(hasPermission(Role.WAITER, Permission.ORDERS_CREATE)).toBe(true);
    expect(hasPermission(Role.WAITER, Permission.ORDERS_CANCEL)).toBe(false);
    expect(hasPermission(Role.KITCHEN, Permission.CASH_OPERATE)).toBe(false);
    expect(hasPermission(Role.COURIER, Permission.DELIVERY_OPERATE)).toBe(true);
    expect(hasPermission(Role.MANAGER, Permission.STORE_CREATE)).toBe(false);
    expect(hasPermission(null, Permission.MENU_READ)).toBe(false);
  });

  it('only owners can assign the owner role', () => {
    expect(assignableRoles(Role.OWNER)).toContain(Role.OWNER);
    expect(assignableRoles(Role.MANAGER)).not.toContain(Role.OWNER);
    expect(assignableRoles(Role.CASHIER)).toEqual([]);
  });
});

describe('isOpenAt', () => {
  const hours = [
    { weekday: 1, opensAt: '11:00', closesAt: '15:00' },
    { weekday: 5, opensAt: '18:00', closesAt: '02:00' }, // Friday night until Saturday 2am
  ];

  it('checks simple intervals', () => {
    expect(isOpenAt(hours, 1, 11 * 60)).toBe(true);
    expect(isOpenAt(hours, 1, 15 * 60)).toBe(false);
    expect(isOpenAt(hours, 1, 10 * 60 + 59)).toBe(false);
    expect(isOpenAt(hours, 2, 12 * 60)).toBe(false);
  });

  it('handles intervals crossing midnight', () => {
    expect(isOpenAt(hours, 5, 23 * 60)).toBe(true);
    expect(isOpenAt(hours, 6, 60)).toBe(true); // Saturday 01:00
    expect(isOpenAt(hours, 6, 2 * 60)).toBe(false);
    expect(isOpenAt(hours, 5, 60)).toBe(false); // Friday 01:00 (Thursday had no night shift)
  });
});

describe('menu permissions', () => {
  it('lets operational staff pause items but not edit the menu or prices', () => {
    expect(hasPermission(Role.KITCHEN, Permission.MENU_PAUSE)).toBe(true);
    expect(hasPermission(Role.CASHIER, Permission.MENU_PAUSE)).toBe(true);
    expect(hasPermission(Role.WAITER, Permission.MENU_PAUSE)).toBe(false);
    expect(hasPermission(Role.CASHIER, Permission.MENU_MANAGE)).toBe(false);
    expect(hasPermission(Role.MANAGER, Permission.PRICES_MANAGE)).toBe(true);
  });
});
