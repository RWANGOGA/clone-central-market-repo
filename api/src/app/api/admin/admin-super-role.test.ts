import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Who may create the platform.
 *
 * `super` means nothing unless the routes refuse to hand it out, and unless the
 * role cannot be separated from the boundary it implies. The rules proved here:
 * opening a market belongs to a super, minting one belongs to a super, a super
 * cannot be pinned to a market, and no other role may be left without one.
 *
 * The database and the session are faked, because what is under test is the
 * branch a route takes rather than the SQL it builds. `guardAdmin` is stubbed to
 * let the caller through even in the cases where the permission matrix would
 * already have stopped it — a second line of defence is worth testing on its own
 * instead of hiding behind the first.
 */

const { guardAdmin, db } = vi.hoisted(() => ({
  guardAdmin: vi.fn(),
  db: {
    insert: vi.fn(),
    query: {
      markets: { findFirst: vi.fn(async () => undefined) },
      admins: { findFirst: vi.fn(async () => undefined) },
    },
  } as Record<string, any>,
}));

vi.mock('@/db', () => ({ db, queryRows: vi.fn() }));
vi.mock('@/lib/adminAuth', () => ({
  guardAdmin,
  requireAdmin: vi.fn(),
  authenticate: vi.fn(),
  SESSION_COOKIE: 'mk_admin_session',
}));
vi.mock('@/lib/activity', () => ({ recordActivity: vi.fn(async () => {}) }));
// scrypt is real work in a test that is not about passwords.
vi.mock('@/lib/password', () => ({ hashPassword: vi.fn(async () => 'scrypt$1$8$1$00$00') }));

import { markets } from '@/db/schema';
import { POST as createAdmin } from '@/app/api/admin/admins/route';
import { PATCH as patchAdmin } from '@/app/api/admin/admins/[id]/route';
import { POST as createMarket } from '@/app/api/admin/markets/route';

/** Every payload the fake database was asked to write, in order. */
const written: { table: string; payload: Record<string, unknown> }[] = [];

db.insert.mockImplementation((table: unknown) => ({
  values(payload: Record<string, unknown>) {
    const isMarket = table === markets;
    written.push({ table: isMarket ? 'markets' : 'admins', payload });
    return {
      returning: async () => [
        // The defaults the columns would carry, under what was asked for.
        isMarket
          ? { id: 3, createdAt: '2026-01-01 09:00:00', ...payload }
          : {
              id: 12,
              active: true,
              createdAt: '2026-01-01 09:00:00',
              lastLoginAt: null,
              ...payload,
            },
      ],
    };
  },
}));

const SUPER = { id: 1, email: 'super@example.com', name: 'Super', role: 'super', marketId: null };
const JKYA_OWNER = {
  id: 2,
  email: 'owner@example.com',
  name: 'Owner',
  role: 'owner',
  marketId: 7,
};
// No market on a role that is not the platform's: the row the migration exists
// to remove, and the one every gate here has to distrust.
const STRAY_OWNER = { ...JKYA_OWNER, id: 3, email: 'stray@example.com', marketId: null };

