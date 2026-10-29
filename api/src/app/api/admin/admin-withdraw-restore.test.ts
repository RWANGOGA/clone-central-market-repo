import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Withdraw and restore, proven at the route.
 *
 * The console used to flip `active` with a PATCH. Both halves now go through
 * their named routes, so what has to hold is narrower than "it works" and is
 * exactly this: a withdrawal never deletes, a restore only answers for a row
 * that was actually withdrawn, neither reaches another market's product, and
 * neither touches the database before the permission guard has said yes.
 */

const { guardAdmin, db, recordActivity } = vi.hoisted(() => ({
  guardAdmin: vi.fn(),
  // Captured per call, so a test can assert what the route really asked for
  // instead of what it meant to ask for.
  db: {} as Record<string, any>,
  recordActivity: vi.fn(async () => {}),
}));

const state = {
  found: undefined as unknown,
  sets: [] as unknown[],
  reads: [] as unknown[],
};

function reset() {
  state.found = undefined;
  state.sets.length = 0;
  state.reads.length = 0;
  recordActivity.mockClear();
}

db.query = {
  products: {
    findFirst: vi.fn(async (options?: { where?: unknown }) => {
      state.reads.push(options?.where);
      return state.found;
    }),
  },
};

db.update = () => {
  const builder: any = {
    set(payload: unknown) {
      state.sets.push(payload);
      return builder;
    },
    where() {
      return builder;
    },
    returning: async () => [
      // The row as it was, with the flip applied — which is what Postgres hands
      // back for `UPDATE … RETURNING *`.
      {
        ...(state.found as object),
        ...(state.sets[state.sets.length - 1] as object),
        imageFiles: [],
      },
    ],
  };
  return builder;
};

vi.mock('@/db', () => ({ db }));
vi.mock('@/lib/adminAuth', async () => {
  const real = await vi.importActual<typeof import('@/lib/adminAuth')>('@/lib/adminAuth');
  return { ...real, guardAdmin };
});
vi.mock('@/lib/activity', () => ({ recordActivity }));
vi.mock('@/lib/uploads', () => ({ storeProductImage: vi.fn() }));

import { PgDialect } from 'drizzle-orm/pg-core';
import { DELETE } from '@/app/api/admin/products/[id]/route';
import { POST as restore } from '@/app/api/admin/products/[id]/restore/route';

const MANAGER = {
  id: 4,
  email: 'manager@kampala.test',
  name: 'Kampala Manager',
  role: 'manager' as const,
  marketId: 7,
};
const ASSISTANT = { ...MANAGER, id: 8, email: 'assistant@kampala.test', name: 'Assistant', role: 'staff' as const };

const ON_SHELF = {
  id: 9,
  slug: 'tomato',
  name: 'Tomato',
  priceValue: 2000,
  priceLabel: 'USh 2,000 per kg',
  unit: 'kg',
  stock: 5,
  marketId: 7,
  active: true,
  imageFiles: [],
  dietary: [],
};
const WITHDRAWN = { ...ON_SHELF, active: false };

function signedInAs(admin: typeof MANAGER | typeof ASSISTANT) {
  guardAdmin.mockResolvedValue({ ok: true, admin });
}

function refused(status: number, message: string) {
  guardAdmin.mockResolvedValue({ ok: false, status, message });
}

function ctx(id = '9') {
  return { params: Promise.resolve({ id }) };
}

const request = (path: string, method = 'DELETE') =>
  new Request(`http://localhost/api/admin/products/${path}`, { method });

function sqlText(node: unknown): string {
  // Rendered the way the driver would, rather than guessed at: the assertion is
  // about which market the query is pinned to, not about drizzle's internals.
  if (node == null) return '';
  const query = new PgDialect().sqlToQuery(node as never);
  const params = (query.params as unknown[]).map((param) =>
    String(param && typeof param === 'object' && 'value' in param ? (param as { value: unknown }).value : param),
  );
  return query.sql.replace(/\$\d+/g, (token) => params[Number(token.slice(1)) - 1] ?? token);
}

