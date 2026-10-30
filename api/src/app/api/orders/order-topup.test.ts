import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Adding an item to an order that is already placed.
 *
 * The buyer's basket becomes an order the moment checkout runs, so this route
 * works on the far more delicate object: reserved stock, a spent promo
 * redemption and a payment intent holding a copy of the old total. What has to
 * hold is exactly this, and none of it is visible in the response body:
 *
 *   - the basket is open only while the order is pending AND unpaid, and that
 *     test is a compare-and-set, so a payment settling at the same moment
 *     cannot leave goods cheaper than they were sold;
 *   - the money is recomputed from what the order now contains, not from what
 *     the browser says;
 *   - a code already claimed keeps applying, and is never claimed twice;
 *   - another market's goods, a withdrawn product and somebody else's order are
 *     all refused before the ledger is touched.
 */

const { db, ownsOrder, allow, recordMovement, publishOrderEvent, createCustomerNotification, findPromoForUpdate } =
  vi.hoisted(() => ({
    db: {} as Record<string, any>,
    ownsOrder: vi.fn(),
    allow: vi.fn(async () => true),
    recordMovement: vi.fn(),
    publishOrderEvent: vi.fn(),
    createCustomerNotification: vi.fn(async () => {}),
    findPromoForUpdate: vi.fn(),
  }));

/**
 * A fake that answers from prepared rows and records every payload.
 *
 * `rows` is keyed by table and consumed in call order, because this route reads
 * the order's lines twice — once to find a line to merge into, once after the
 * write to price what the order actually holds.
 */
const state = {
  order: undefined as Record<string, any> | undefined,
  product: undefined as Record<string, any> | undefined,
  rows: {} as Record<string, unknown[]>,
  sets: [] as { table: string; payload: unknown }[],
  inserts: [] as { table: string; values: unknown }[],
  locks: [] as unknown[],
  /** Making the status compare-and-set lose, as it does when a payment settled. */
  lockFails: false,
};

function reset() {
  state.order = {
    id: 21,
    reference: 'GRC-AAA111222',
    customerId: 9,
    marketId: 7,
    status: 'pending',
    subtotal: 95_000,
    discount: 0,
    promoCode: null,
    shipping: 5_000,
    tax: 0,
    total: 100_000,
    currency: 'UGX',
    region: 'Central Region',
    district: 'Kampala',
    customerName: 'Namukasa Allen',
    createdAt: '2026-01-01 00:00:00',
    updatedAt: '2026-01-01 00:00:00',
  };
  state.product = {
    id: 3,
    name: 'Tomato',
    unit: 'kg',
    priceValue: 4_000,
    marketId: 7,
    active: true,
    stock: 40,
  };
  state.rows = {
    // First read of the lines, then the read that prices the order afterwards.
    order_items: [
      [{ id: 1, productId: 5, name: 'Matooke', priceValue: 95_000, quantity: 1, lineTotal: 95_000 }],
      [
        { lineTotal: 95_000 },
        { lineTotal: 8_000 },
      ],
    ],
    payments: [],
    promo_codes: [],
  };
  state.sets = [];
  state.inserts = [];
  state.locks = [];
  state.lockFails = false;

  ownsOrder.mockResolvedValue(true);
  allow.mockResolvedValue(true);
  recordMovement.mockResolvedValue(undefined);
  publishOrderEvent.mockReset();
  findPromoForUpdate.mockResolvedValue(null);
}

db.query = {
  orders: { findFirst: vi.fn(async () => state.order) },
  products: { findFirst: vi.fn(async () => state.product) },
};

/**
 * Which table the next builder call is aimed at. Drizzle names the tables the
 * way the database does, and `state.rows` is keyed on those names.
 */
let table = 'unknown';

