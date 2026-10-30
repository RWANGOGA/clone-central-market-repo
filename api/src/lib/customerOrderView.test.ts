import { describe, expect, it } from 'vitest';
import { customerOrderView, toRefundDto } from './customerOrderView';
import { customerCancelBlocker } from './cancelPolicy';
import type { Order, OrderItem, Payment, Refund } from '@/db/schema';

/**
 * The customer-facing order projection is the place where money, refunds and
 * the right to cancel are decided. These tests pin the two things a customer
 * must never be told wrongly: that they owe nothing when they do, and that
 * they may cancel an order that is already with a rider.
 */

const order = (overrides: Partial<Order> = {}): Order => ({
  id: 1,
  reference: 'MK-1',
  customerId: 7,
  cartId: null,
  trackingTokenHash: 'super-secret-hash',
  status: 'pending',
  subtotal: 20000,
  discount: 0,
  promoCode: null,
  shipping: 0,
  tax: 0,
  total: 20000,
  currency: 'UGX',
  shippingAddress: {
    fullName: 'Probe',
    phone: '0700999888',
    address: 'Probe Road',
    region: 'Central Region',
    district: null,
    subCounty: null,
    parish: null,
    village: null,
  },
  customerName: 'Probe',
  phone: '0700999888',
  region: 'Central Region',
  district: null,
  createdAt: '2026-10-21 09:00:00',
  updatedAt: '2026-10-21 09:00:00',
  ...overrides,
} as Order);

const item = (): OrderItem => ({
  id: 1,
  orderId: 1,
  productId: 1,
  name: 'Tomatoes',
  priceValue: 10000,
  quantity: 2,
  lineTotal: 20000,
  lineStatus: 'included',
  rejectionNote: null,
});

const payment = (overrides: Partial<Payment> = {}): Payment => ({
  id: 1,
  reference: 'PAY-1',
  orderId: 1,
  cartId: null,
  channel: 'mobile_money',
  provider: 'mtn_momo',
  status: 'succeeded',
  amount: 20000,
  currency: 'UGX',
  payerName: 'Probe',
  payerPhone: '0700999888',
  walletId: null,
  maskedCard: null,
  failureReason: null,
  providerRef: null,
  settlementTokenHash: 'secret',
  settledAt: '2026-10-21 09:10:00',
  settledByEmail: 'staff@mu.katale',
  createdAt: '2026-10-21 09:00:00',
  updatedAt: '2026-10-21 09:10:00',
  ...overrides,
} as Payment);

const refund = (overrides: Partial<Refund> = {}): Refund => ({
  id: 1,
  reference: 'RF-1',
  orderId: 1,
  paymentId: 1,
  amount: 5000,
  currency: 'UGX',
  method: 'mobile_money',
  reason: 'Two crates were missing',
  status: 'recorded',
  createdByAdminId: 3,
  createdByEmail: 'manager@mu.katale',
  createdAt: '2026-10-21 10:00:00',
  ...overrides,
} as Refund);

describe('customerOrderView', () => {
  it('carries the derived money state and its label', () => {
    const view = customerOrderView({
      order: order(),
      items: [item()],
      payments: [payment()],
      refunds: [],
      timeline: [],
    });
    expect(view.money.state).toBe('paid');
    expect(view.money.label).toBe('Paid');
    expect(view.money.net).toBe(20000);
  });

  it('drops the tracking-token hash and staff settlement material', () => {
    const view = customerOrderView({
      order: order(),
      items: [item()],
      payments: [payment()],
      refunds: [refund()],
      timeline: [],
    });
    expect('trackingTokenHash' in view).toBe(false);
    expect('settlementTokenHash' in view.payments[0]).toBe(false);
    expect('settledByEmail' in view.payments[0]).toBe(false);
    expect('createdByEmail' in view.refunds[0]).toBe(false);
  });

  it('shows only recorded refunds, so a voided entry never reads as money back', () => {
    const view = customerOrderView({
      order: order({ status: 'cancelled' }),
      items: [item()],
      payments: [payment()],
      refunds: [refund(), refund({ id: 2, reference: 'RF-2', status: 'cancelled' })],
      timeline: [],
    });
    expect(view.refunds).toHaveLength(1);
    expect(view.refunds[0].reference).toBe('RF-1');
  });

  it('flags a cancelled paid order as still owing the customer money', () => {
    const view = customerOrderView({
      order: order({ status: 'cancelled' }),
      items: [item()],
      payments: [payment()],
      refunds: [],
      timeline: [],
    });
    expect(view.money.state).toBe('refund_due');
    expect(view.money.refundDue).toBe(true);
  });

  it('stops offering cancel as soon as picking starts', () => {
    const view = customerOrderView({
      order: order({ status: 'processing' }),
      items: [item()],
      payments: [payment()],
      refunds: [],
      timeline: [],
    });
    expect(view.cancel.allowed).toBe(false);
    expect(view.cancel.reason).toContain('Picking has already started');
  });

  it('allows cancel while the order is only pending', () => {
    const view = customerOrderView({
      order: order(),
      items: [item()],
      payments: [],
      refunds: [],
      timeline: [],
    });
    expect(view.cancel).toEqual({ allowed: true, reason: null });
  });
});

describe('toRefundDto', () => {
  it('keeps what the customer needs and nothing about who authorised it', () => {
    const dto = toRefundDto(refund());
    expect(dto).toEqual({
      reference: 'RF-1',
      amount: 5000,
      currency: 'UGX',
      method: 'mobile_money',
      reason: 'Two crates were missing',
      status: 'recorded',
      createdAt: '2026-10-21 10:00:00',
    });
    expect('createdByEmail' in dto).toBe(false);
  });
});

describe('customerCancelBlocker', () => {
  it('permits only pending, and explains every refusal in its own words', () => {
    expect(customerCancelBlocker('pending')).toBeNull();

    const refused = ['confirmed', 'processing', 'shipped', 'delivered', 'cancelled'];
    const reasons = refused.map((status) => customerCancelBlocker(status));
    for (const reason of reasons) {
      expect(reason).toBeTruthy();
      expect(reason!.endsWith('.')).toBe(true);
    }
    // Five different situations must not collapse into one generic sentence,
    // because the customer's next step differs for each of them.
    expect(new Set(reasons).size).toBe(refused.length);
  });

  it('refuses an unknown status rather than assuming it is safe', () => {
    expect(customerCancelBlocker('teleported')).toContain('cannot be cancelled');
  });
});
