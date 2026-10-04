/** Roles and permission matrix. Used by the API guards and by the frontend to hide actions. */

export const Role = {
  OWNER: 'OWNER',
  MANAGER: 'MANAGER',
  CASHIER: 'CASHIER',
  WAITER: 'WAITER',
  KITCHEN: 'KITCHEN',
  COURIER: 'COURIER',
} as const;
export type Role = (typeof Role)[keyof typeof Role];

export const ROLES = Object.values(Role);

export const ROLE_LABELS: Record<Role, string> = {
  OWNER: 'Dono',
  MANAGER: 'Gerente',
  CASHIER: 'Caixa',
  WAITER: 'Garçom',
  KITCHEN: 'Cozinha',
  COURIER: 'Entregador',
};

export const Permission = {
  STORE_MANAGE: 'store:manage',
  STORE_CREATE: 'store:create',
  USERS_MANAGE: 'users:manage',
  MENU_READ: 'menu:read',
  MENU_MANAGE: 'menu:manage',
  PRICES_MANAGE: 'prices:manage',
  ORDERS_READ: 'orders:read',
  ORDERS_CREATE: 'orders:create',
  ORDERS_UPDATE_STATUS: 'orders:update_status',
  ORDERS_CANCEL: 'orders:cancel',
  ORDERS_DISCOUNT: 'orders:discount',
  TABLES_OPERATE: 'tables:operate',
  TABLES_MANAGE: 'tables:manage',
  CASH_OPERATE: 'cash:operate',
  CASH_MANAGE: 'cash:manage',
  KDS_OPERATE: 'kds:operate',
  CUSTOMERS_READ: 'customers:read',
  CUSTOMERS_MANAGE: 'customers:manage',
  DELIVERY_MANAGE: 'delivery:manage',
  DELIVERY_OPERATE: 'delivery:operate',
  REPORTS_READ: 'reports:read',
  AUDIT_READ: 'audit:read',
} as const;
export type Permission = (typeof Permission)[keyof typeof Permission];

const ALL = Object.values(Permission);
const P = Permission;

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  OWNER: ALL,
  MANAGER: ALL.filter((p) => p !== P.STORE_CREATE),
  CASHIER: [
    P.MENU_READ,
    P.ORDERS_READ,
    P.ORDERS_CREATE,
    P.ORDERS_UPDATE_STATUS,
    P.ORDERS_CANCEL,
    P.ORDERS_DISCOUNT,
    P.TABLES_OPERATE,
    P.CASH_OPERATE,
    P.KDS_OPERATE,
    P.CUSTOMERS_READ,
    P.CUSTOMERS_MANAGE,
    P.DELIVERY_OPERATE,
  ],
  WAITER: [
    P.MENU_READ,
    P.ORDERS_READ,
    P.ORDERS_CREATE,
    P.ORDERS_UPDATE_STATUS,
    P.TABLES_OPERATE,
    P.CUSTOMERS_READ,
  ],
  KITCHEN: [P.MENU_READ, P.ORDERS_READ, P.ORDERS_UPDATE_STATUS, P.KDS_OPERATE],
  COURIER: [P.ORDERS_READ, P.DELIVERY_OPERATE],
};

export function hasPermission(role: Role | null | undefined, permission: Permission): boolean {
  return role ? ROLE_PERMISSIONS[role].includes(permission) : false;
}

export function hasAnyPermission(
  role: Role | null | undefined,
  permissions: readonly Permission[],
): boolean {
  return permissions.some((p) => hasPermission(role, p));
}

/** Roles a given role is allowed to assign to other users. */
export function assignableRoles(role: Role): Role[] {
  if (role === Role.OWNER) return [...ROLES];
  if (role === Role.MANAGER) return ROLES.filter((r) => r !== Role.OWNER);
  return [];
}
