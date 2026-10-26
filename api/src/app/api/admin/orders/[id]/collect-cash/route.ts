import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { orderStatusEvents, payments, nowText, type Payment } from '@/db/schema';
import { guardAdmin } from '@/lib/adminAuth';
import { findOrder, orderDetail } from '@/lib/orderDetail';
import { recordActivity } from '@/lib/activity';
import { error, json } from '@/lib/http';

/**
 * Take cash for a cash-on-delivery order.
 *
 * The payment row is the ledger entry, so collecting is a status change from
 * `cod` to `succeeded` with the person and time recorded. Compare-and-set on
 * `status = 'cod'` means two staff tapping at once cannot both settle it.
 */

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Ctx) {
  const guard = await guardAdmin(request, 'orders.write');
  if (!guard.ok) return error(guard.message, guard.status);
  const admin = guard.admin;

  const { id } = await params;
  const order = await findOrder(id, admin.marketId);
  if (!order) return error(`Order "${id}" not found`, 404);
  if (order.status === 'cancelled') {
    return error('This order was cancelled, so there is no cash to collect.', 409);
  }

  const outstanding = await db
    .select()
    .from(payments)
    .where(and(eq(payments.orderId, order.id), eq(payments.status, 'cod')));

  if (outstanding.length === 0) {
    return error('No cash is outstanding on this order.', 409);
  }

  const collected = await db.transaction(async (tx) => {
    const settled: Payment[] = [];
    for (const payment of outstanding) {
      const [row] = await tx
        .update(payments)
        .set({
          status: 'succeeded',
          settledAt: nowText,
          settledByAdminId: admin.id,
          settledByEmail: admin.email,
          updatedAt: nowText,
        })
        .where(and(eq(payments.id, payment.id), eq(payments.status, 'cod')))
        .returning();
      if (row) settled.push(row);
    }

    if (settled.length === 0) return null;

    const total = settled.reduce((sum, payment) => sum + payment.amount, 0);
    const currency = settled[0]?.currency ?? 'UGX';

    await tx.insert(orderStatusEvents).values({
      orderId: order.id,
      fromStatus: null,
      toStatus: order.status,
      note: `Cash collected: ${currency} ${total.toLocaleString('en-US')}`,
      changedByAdminId: admin.id,
      changedByEmail: admin.email,
    });

    return { total, currency };
  });

  if (!collected) {
    return error('This payment changed while you were working on it. Reload and check.', 409);
  }

  await recordActivity({
    action: 'payment.collect',
    entity: 'order',
    entityId: order.reference,
    before: { money: 'cod_due' },
    after: { money: 'paid', amount: collected.total, currency: collected.currency },
    adminId: admin.id,
    adminEmail: admin.email,
  });

  return json({
    data: await orderDetail(order),
    meta: { collected: collected.total, currency: collected.currency, by: admin.email },
  });
}
