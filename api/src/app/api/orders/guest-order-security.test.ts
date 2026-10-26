import { describe, expect, it, vi } from 'vitest';

const { transaction, insertCalls } = vi.hoisted(() => ({
  transaction: vi.fn(),
  insertCalls: [] as Array<{ table: unknown; values: unknown }>,
}));
const { loadCart } = vi.hoisted(() => ({ loadCart: vi.fn() }));
const { requireCart } = vi.hoisted(() => ({ requireCart: vi.fn() }));
const { getCurrentCustomer } = vi.hoisted(() => ({ getCurrentCustomer: vi.fn() }));
const { checkLocation } = vi.hoisted(() => ({ checkLocation: vi.fn() }));
const { allow } = vi.hoisted(() => ({ allow: vi.fn() }));
const { recordMovement } = vi.hoisted(() => ({ recordMovement: vi.fn() }));
const { publishOrderEvent } = vi.hoisted(() => ({ publishOrderEvent: vi.fn() }));

vi.mock('@/db', () => ({ db: { transaction } }));
vi.mock('@/lib/cart', () => ({ loadCart }));
vi.mock('@/lib/cartOwnership', () => ({ requireCart }));
vi.mock('@/lib/customerSession', () => ({ getCurrentCustomer }));
vi.mock('@/lib/locationGuard', () => ({ checkLocation }));
vi.mock('@/lib/rateLimit', () => ({ allow }));
vi.mock('@/lib/clientIp', () => ({ getClientIp: () => null }));
vi.mock('@/lib/stockLedger', () => ({ recordMovement }));
vi.mock('@/lib/orderEvents', () => ({ publishOrderEvent }));

import { POST } from './route';
import { carts, customers, orderItems, orderStatusEvents, orders } from '@/db/schema';

const newOrder = {
  id: 51,
  reference: 'GRC-ABCDEF1234',
  customerId: null,
  trackingTokenHash: 'hash',
  status: 'pending',
  subtotal: 12000,
  shipping: 23720,
  tax: 990,
  total: 36710,
  currency: 'UGX',
  region: 'Central',
  district: 'Wakiso',
  customerName: 'Guest Shopper',
  createdAt: '2026-10-20 00:00:00',
};

describe('guest order ownership', () => {
  it('creates guest order data without inserting or mutating a customer row', async () => {
    insertCalls.length = 0;
    requireCart.mockResolvedValue({ id: 12, status: 'active', ownerTokenHash: 'cart-owner-hash' });
    getCurrentCustomer.mockResolvedValue(null);
    loadCart.mockResolvedValue({
      id: 12,
      status: 'active',
      subtotal: 12000,
      items: [{ productId: 4, quantity: 2, name: 'Tomato', priceValue: 6000, lineTotal: 12000 }],
    });
    checkLocation.mockResolvedValue({
      ok: true, region: 'Central', district: 'Wakiso', subCounty: null, parish: null, village: null,
    });
    allow.mockResolvedValue(true);
    recordMovement.mockResolvedValue(undefined);
    transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
      let updateCalls = 0;
      const tx = {
        update: (_table: unknown) => ({
          set: (values: { status?: string }) => ({
            where: () => {
              updateCalls += 1;
              return values.status === 'checkout'
                ? { returning: async () => [{ id: 12 }] }
                : Promise.resolve(undefined);
            },
          }),
        }),
        select: () => ({
          from: () => ({
            innerJoin: () => ({
              where: async () => [{ productId: 4, quantity: 2, priceValue: 6000, name: 'Tomato', active: true, marketId: 1 }],
            }),
          }),
        }),
        insert: (table: unknown) => ({
          values: (values: unknown) => {
            insertCalls.push({ table, values });
            return { returning: async () => table === orders ? [newOrder] : undefined };
          },
        }),
      };
      return callback(tx);
    });

    const response = await POST(new Request('http://localhost/api/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: 'mk_cart=owned-token' },
      body: JSON.stringify({
        cartId: 12,
        shipping: {
          fullName: 'Guest Shopper',
          phone: '0772123456',
          address: 'Market Lane',
          region: 'Central',
          district: 'Wakiso',
        },
      }),
    }));

    expect(response.status).toBe(201);
    expect(response.headers.get('set-cookie')).toContain('mk_order_tracking=');
    expect(insertCalls.some((call) => call.table === customers)).toBe(false);
    expect(insertCalls.find((call) => call.table === orders)?.values).toMatchObject({
      customerId: null,
      trackingTokenHash: expect.any(String),
    });
    expect(insertCalls.some((call) => call.table === orderItems)).toBe(true);
    expect(insertCalls.some((call) => call.table === orderStatusEvents)).toBe(true);
    expect(insertCalls.some((call) => call.table === carts)).toBe(false);
  });
});
