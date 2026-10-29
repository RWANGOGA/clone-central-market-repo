/**
 * What an admin is allowed to change.
 *
 * Reading stays open to every signed-in admin: a picker needs the catalogue, a
 * manager needs the books. Writes are where money and stock move, so they are
 * granted per role here instead of comparing `role === 'owner'` in a dozen
 * route files.
 *
 * Role is only one axis. The other is which market the account belongs to, and
 * that is answered in `marketScope.ts` — this matrix says what a role may do
 * wherever it is pinned, never which market it may do it in.
 *
 * This module deliberately imports nothing from the database: it is the part
 * that can be unit tested without a DATABASE_URL.
 */

export type AdminRole = 'super' | 'owner' | 'manager' | 'staff';

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

/**
 * The platform operator: every permission there is.
 *
 * Naming this role is the point. Before it existed, "sees everything" was an
 * accident of `admins.market_id` being null, so any market owner could be moved
 * off a market and silently become the platform. Now the two axes have to agree
 * with each other, and `isSuper` checks both.
 */
const SUPER: readonly Permission[] = [
  ...MANAGER,
  'customers.write',
  'admins.write',
  'markets.write',
];

export const ROLE_PERMISSIONS: Record<AdminRole, readonly Permission[]> = {
  super: SUPER,
  // An owner runs one market: the shop, its people, its accounts and its
  // shoppers. Opening a market is not part of running one, so `markets.write`
  // belongs to super alone — and the route asks the account's market as well,
  // so an owner promoted on a pinned account still cannot found a rival.
  owner: [...MANAGER, 'customers.write', 'admins.write'],
  manager: MANAGER,
  staff: STAFF,
};

export const ROLE_LABELS: Record<AdminRole, string> = {
  super: 'Super admin',
  owner: 'Market owner',
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
  // Read off the matrix rather than a second list of literals, so a role can be
  // added in one place only.
  return Object.hasOwn(ROLE_PERMISSIONS, value);
}
