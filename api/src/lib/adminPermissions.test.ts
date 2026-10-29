import { describe, expect, it } from 'vitest';
import { can, isAdminRole, ROLE_PERMISSIONS, type Permission } from './adminPermissions';

const ALL: Permission[] = [
  'catalogue.write',
  'inventory.write',
  'orders.write',
  'refunds.write',
  'promos.write',
  'suppliers.write',
  'customers.write',
  'admins.write',
  'workers.write',
  'markets.write',
];

// Opening a market is the platform's act, not a senior market role's. The route
// adds the account's market on top of this, so a super pinned to one market is
// refused too — the role and the boundary have to agree.
const NOT_BY_MARKET_ROLE: Permission[] = ['markets.write'];

describe('admin permissions', () => {
  it('lets a super admin do everything', () => {
    for (const permission of ALL) {
      expect(can('super', permission)).toBe(true);
    }
  });

  it('gives a market owner everything except the power to open another market', () => {
    for (const permission of ALL.filter((item) => item !== 'markets.write')) {
      expect(can('owner', permission)).toBe(true);
    }
    expect(can('owner', 'markets.write')).toBe(false);
  });

  it('holds markets back from the roles that run one market', () => {
    for (const role of ['owner', 'manager', 'staff'] as const) {
      for (const permission of NOT_BY_MARKET_ROLE) {
        expect(can(role, permission)).toBe(false);
      }
    }
  });

  it('lets a manager run the shop but not the accounts', () => {
    expect(can('manager', 'catalogue.write')).toBe(true);
    expect(can('manager', 'inventory.write')).toBe(true);
    expect(can('manager', 'orders.write')).toBe(true);
    expect(can('manager', 'refunds.write')).toBe(true);
    expect(can('manager', 'promos.write')).toBe(true);
    expect(can('manager', 'suppliers.write')).toBe(true);
    // Naming the market's people is part of running the shop.
    expect(can('manager', 'workers.write')).toBe(true);

    // The two things that must stay with the owner: who can sign in, and who
    // is allowed to shop. Opening a market is a super admin's alone.
    expect(can('manager', 'admins.write')).toBe(false);
    expect(can('manager', 'customers.write')).toBe(false);
    expect(can('manager', 'markets.write')).toBe(false);
  });

  it('gives a shop assistant order fulfilment only', () => {
    expect(can('staff', 'orders.write')).toBe(true);
    // Taking cash is part of delivering; paying it back, rostering people or
    // opening markets is not.
    expect(can('staff', 'refunds.write')).toBe(false);
    expect(can('staff', 'workers.write')).toBe(false);
    expect(can('staff', 'markets.write')).toBe(false);

    for (const permission of ALL.filter((item) => item !== 'orders.write')) {
      expect(can('staff', permission)).toBe(false);
    }
  });

  it('never grants a permission to an unknown role', () => {
    expect(can('intern' as never, 'orders.write')).toBe(false);
  });

  it('keeps the matrix closed: every role lists only real permissions', () => {
    for (const permissions of Object.values(ROLE_PERMISSIONS)) {
      for (const permission of permissions) {
        expect(ALL).toContain(permission);
      }
    }
  });

  it('stacks the roles, so a senior one holds everything the junior one does', () => {
    for (const permission of ROLE_PERMISSIONS.staff) expect(can('manager', permission)).toBe(true);
    for (const permission of ROLE_PERMISSIONS.manager) expect(can('owner', permission)).toBe(true);
    for (const permission of ROLE_PERMISSIONS.owner) expect(can('super', permission)).toBe(true);

    // Strictly senior, not renamed: each step up actually adds something.
    expect(ROLE_PERMISSIONS.owner.length).toBeGreaterThan(ROLE_PERMISSIONS.manager.length);
    expect(ROLE_PERMISSIONS.super.length).toBeGreaterThan(ROLE_PERMISSIONS.owner.length);
  });

  it('recognises the four role strings', () => {
    expect(isAdminRole('super')).toBe(true);
    expect(isAdminRole('owner')).toBe(true);
    expect(isAdminRole('manager')).toBe(true);
    expect(isAdminRole('staff')).toBe(true);
    expect(isAdminRole('admin')).toBe(false);
    expect(isAdminRole('platform')).toBe(false);
    expect(isAdminRole('')).toBe(false);
  });
});