const tx: any = {
  // Same read helpers the route uses outside a transaction, which is how drizzle
  // really behaves — so this has to be bound after `db.query` is built.
  query: db.query,
  update(target: any) {
    table = getTableName(target);
    const builder: any = {
      set(payload: unknown) {
        state.sets.push({ table, payload });
        return builder;
      },
      where(node: unknown) {
        state.locks.push(node);
        return builder;
      },
      async returning() {
        if (table !== 'orders') return [];
        // An `UPDATE … RETURNING *` hands back the row with the write applied.
        if (state.lockFails) return [];
        const last = state.sets[state.sets.length - 1]?.payload as Record<string, unknown>;
        const row = { ...state.order, ...last } as Record<string, unknown>;
        // The route writes `now()` as an expression, which Postgres evaluates on
        // the way out. Reading it back as a SQL object would be a fake artefact,
        // and the event/notification builders want the timestamp it became.
        if (typeof row.updatedAt !== 'string') row.updatedAt = '2026-01-01 00:05:00';
        return [row];
      },
      // Drizzle's update builder is thenable, and this route awaits one
      // directly when it closes a stale payment prompt.
      then(resolve: (value: unknown) => void) {
        return resolve(undefined);
      },
    };
    return builder;
  },
  insert(target: any) {
    table = getTableName(target);
    return {
      values(row: unknown) {
        state.inserts.push({ table, values: row });
        return Promise.resolve([]);
      },
    };
  },
  select(_columns?: unknown) {
    const builder: any = {
      from(target: any) {
        table = getTableName(target);
        return builder;
      },
      where() {
        return builder;
      },
      limit() {
        return builder;
      },
      orderBy() {
        return builder;
      },
      for() {
        return builder;
      },
      then(resolve: (rows: unknown) => void) {
        // A table read twice in one run (the order's lines, before and after the
        // write) is served from a queue; one-shot reads keep their answer.
        const queue = state.rows[table] ?? [];
        const next = queue.length > 1 ? queue.shift() : queue[0];
        return resolve(next ?? []);
      },
    };
    return builder;
  },
};

db.transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx));

vi.mock('@/db', () => ({ db }));
vi.mock('@/lib/orderOwnership', () => ({ ownsOrder }));
vi.mock('@/lib/rateLimit', () => ({ allow }));
vi.mock('@/lib/stockLedger', () => ({ recordMovement }));
vi.mock('@/lib/orderEvents', () => ({ publishOrderEvent }));
vi.mock('@/lib/notifications', () => ({ createCustomerNotification }));
vi.mock('@/lib/promotions', async () => {
  const real = await vi.importActual<typeof import('@/lib/promotions')>('@/lib/promotions');
  return { ...real, findPromoForUpdate };
});

import { PgDialect } from 'drizzle-orm/pg-core';
import { getTableName } from 'drizzle-orm';
import { POST } from '@/app/api/orders/[id]/items/route';

function sqlText(node: unknown): string {
  if (node == null) return '';
  const query = new PgDialect().sqlToQuery(node as never);
  const params = (query.params as unknown[]).map((param) =>
    String(param && typeof param === 'object' && 'value' in param ? (param as { value: unknown }).value : param),
  );
  return query.sql.replace(/\$\d+/g, (token) => params[Number(token.slice(1)) - 1] ?? token);
}

function ctx(id = '21') {
  return { params: Promise.resolve({ id }) };
}

function add(productId = 3, quantity = 2) {
  return POST(
    new Request('http://localhost/api/orders/21/items', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ productId, quantity }),
    }),
    ctx(),
  );
}