describe('admin product withdrawal', () => {
  beforeEach(reset);

  it('flips the flag and keeps the row, because orders still point at it', async () => {
    signedInAs(MANAGER);
    state.found = ON_SHELF;

    const response = await DELETE(request('9'), ctx());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(state.sets).toEqual([{ active: false }]);
    expect(body.data.active).toBe(false);
    expect(body.meta.withdrawnBy).toBe(MANAGER.email);
  });

  it('audits the withdrawal against the product’s own market', async () => {
    signedInAs(MANAGER);
    state.found = ON_SHELF;

    await DELETE(request('9'), ctx());

    expect(recordActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'product.update',
        entityId: 9,
        after: { active: false },
        marketId: 7,
      }),
    );
  });

  it('accepts the slug as well as the id', async () => {
    signedInAs(MANAGER);
    state.found = ON_SHELF;

    const response = await DELETE(request('tomato'), ctx('tomato'));

    expect(response.status).toBe(200);
    expect(sqlText(state.reads[0])).toContain('slug');
  });

  it('says 404 for a product in someone else’s market, which is all a stranger learned', async () => {
    signedInAs({ ...MANAGER, marketId: 8 });
    state.found = undefined;

    const response = await DELETE(request('9'), ctx());

    expect(response.status).toBe(404);
    expect(state.sets).toHaveLength(0);
    // The scope belongs in the query, not in a check afterwards: the id is the
    // only thing a caller across the boundary had to guess.
    expect(sqlText(state.reads[0])).toContain('market_id');
  });

  it('never reaches the database when the caller is a shop assistant', async () => {
    refused(403, 'Your role (staff) cannot change the catalogue.');

    const response = await DELETE(request('9'), ctx());

    expect(response.status).toBe(403);
    // Said out loud because the whole phase rests on it: this route asks for
    // `catalogue.write`, which is the permission an assistant does not hold.
    expect(guardAdmin).toHaveBeenCalledWith(expect.any(Request), 'catalogue.write');
    expect(state.reads).toHaveLength(0);
    expect(state.sets).toHaveLength(0);
  });
});

describe('admin product restore', () => {
  beforeEach(reset);

  it('brings a withdrawn row back and names who did it', async () => {
    signedInAs(MANAGER);
    state.found = WITHDRAWN;

    const response = await restore(request('9', 'POST'), ctx());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(state.sets[0]).toMatchObject({ active: true });
    expect(body.data.active).toBe(true);
    expect(body.meta.restoredBy).toBe(MANAGER.email);
  });

  it('audits the restore, which is why the action existed before anything emitted it', async () => {
    signedInAs(MANAGER);
    state.found = WITHDRAWN;

    await restore(request('9', 'POST'), ctx());

    expect(recordActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'product.restore',
        entityId: 9,
        before: { active: false },
        after: { active: true },
        marketId: 7,
      }),
    );
  });

  it('refuses a product that was never withdrawn instead of rewriting a live one', async () => {
    signedInAs(MANAGER);
    state.found = ON_SHELF;

    const response = await restore(request('9', 'POST'), ctx());

    expect(response.status).toBe(409);
    expect(state.sets).toHaveLength(0);
    expect(recordActivity).not.toHaveBeenCalled();
  });

  it('scopes the lookup to the caller’s market before deciding anything', async () => {
    signedInAs(MANAGER);
    state.found = WITHDRAWN;

    await restore(request('9', 'POST'), ctx());

    const text = sqlText(state.reads[0]);
    expect(text).toContain('market_id');
    expect(text).toContain('7');
  });

  it('never reaches the database when the caller is a shop assistant', async () => {
    refused(403, 'Your role (staff) cannot change the catalogue.');

    const response = await restore(request('9', 'POST'), ctx());

    expect(response.status).toBe(403);
    // The same permission on both halves, so an assistant cannot put a product
    // back after being refused the right to take it off.
    expect(guardAdmin).toHaveBeenCalledWith(expect.any(Request), 'catalogue.write');
    expect(state.reads).toHaveLength(0);
    expect(state.sets).toHaveLength(0);
  });
});
