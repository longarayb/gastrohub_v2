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
  /** Pause/resume items ('Acabou'); operational staff can do it. */
  MENU_PAUSE: 'menu:pause',
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
  /** Refund a payment (owner and manager). */
  PAYMENTS_REFUND: 'payments:refund',
  KDS_OPERATE: 'kds:operate',
  CUSTOMERS_READ: 'customers:read',
  CUSTOMERS_MANAGE: 'customers:manage',
  DELIVERY_MANAGE: 'delivery:manage',
  DELIVERY_OPERATE: 'delivery:operate',
  /** Courier app: only the courier's own deliveries in progress (D029, LGPD). */
  COURIER_APP: 'courier:app',
  REPORTS_READ: 'reports:read',
  AUDIT_READ: 'audit:read',
  /** Print agents, printers and print settings (D035). */
  PRINTERS_MANAGE: 'printers:manage',
  /** Print and reprint documents (tickets, pre-bill, delivery copy) and handle held jobs. */
  PRINT: 'print:use',
  /** The local print agent itself (internal role, never a membership). */
  PRINT_AGENT: 'print:agent',
} as const;
export type Permission = (typeof Permission)[keyof typeof Permission];

const ALL = Object.values(Permission);
const P = Permission;
/** Permissions only internal device roles have. */
const DEVICE_ONLY: readonly Permission[] = [P.COURIER_APP, P.PRINT_AGENT];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  // The courier app is for couriers only (it shows the signed-in courier's own route).
  OWNER: ALL.filter((p) => !DEVICE_ONLY.includes(p)),
  MANAGER: ALL.filter((p) => p !== P.STORE_CREATE && !DEVICE_ONLY.includes(p)),
  CASHIER: [
    P.MENU_READ,
    P.MENU_PAUSE,
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
    P.PRINT,
  ],
  WAITER: [
    P.MENU_READ,
    P.ORDERS_READ,
    P.ORDERS_CREATE,
    P.ORDERS_UPDATE_STATUS,
    P.TABLES_OPERATE,
    P.CUSTOMERS_READ,
    P.PRINT,
  ],
  KITCHEN: [
    P.MENU_READ,
    P.MENU_PAUSE,
    P.ORDERS_READ,
    P.ORDERS_UPDATE_STATUS,
    P.KDS_OPERATE,
    P.PRINT,
  ],
  // No access to the board or the orders (LGPD): only their own deliveries in progress.
  COURIER: [P.COURIER_APP],
};

/**
 * Internal role of a paired KDS tablet/TV (D028): never a membership, only in access tokens.
 * It can only work the kitchen display and mark products as sold out.
 */
export const KDS_DEVICE_ROLE = 'KDS_DEVICE' as const;
export const KDS_DEVICE_PERMISSIONS: readonly Permission[] = [P.KDS_OPERATE, P.MENU_PAUSE];

/**
 * Internal role of a paired print agent (D035): a Windows service on a store PC. It only leases
 * and acknowledges print jobs and reports its printers; it never reads orders or customers.
 */
export const PRINT_AGENT_ROLE = 'PRINT_AGENT' as const;
export const PRINT_AGENT_PERMISSIONS: readonly Permission[] = [P.PRINT_AGENT];

export type DeviceRole = typeof KDS_DEVICE_ROLE | typeof PRINT_AGENT_ROLE;
export type ActorRole = Role | DeviceRole;

export function isDeviceRole(role: ActorRole | null | undefined): role is DeviceRole {
  return role === KDS_DEVICE_ROLE || role === PRINT_AGENT_ROLE;
}

export function hasPermission(role: ActorRole | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  if (role === KDS_DEVICE_ROLE) return KDS_DEVICE_PERMISSIONS.includes(permission);
  if (role === PRINT_AGENT_ROLE) return PRINT_AGENT_PERMISSIONS.includes(permission);
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function hasAnyPermission(
  role: ActorRole | null | undefined,
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
