import { describe, expect, it, vi } from 'vitest';

/**
 * Market leak tests on the catalogue routes.
 *
 * The claim being proved is narrow and is the one that matters: a staff request
 * from one market cannot read or write another market's products. The database is
 * faked down to the query chain, and the argument handed to `where` is inspected
 * as the SQL it actually builds — so a route that "filters" in the response body
 * instead of the query would fail here, which is the whole point.
 */

const { requireAdmin, guardAdmin, db } = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  guardAdmin: vi.fn(),
  // Captured per call so a test can assert on the SQL the route really asked
  // the database for.
  db: {} as Record<string, any>,
}));

const state = { where: [] as unknown[], values: [] as unknown[] };

function chain() {
  const builder: any = {
    where(arg: unknown) {
      state.where.push(arg);
      return builder;
    },
    orderBy() {
      return builder;
    },
    // Awaiting the builder is what an executable drizzle query does; the route
    // only ever sees rows it can map over, and there are none here.
    then: (resolve: (rows: never[]) => void) => resolve([]),
  };
  return builder;
}

db.select = () => ({ from: () => chain() });
db.query = { products: { findFirst: vi.fn(async () => undefined) } };
db.insert = () => ({
  values(payload: unknown) {
    state.values.push(payload);
    return {
      returning: async () => [
        // `imageFiles` is what the row always carries from the database; the
        // route maps over it, so the fake has to as well.
        { id: 9, name: 'Tomato', priceValue: 1000, unit: 'kg', stock: 5, marketId: 7, imageFiles: [] },
      ],
    };
  },
});

vi.mock('@/db', () => ({ db, queryRows: vi.fn() }));
vi.mock('@/lib/catalogue', async () => {
  const real = await vi.importActual<typeof import('@/lib/catalogue')>('@/lib/catalogue');
  return { ...real, requireAdmin };
});
vi.mock('@/lib/adminAuth', async () => {
  const real = await vi.importActual<typeof import('@/lib/adminAuth')>('@/lib/adminAuth');
  return { ...real, guardAdmin };
});
vi.mock('@/lib/uploads', () => ({ storeProductImage: vi.fn() }));
vi.mock('@/lib/activity', () => ({ recordActivity: vi.fn(async () => {}) }));

import { PgDialect } from 'drizzle-orm/pg-core';
import { GET, POST } from '@/app/api/admin/products/route';

const asAdmin = { ok: true, admin: { id: 1, email: 'a@b.c', name: 'A', role: 'owner' as const } };

function sqlText(node: unknown): string {
  // Render the wrapper the way the driver would, rather than guessing at it —
  // if this test had to hand-walk drizzle's internals it would be reading the
  // library instead of the route. Params are inlined because the assertion is
  // about which market the query is pinned to, not about placeholder numbering.
  if (node == null) return '';
  const query = new PgDialect().sqlToQuery(node as never);
  const params = (query.params as unknown[]).map((param) =>
    String(param && typeof param === 'object' && 'value' in param ? (param as { value: unknown }).value : param),
  );
  return query.sql.replace(/\$\d+/g, (token) => params[Number(token.slice(1)) - 1] ?? token);
}

const kampala = { ...asAdmin, admin: { ...asAdmin.admin, marketId: 7 } };
const platform = { ...asAdmin, admin: { ...asAdmin.admin, marketId: null } };

describe('admin catalogue market scope', () => {
  it('filters the list by the caller’s market in the query', async () => {
    state.where.length = 0;
    requireAdmin.mockResolvedValue({ ...platform.admin, marketId: 7 });

    await GET(new Request('http://localhost/api/admin/products'));

    expect(state.where).toHaveLength(1);
    const text = sqlText(state.where[0]);
    expect(text).toContain('market_id');
    expect(text).toContain('7');
  });

  it('sends no market filter at all for the platform tier', async () => {
    state.where.length = 0;
    requireAdmin.mockResolvedValue({ ...platform.admin, marketId: null });

    await GET(new Request('http://localhost/api/admin/products'));

    // `undefined` means "no constraint", which is what the platform tier is.
    expect(state.where[0]).toBeUndefined();
  });

  it('refuses a market admin a query aimed at another market', async () => {
    requireAdmin.mockResolvedValue({ ...platform.admin, marketId: 7 });

    const response = await GET(new Request('http://localhost/api/admin/products?marketId=8'));

    expect(response.status).toBe(403);
  });

  it('writes a new product into the caller’s market, not the one it asked for', async () => {
    state.values.length = 0;
    guardAdmin.mockResolvedValue(kampala);

    const body = {
      name: 'Onion', description: 'Red onions from the north', farm: 'Farm', location: 'Place',
      priceValue: 2000, unit: 'kg', stock: 4, marketId: 99,
    };

    const response = await POST(
      new Request('http://localhost/api/admin/products', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    );

    expect(response.status).toBe(201);
    const written = state.values[0] as { marketId: number };
    expect(written.marketId).toBe(7);
  });

  it('makes the platform tier choose a market instead of silently creating orphans', async () => {
    state.values.length = 0;
    guardAdmin.mockResolvedValue(platform);

    const body = {
      name: 'Onion', description: 'Red onions from the north', farm: 'Farm', location: 'Place',
      priceValue: 2000, unit: 'kg', stock: 4,
    };

    const response = await POST(
      new Request('http://localhost/api/admin/products', { method: 'POST', body: JSON.stringify(body) }),
    );

    expect(response.status).toBe(422);
    expect(state.values).toHaveLength(0);
  });
});
