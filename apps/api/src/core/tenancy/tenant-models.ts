/**
 * Models whose rows belong to a tenant (Store) and carry a `tenantId` column.
 * Every query on these models is scoped automatically by the tenant Prisma extension.
 *
 * When adding a business model to schema.prisma, add it here too.
 * (A unit test fails if a model has `tenantId` but is missing from this list.)
 */
export const TENANT_MODELS = new Set<string>([
  'BusinessHours',
  'Membership',
  'AuditLog',
  // Menu
  'ProductionSector',
  'Category',
  'Product',
  'Size',
  'ProductSizePrice',
  'ModifierGroup',
  'ModifierOption',
  'ModifierOptionSizePrice',
  'ModifierGroupLink',
  'AvailabilitySchedule',
  // Orders
  'Area',
  'Table',
  'TableSession',
  'TableSessionTable',
  'Customer',
  'CustomerAddress',
  'Courier',
  'Coupon',
  'OrderSequence',
  'Order',
  'OrderRound',
  'OrderItem',
  'OrderStatusHistory',
  'Payment',
  // Cash register
  'CashSession',
  'CashMovement',
  'CashSessionCount',
  // Kitchen display
  'ProductionTask',
  'KdsDevice',
]);
