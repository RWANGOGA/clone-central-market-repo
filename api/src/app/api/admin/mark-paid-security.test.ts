import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Marking a mobile-money / wallet payment received, proven at the route.
 *
 * This is the manual settlement that production needs while no gateway exists,
 * so the invariants that matter are: it refuses before touching the database
 * when the caller lacks permission; it 404s for another market's order; it only
 * settles payments actually awaiting; it compares-and-sets on the outstanding
 * statuses rather than trusting a read; a cancelled order is refused; and it
 * audits who confirmed the money. It must NOT change the order's fulfilment
 * status — settling is the money axis alone.
 */

const { guardAdmin, findOrder, orderDetail, recordActivity } = vi.hoisted(() => ({
  guardAdmin: vi.fn(),
  findOrder: vi.fn(),
  orderDetail: vi.fn(),
  recordActivity: vi.fn(async () => {}),
}));

const db: Record<string, any> = {};
vi.mock('@/db', () => ({ db }));
vi.mock('@/lib/adminAuth', async () => {
  const real = await vi.importActual<typeof import('@/lib/adminAuth')>('@/lib/adminAuth');
  return { ...real, guardAdmin };
});
vi.mock('@/lib/orderDetail', async () => {
  const real = await vi.importActual<typeof import('@/lib/orderDetail')>('@/lib/orderDetail');
  return { ...real, findOrder, orderDetail };
});
vi.mock('@/lib/activity', () => ({ recordActivity }));

const { PgDialect } = await import('drizzle-orm/pg-core');
const { POST } = await import('@/app/api/admin/orders/[id]/mark-paid/route');

const OWNER = { id: 4, email: 'owner@kampala.test', name: 'Owner', role: 'owner' as const, marketId: 7 };

const ORDER = {
  id: 42,
  reference: 'GRC-ABC123',
  status: 'pending',
  marketId: 7,
  total: 20000,
  currency: 'UGX',
};

const MOMO = {
  id: 9,
  orderId: 42,
  reference: 'PAY-9',
  channel: 'mobile_money',
  provider: 'MTN MoMo',
  status: 'awaiting_approval',
  amount: 20000,
  currency: 'UGX',
  providerRef: null,
  settlementTokenHash: 'abc',
};

const state = {
  order: undefined as unknown,
  outstanding: [] as unknown[],
  sets: [] as Record<string, unknown>[],
  wheres: [] as unknown[],
  inserts: [] as Record<string, unknown>[],
  cursor: 0,
};

function reset() {
  state.order = undefined;
  state.outstanding = [];
  state.sets = [];
  state.wheres = [];
  state.inserts = [];
  state.cursor = 0;
  guardAdmin.mockReset();
  findOrder.mockReset();
  orderDetail.mockReset();
  recordActivity.mockClear();
  findOrder.mockImplementation(async (id: string, marketId?: number | null) =>
    // Mirror the real helper's market pin: a market's order is not findable by
    // another market, so a scoped caller only ever gets its own.
    state.order && (marketId == null || (state.order as { marketId: number }).marketId === marketId)
      ? state.order
      : undefined,
  );
  orderDetail.mockImplementation(async () => ({ ...(state.order as object), payments: state.outstanding }));
}

// `select().from(payments).where(...)` resolves to the outstanding list;
// `transaction(cb)` runs the callback against a chainable fake transaction.
db.select = () => ({ from: () => ({ where: () => Promise.resolve(state.outstanding) }) });
db.transaction = (cb: (tx: unknown) => Promise<unknown>) =>
  cb({
    update: () => {
      const builder: any = {
        set(payload: Record<string, unknown>) {
          state.sets.push(payload);
          return builder;
        },
        where(cond: unknown) {
          state.wheres.push(cond);
          return builder;
        },
        returning: async () => {
          const base = state.outstanding[state.cursor++] as object;
          return [{ ...base, ...(state.sets[state.sets.length - 1] as object) }];
        },
      };
      return builder;
    },
    insert: () => ({
      values: (row: Record<string, unknown>) => {
        state.inserts.push(row);
        return Promise.resolve();
      },
    }),
  });

function signedInAs(admin: typeof OWNER) {
  guardAdmin.mockResolvedValue({ ok: true, admin });
}