function post(path: string, body: unknown) {
  return new Request(`http://localhost:3001${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function patch(id: string, body: unknown) {
  return new Request(`http://localhost:3001/api/admin/admins/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** The caller the route sees, once `guardAdmin` has waved it through. */
function signedInAs(admin: Record<string, unknown>) {
  guardAdmin.mockResolvedValue({ ok: true, admin });
}

async function payloadOf(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

beforeEach(() => {
  written.length = 0;
});

describe('opening a market', () => {
  it('refuses a market owner', async () => {
    signedInAs(JKYA_OWNER);
    const response = await createMarket(post('/api/admin/markets', { name: 'Nakasero Market' }));
    expect(response.status).toBe(403);
    expect(written).toHaveLength(0);
  });

  it('refuses an account that holds no market but is not a super', async () => {
    // The permission matrix would already stop this caller, because opening a
    // market left `owner` when `super` was added. The route does not rely on
    // that: an unscoped row is not the platform unless its role says so.
    signedInAs(STRAY_OWNER);
    const response = await createMarket(post('/api/admin/markets', { name: 'Nakasero Market' }));
    expect(response.status).toBe(403);
    expect(written).toHaveLength(0);
  });

  it('lets a super open one', async () => {
    signedInAs(SUPER);
    const response = await createMarket(post('/api/admin/markets', { name: 'Nakasero Market' }));
    expect(response.status).toBe(201);
    expect(written).toEqual([
      { table: 'markets', payload: expect.objectContaining({ slug: 'nakasero-market' }) },
    ]);
  });
});

describe('creating staff accounts', () => {
  it('refuses to mint a super for anyone but one', async () => {
    signedInAs(JKYA_OWNER);
    const response = await createAdmin(
      post('/api/admin/admins', {
        name: 'Rival Platform',
        email: 'rival@example.com',
        role: 'super',
        password: 'a-long-enough-password',
      }),
    );
    expect(response.status).toBe(403);
    expect((await payloadOf(response)).error).toMatch(/super admin/i);
    expect(written).toHaveLength(0);
  });

  it('refuses a super pinned to a market', async () => {
    signedInAs(SUPER);
    const response = await createAdmin(
      post('/api/admin/admins', {
        name: 'Contradiction',
        email: 'pinned@example.com',
        role: 'super',
        password: 'a-long-enough-password',
        marketId: 7,
      }),
    );
    expect(response.status).toBe(422);
    expect(written).toHaveLength(0);
  });

  it('writes a super with no market', async () => {
    signedInAs(SUPER);
    const response = await createAdmin(
      post('/api/admin/admins', {
        name: 'Second Super',
        email: 'second@example.com',
        role: 'super',
        password: 'a-long-enough-password',
        marketId: null,
      }),
    );
    expect(response.status).toBe(201);
    expect(written[0]?.payload).toEqual(
      expect.objectContaining({ role: 'super', marketId: null }),
    );
  });

  it('will not leave a lesser role without a market', async () => {
    signedInAs(SUPER);
    const response = await createAdmin(
      post('/api/admin/admins', {
        name: 'Homeless Manager',
        email: 'homeless@example.com',
        role: 'manager',
        password: 'a-long-enough-password',
        marketId: null,
      }),
    );
    expect(response.status).toBe(422);
    expect(written).toHaveLength(0);
  });

  it('pins what a market owner creates to that market', async () => {
    signedInAs(JKYA_OWNER);
    const response = await createAdmin(
      post('/api/admin/admins', {
        name: 'Shop Manager',
        email: 'shop@example.com',
        role: 'manager',
        password: 'a-long-enough-password',
        // Deliberately unasked for: the caller has no choice about the market.
      }),
    );
    expect(response.status).toBe(201);
    expect(written[0]?.payload).toEqual(expect.objectContaining({ role: 'manager', marketId: 7 }));
  });
});

describe('changing a staff account', () => {
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

  it('refuses to hand out the platform role', async () => {
    signedInAs(JKYA_OWNER);
    db.query.admins.findFirst.mockResolvedValueOnce({
      id: 5,
      email: 'shop@example.com',
      name: 'Shop Manager',
      role: 'manager',
      marketId: 7,
      active: true,
    });
    const response = await patchAdmin(patch('5', { role: 'super' }), ctx('5'));
    expect(response.status).toBe(403);
  });

  it('refuses to promote an account that still runs a market', async () => {
    signedInAs(SUPER);
    db.query.admins.findFirst.mockResolvedValueOnce({
      id: 5,
      email: 'shop@example.com',
      name: 'Shop Manager',
      role: 'manager',
      marketId: 7,
      active: true,
    });
    const response = await patchAdmin(patch('5', { role: 'super' }), ctx('5'));
    expect(response.status).toBe(422);
    expect((await payloadOf(response)).error).toMatch(/every market/i);
  });

  it('refuses a demotion that would leave the account holding no market', async () => {
    // Both halves of the invariant at once: this is how a super quietly becomes
    // the unbounded owner the `super` role was added to make impossible. Another
    // super, not the caller, so the self-role rule is not what answers here.
    signedInAs(SUPER);
    db.query.admins.findFirst.mockResolvedValueOnce({
      id: 9,
      email: 'other@example.com',
      name: 'Other Super',
      role: 'super',
      marketId: null,
      active: true,
    });
    const response = await patchAdmin(patch('9', { role: 'owner' }), ctx('9'));
    expect(response.status).toBe(422);
    expect((await payloadOf(response)).error).toMatch(/only a super admin holds none/i);
  });

  it('refuses a move between markets that is not the platform making it', async () => {
    signedInAs(JKYA_OWNER);
    db.query.admins.findFirst.mockResolvedValueOnce({
      id: 5,
      email: 'shop@example.com',
      name: 'Shop Manager',
      role: 'manager',
      marketId: 7,
      active: true,
    });
    const response = await patchAdmin(patch('5', { marketId: 8 }), ctx('5'));
    expect(response.status).toBe(403);
  });
});
