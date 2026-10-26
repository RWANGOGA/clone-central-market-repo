import { describe, expect, it } from 'vitest';
import {
  isInOtherMarket,
  isPlatform,
  ownerMarket,
  requestedMarket,
  targetMarket,
  type AdminIdentity,
} from '@/lib/marketScope';

/**
 * The market boundary, without a database.
 *
 * These are the rules every staff route leans on, so they are tested where they
 * live: a route that forgets the filter is a leak, but a filter that is itself
 * wrong is a leak in every route at once.
 */

const platform: AdminIdentity = {
  id: 1,
  email: 'platform@example.com',
  name: 'Platform Owner',
  role: 'owner',
  marketId: null,
};

const kampala: AdminIdentity = {
  id: 2,
  email: 'kampala@example.com',
  name: 'Kampala Owner',
  role: 'owner',
  marketId: 7,
};

describe('market scope', () => {
  it('treats a null market on an account as the platform tier', () => {
    expect(isPlatform(platform)).toBe(true);
    expect(isPlatform(kampala)).toBe(false);
  });

  it('refuses to say which market a platform account belongs to', () => {
    // The platform tier has no market to be pinned to, so asking whether a row
    // is "in another market" must never be true for it.
    expect(isInOtherMarket(platform, 3)).toBe(false);
    expect(isInOtherMarket(platform, null)).toBe(false);
  });

  it('puts every other market, including an unclaimed row, outside a market', () => {
    expect(isInOtherMarket(kampala, 7)).toBe(false);
    expect(isInOtherMarket(kampala, 8)).toBe(true);
    // A row with no market is not this market's either. Treating null as shared
    // would show pre-market data to everyone.
    expect(isInOtherMarket(kampala, null)).toBe(true);
  });

  it('lets the platform tier ask about any market', () => {
    expect(requestedMarket(platform, null)).toEqual({ ok: true, marketId: null });
    expect(requestedMarket(platform, '3')).toEqual({ ok: true, marketId: 3 });
  });

  it('pins a market account to its own market', () => {
    expect(requestedMarket(kampala, null)).toEqual({ ok: true, marketId: 7 });
    expect(requestedMarket(kampala, '7')).toEqual({ ok: true, marketId: 7 });
    const refused = requestedMarket(kampala, '8');
    expect(refused.ok).toBe(false);
  });

  it('refuses a market id that is not a market at all', () => {
    for (const raw of ['0', '-4', 'seven', '1.5']) {
      expect(requestedMarket(platform, raw).ok).toBe(false);
    }
  });

  it('will not write a row that belongs to no market', () => {
    // Stock nobody sells is invisible to every market admin, so the platform
    // tier has to choose instead of defaulting.
    expect(targetMarket(platform, undefined).ok).toBe(false);
    expect(targetMarket(platform, 4)).toEqual({ ok: true, marketId: 4 });
    expect(targetMarket(kampala, undefined)).toEqual({ ok: true, marketId: 7 });
    // A market admin asking for another market is answered with its own.
    expect(targetMarket(kampala, 9)).toEqual({ ok: true, marketId: 7 });
  });

  it('allows a platform-wide row only for the platform tier', () => {
    expect(ownerMarket(kampala, null)).toBe(7);
    expect(ownerMarket(kampala, 4)).toBe(7);
    expect(ownerMarket(platform, null)).toBeNull();
    expect(ownerMarket(platform, 4)).toBe(4);
  });
});
