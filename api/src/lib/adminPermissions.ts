/**
 * What an admin is allowed to change.
 *
 * Reading stays open to every signed-in admin: a picker needs the catalogue, a
 * manager needs the books. Writes are where money and stock move, so they are
 * granted per role here instead of comparing `role === 'owner'` in a dozen
 * route files.
 *
 * This module deliberately imports nothing from the database: it is the part
 * that can be unit tested without a DATABASE_URL.
 */

export type AdminRole = 'owner' | 'manager' | 'staff';

export type Permission =
  | 'catalogue.write'
  | 'inventory.write'
  | 'orders.write'
  | 'refunds.write'
  | 'promos.write'
  | 'suppliers.write'
  | 'customers.write'
  | 'admins.write'
  | 'workers.write'
  | 'markets.write';

/** Managers run the shop; they cannot touch accounts or customer access. */
const MANAGER: readonly Permission[] = [
  'catalogue.write',
  'inventory.write',
  'orders.write',
  'refunds.write',
  'promos.write',
  'suppliers.write',
  'workers.write',
];

/** A shop assistant fulfils orders and nothing else. */
const STAFF: readonly Permission[] = ['orders.write'];

export const ROLE_PERMISSIONS: Record<AdminRole, readonly Permission[]> = {
  // Opening a market is not part of running one, so the role gate is only half
  // of it: `markets.write` sits on owner, and the route additionally requires a
  // platform account (`admins.market_id` is null). An owner of one market can
  // therefore never create a second one and staff it as they please.
  owner: [...MANAGER, 'customers.write', 'admins.write', 'markets.write'],
  manager: MANAGER,
  staff: STAFF,
};

export const ROLE_LABELS: Record<AdminRole, string> = {
  owner: 'Owner',
  manager: 'Manager',
  staff: 'Shop assistant',
};

/** Human wording for the 403 message, so it says what was refused. */
export const PERMISSION_LABELS: Record<Permission, string> = {
  'catalogue.write': 'change the catalogue',
  'inventory.write': 'adjust stock',
  'orders.write': 'update orders',
  'refunds.write': 'record refunds',
  'promos.write': 'change promo codes',
  'suppliers.write': 'change suppliers or purchase orders',
  'customers.write': 'change customer access',
  'admins.write': 'manage admin accounts',
  'workers.write': 'manage the people who work at the market',
  'markets.write': 'open or change a market',
};

export function can(role: AdminRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

export function isAdminRole(value: string): value is AdminRole {
  return value === 'owner' || value === 'manager' || value === 'staff';
}