describe('adding an item to an open order', () => {
  beforeEach(reset);

  it('refuses a stranger before anything is written', async () => {
    ownsOrder.mockResolvedValue(false);

    const response = await add();

    expect(response.status).toBe(404);
    expect(db.transaction).not.toHaveBeenCalled();
    expect(recordMovement).not.toHaveBeenCalled();
  });

  it('holds the basket open only while the order is pending, by compare-and-set', async () => {
    await add();

    // The very first statement must be the lock: the order id and the status it
    // was read as, both in the WHERE clause, so a concurrent advance loses.
    expect(state.sets[0]?.table).toBe('orders');
    const lock = sqlText(state.locks[0]);
    expect(lock).toContain('"orders"."id" = 21');
    expect(lock).toContain('"orders"."status" = pending');
  });

  it('will not grow a basket that has already been paid for', async () => {
    state.rows.payments = [[{ id: 88 }]];

    const response = await add();

    expect(response.status).toBe(409);
    expect(recordMovement).not.toHaveBeenCalled();
    expect(state.inserts).toHaveLength(0);
  });

  it('refuses when the order moved on while it was being read', async () => {
    state.lockFails = true;

    const response = await add();

    expect(response.status).toBe(409);
    expect(state.sets.filter((entry) => entry.table === 'orders')).toHaveLength(1);
  });

  it('keeps one order in one market', async () => {
    state.product = { ...state.product, marketId: 11 };

    const response = await add();

    expect(response.status).toBe(422);
    expect(recordMovement).not.toHaveBeenCalled();
  });

  it('refuses a product the market has taken off the shelf', async () => {
    state.product = { ...state.product, active: false };

    const response = await add();

    expect(response.status).toBe(409);
    expect(recordMovement).not.toHaveBeenCalled();
  });

  it('reports the product that ran out rather than a bare conflict', async () => {
    const { StockConflict } = await import('@/lib/stockErrors');
    recordMovement.mockRejectedValue(new StockConflict(3, undefined));

    const response = await add();
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.conflict.productId).toBe(3);
  });

  it('adds a line at the price the product carries now, and reserves its stock', async () => {
    const response = await add();
    const body = await response.json();

    expect(response.status).toBe(201);

    const line = state.inserts.find((entry) => entry.table === 'order_items')?.values as Record<string, unknown>;
    expect(line).toMatchObject({ productId: 3, priceValue: 4_000, quantity: 2, lineTotal: 8_000 });

    expect(recordMovement).toHaveBeenCalledWith(
      expect.objectContaining({ productId: 3, delta: -2, reason: 'sale', reference: 'GRC-AAA111222' }),
      expect.anything(),
    );

    // 103,000 of goods crosses the free-delivery line, so the 5,000 fee the
    // order was placed with goes away on its own — the route never touches it.
    expect(body.totals).toMatchObject({ subtotal: 103_000, discount: 0, shipping: 0, tax: 0, total: 103_000 });
    expect(body.data.total).toBe(103_000);
  });

  it('re-prices a claimed code without claiming it a second time', async () => {
    state.order = { ...state.order, promoCode: 'FRESHFIVER', discount: 9_500 };
    findPromoForUpdate.mockResolvedValue({
      code: 'FRESHFIVER',
      kind: 'percent',
      value: 10,
      minSubtotal: 10_000,
      maxDiscount: null,
      active: true,
      startsAt: null,
      endsAt: null,
      usageLimit: 1,
      usedCount: 1,
      perCustomerLimit: null,
    });

    const response = await add();
    const body = await response.json();

    expect(response.status).toBe(201);
    // 10% of the new 103,000 subtotal, and nothing redeemed again.
    expect(body.totals).toMatchObject({ subtotal: 103_000, discount: 10_300, shipping: 0, total: 92_700 });
  });

  it('closes the payment prompt whose amount is now wrong', async () => {
    await add();

    const money = state.sets.find(
      (entry) => entry.table === 'payments' && (entry.payload as { failureReason?: string }).failureReason,
    );
    expect(money?.payload).toMatchObject({ status: 'cancelled', failureReason: 'Basket changed' });
  });

  it('tells the console the total moved without pretending a state changed', async () => {
    await add();

    expect(publishOrderEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'order.updated', from: 'pending', to: 'pending', total: 103_000 }),
    );
  });

  it('refuses a quantity beyond what a basket line may carry', async () => {
    const response = await POST(
      new Request('http://localhost/api/orders/21/items', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ productId: 3, quantity: 900 }),
      }),
      ctx(),
    );

    expect(response.status).toBe(422);
    expect(db.transaction).not.toHaveBeenCalled();
  });
});