function sqlText(node: unknown): string {
  if (node == null) return '';
  const query = new PgDialect().sqlToQuery(node as never);
  const params = (query.params as unknown[]).map((p) =>
    String(p && typeof p === 'object' && 'value' in p ? (p as { value: unknown }).value : p),
  );
  return query.sql.replace(/\$\d+/g, (t) => params[Number(t.slice(1)) - 1] ?? t);
}

const ctx = (id = 'GRC-ABC123') => ({ params: Promise.resolve({ id }) });

function request(body: unknown = {}) {
  return new Request('http://localhost/api/admin/orders/GRC-ABC123/mark-paid', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

describe('admin mark-paid', () => {
  beforeEach(reset);

  it('settles an awaiting mobile-money payment to succeeded and records who did it', async () => {
    signedInAs(OWNER);
    state.order = ORDER;
    state.outstanding = [MOMO];

    const response = await POST(request(), ctx());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(state.sets[0]).toMatchObject({
      status: 'succeeded',
      settledByEmail: OWNER.email,
      settlementTokenHash: null,
    });
    expect(body.meta.settled).toBe(20000);
    expect(recordActivity).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'payment.settle', entityId: 'GRC-ABC123', marketId: 7 }),
    );
  });

  it('writes a status-event note but leaves the fulfilment status untouched', async () => {
    signedInAs(OWNER);
    state.order = ORDER;
    state.outstanding = [MOMO];

    await POST(request(), ctx());

    expect(state.inserts).toHaveLength(1);
    expect(state.inserts[0]).toMatchObject({ orderId: 42, toStatus: 'pending' });
    // Money moved; goods did not. There is no `orders` update in this route.
    expect(String(state.inserts[0]?.note)).toContain('MTN MoMo');
  });

  it('compare-and-sets on the outstanding statuses, not a stale read', async () => {
    signedInAs(OWNER);
    state.order = ORDER;
    state.outstanding = [MOMO];

    await POST(request(), ctx());

    // The UPDATE's WHERE re-checks the id and the awaiting statuses, so a
    // payment settled by a gateway webhook in the meantime is not clobbered.
    const text = sqlText(state.wheres[0]);
    expect(text).toContain('"payments"."id"');
    expect(text).toContain('awaiting_approval');
  });

  it('records the provider reference the operator types in', async () => {
    signedInAs(OWNER);
    state.order = ORDER;
    state.outstanding = [MOMO];

    await POST(request({ providerRef: 'MOMO-778899' }), ctx());

    expect(state.sets[0]).toMatchObject({ providerRef: 'MOMO-778899' });
  });

  it('never overwrites a provider reference the gateway already reported', async () => {
    signedInAs(OWNER);
    state.order = ORDER;
    state.outstanding = [{ ...MOMO, providerRef: 'GW-ALREADY' }];

    await POST(request({ providerRef: 'MOMO-778899' }), ctx());

    expect(state.sets[0]?.providerRef).toBeUndefined();
  });

  it('409s when there is nothing awaiting on the order', async () => {
    signedInAs(OWNER);
    state.order = ORDER;
    state.outstanding = [];

    const response = await POST(request(), ctx());

    expect(response.status).toBe(409);
    expect(state.sets).toHaveLength(0);
    expect(recordActivity).not.toHaveBeenCalled();
  });

  it('refuses a cancelled order, where the honest move is a refund', async () => {
    signedInAs(OWNER);
    state.order = { ...ORDER, status: 'cancelled' };
    state.outstanding = [MOMO];

    const response = await POST(request(), ctx());

    expect(response.status).toBe(409);
    expect(state.sets).toHaveLength(0);
  });

  it('404s another market’s order, which is all a stranger learned', async () => {
    signedInAs({ ...OWNER, marketId: 8 });
    state.order = ORDER; // belongs to market 7
    state.outstanding = [MOMO];

    const crossMarket = await POST(request(), ctx());
    expect(crossMarket.status).toBe(404);
    expect(state.sets).toHaveLength(0);
  });

  it('401s before any read when the guard refuses', async () => {
    guardAdmin.mockResolvedValue({ ok: false, status: 401, message: 'Not signed in' });

    const unauthed = await POST(request(), ctx());
    expect(unauthed.status).toBe(401);
    expect(findOrder).not.toHaveBeenCalled();
  });
});
