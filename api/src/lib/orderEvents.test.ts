import { afterEach, describe, expect, it } from 'vitest';
import {
  marketFeedFilter,
  publishOrderEvent,
  subscriberCount,
  subscribe,
  type OrderEvent,
} from '@/lib/orderEvents';

/**
 * The live feed's market boundary, without a database.
 *
 * The SSE route used to hand every open dashboard every order event, so a market
 * account watched another market's customers check out — with their names and
 * totals attached. The filter is applied at fan-out rather than in the route, so
 * the guarantee belongs to the registry and a future subscriber cannot miss it.
 */

function event(overrides: Partial<OrderEvent> = {}): OrderEvent {
  return {
    type: 'order.created',
    id: 1,
    reference: 'MK-0001',
    to: 'pending',
    marketId: 7,
    total: 25000,
    currency: 'UGX',
    region: 'Buganda',
    district: 'Kampala',
    customerName: 'Nalule',
    at: '2026-10-29 12:00:00',
    ...overrides,
  };
}

const kampala = { marketId: 7 };
const nakasero = { marketId: 3 };
const platform = { marketId: null };

/** Subscribes with the caller's filter and collects what actually arrives. */
function hear(
  admin: { marketId: number | null },
  published: OrderEvent[],
): OrderEvent[] {
  const seen: OrderEvent[] = [];
  const unsubscribe = subscribe((event) => seen.push(event), marketFeedFilter(admin));

  try {
    for (const one of published) publishOrderEvent(one);
  } finally {
    unsubscribe();
  }

  return seen;
}

describe('order event market scope', () => {
  afterEach(() => {
    // A leaked subscriber would make every later test see traffic it should not,
    // and would mean an SSE connection was never released.
    expect(subscriberCount()).toBe(0);
  });

  it('never hands a market account another market’s order', () => {
    const seen = hear(kampala, [event({ marketId: 3, reference: 'MK-OTHER' })]);

    expect(seen).toEqual([]);
  });

  it('still delivers its own market’s orders', () => {
    const own = event({ marketId: 7, reference: 'MK-MINE' });

    expect(hear(kampala, [own])).toEqual([own]);
  });

  it('separates two markets from the same feed', () => {
    const published = [
      event({ marketId: 7, reference: 'MK-KLA' }),
      event({ marketId: 3, reference: 'MK-NKL' }),
    ];

    expect(hear(kampala, published).map((one) => one.reference)).toEqual(['MK-KLA']);
    expect(hear(nakasero, published).map((one) => one.reference)).toEqual(['MK-NKL']);
  });

  it('gives the platform tier the whole feed, which is the point of the tier', () => {
    const published = [
      event({ marketId: 7, reference: 'MK-KLA' }),
      event({ marketId: 3, reference: 'MK-NKL' }),
      event({ marketId: null, reference: 'MK-ORPHAN' }),
    ];

    expect(hear(platform, published).map((one) => one.reference)).toEqual([
      'MK-KLA',
      'MK-NKL',
      'MK-ORPHAN',
    ]);
  });

  it('shows a pre-market order to no market account rather than to every one', () => {
    // An order with no market is old or platform-level data. Broadcasting it to
    // every market to be helpful is the leak this change closes, so the safe
    // answer is the platform tier alone.
    const orphan = event({ marketId: null, reference: 'MK-ORPHAN' });

    expect(hear(kampala, [orphan])).toEqual([]);
    expect(hear(nakasero, [orphan])).toEqual([]);
  });

  it('keeps delivering to the others when one subscriber throws', () => {
    // The registry is shared by every open dashboard, and a route handler that
    // fails mid-write must not silence the feed for everyone else.
    let delivered = 0;
    const broken = subscribe(() => {
      throw new Error('closed stream');
    });
    const healthy = subscribe(() => {
      delivered += 1;
    });

    try {
      publishOrderEvent(event());
    } finally {
      broken();
      healthy();
    }

    expect(delivered).toBe(1);
  });
});
