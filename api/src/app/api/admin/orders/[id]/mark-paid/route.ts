import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { orderStatusEvents, payments, nowText, type Payment } from '@/db/schema';
import { guardAdmin } from '@/lib/adminAuth';
import { findOrder, orderDetail } from '@/lib/orderDetail';
import { recordActivity } from '@/lib/activity';
import { error, json } from '@/lib/http';

/**
 * Record that a mobile-money or wallet payment has actually been received.
 *
 * A payment for one of those channels is created `awaiting_approval`, and until
 * a real gateway exists only a signed webhook may settle it. Production disables
 * the simulated settlement, so an order whose money physically arrived through
 * the MTN / Airtel line had no way to move: it sat pending forever, the confirm
 * gate stayed shut and paid-only views (revenue, customer history) looked empty.
 *
 * This is the operator's answer: the person at the counter checks the merchant
 * line and confirms receipt here. It is the money-axis twin of `collect-cash`
 * (which settles the cash-on-delivery ledger entry) and shares its discipline —
 * a compare-and-set on the outstanding statuses, so two staff tapping at once
 * cannot both settle the same payment, and a full audit trail of who and when.
 *
 * It only moves the payment to `succeeded`. Confirming the goods remains a
 * separate, deliberate step, so the money axis and the fulfilment axis never
 * collapse into one click.
 */

type Ctx = { params: Promise<{ id: string }> };

// The statuses that mean "money has been prompted for but not yet confirmed in."
const AWAITING = ['pending', 'awaiting_approval', 'processing'] as const;

const bodySchema = z.object({
  /** The provider's transaction id, if the operator can read it off the prompt. */
  providerRef: z.string().trim().min(3).max(120).optional(),
});

export async function POST(request: Request, { params }: Ctx) {
  const guard = await guardAdmin(request, 'orders.write');
  if (!guard.ok) return error(guard.message, guard.status);
  const admin = guard.admin;

  const { id } = await params;
  const order = await findOrder(id, admin.marketId);
  if (!order) return error(`Order "${id}" not found`, 404);
  if (order.status === 'cancelled') {
    return error('This order was cancelled. Record a refund instead of marking it paid.', 409);
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return error('That payment reference is not something I can record.', 422);
  const providerRef = parsed.data.providerRef;

  const outstanding = await db
    .select()
    .from(payments)
    .where(and(eq(payments.orderId, order.id), inArray(payments.status, [...AWAITING])));

  if (outstanding.length === 0) {
    return error('No payment is awaiting confirmation on this order.', 409);
  }

  const settled = await db.transaction(async (tx) => {
    const rows: Payment[] = [];
    for (const payment of outstanding) {
      const [row] = await tx
        .update(payments)
        .set({
          status: 'succeeded',
          settledAt: nowText,
          settledByAdminId: admin.id,
          settledByEmail: admin.email,
          // The browser's one-time settlement token dies here; a gateway webhook
          // or this confirmation is the only remaining way to settle.
          settlementTokenHash: null,
          updatedAt: nowText,
          // Never overwrite a reference the provider already reported.
          ...(providerRef && !payment.providerRef ? { providerRef } : {}),
        })
        .where(and(eq(payments.id, payment.id), inArray(payments.status, [...AWAITING])))
        .returning();
      if (row) rows.push(row);
    }

    if (rows.length === 0) return null;

    const total = rows.reduce((sum, payment) => sum + payment.amount, 0);
    const currency = rows[0]?.currency ?? 'UGX';
    const via = rows[0]?.provider ?? 'the provider';

    await tx.insert(orderStatusEvents).values({
      orderId: order.id,
      fromStatus: null,
      toStatus: order.status,
      note: `Payment received via ${via}: ${currency} ${total.toLocaleString('en-US')}${
        providerRef ? ` (${providerRef})` : ''
      }. Confirmed by ${admin.email}.`,
      changedByAdminId: admin.id,
      changedByEmail: admin.email,
    });

    return { total, currency, count: rows.length, via };
  });

  if (!settled) {
    return error('This payment changed while you were working on it. Reload and check.', 409);
  }

  await recordActivity({
    action: 'payment.settle',
    entity: 'order',
    entityId: order.reference,
    before: { money: 'awaiting' },
    after: { money: 'paid', amount: settled.total, currency: settled.currency },
    adminId: admin.id,
    adminEmail: admin.email,
    marketId: order.marketId,
  });

  return json({
    data: await orderDetail(order),
    meta: {
      settled: settled.total,
      currency: settled.currency,
      count: settled.count,
      via: settled.via,
      by: admin.email,
    },
  });
}
