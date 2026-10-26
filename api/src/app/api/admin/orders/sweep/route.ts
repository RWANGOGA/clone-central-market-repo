import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import { marketScope } from '@/lib/marketScope';
import { db } from '@/db';
import { orders, payments, nowText } from '@/db/schema';
import { json } from '@/lib/http';
import { guardAdmin } from '@/lib/adminAuth';
import { cancelPendingOrder } from '@/lib/orderLifecycle';
import { createCustomerNotification } from '@/lib/notifications';
import { recordActivity } from '@/lib/activity';

/**
 * Cancel orders that were placed but never paid for.
 *
 * Stock is reserved when the order is created, so an abandoned checkout holds
 * goods hostage until this runs. Cancellation goes through the shared
 * lifecycle helper: it is a compare-and-set on `pending`, it returns every
 * line through the stock ledger, and it marks the cart abandoned. A payment
 * that is still in flight is closed in the same transaction.
 */
export async function POST(request: Request) {
  const guard = await guardAdmin(request, 'orders.write');
  if (!guard.ok) return new Response(guard.message, { status: guard.status });
  const admin = guard.admin;

  const cutoff = sql`to_char(now() at time zone 'utc' - interval '15 minutes', 'YYYY-MM-DD HH24:MI:SS')`;
  const stale = await db
    .select()
    .from(orders)
    // A market sweeps its own unpaid orders; another market's pending order is
    // not ours to cancel.
    .where(and(
      eq(orders.status, 'pending'),
      lt(orders.createdAt, cutoff as any),
      marketScope(admin, orders.marketId),
    ))
    .limit(500);

  let cancelled = 0;
  for (const order of stale) {
    // Any settled attempt keeps the order alive, even if a later attempt
    // failed: the customer has paid.
    const settled = await db
      .select({ id: payments.id })
      .from(payments)
      .where(
        and(eq(payments.orderId, order.id), inArray(payments.status, ['succeeded', 'cod'])),
      )
      .limit(1);
    if (settled.length > 0) continue;

    const result = await db.transaction(async (tx) => {
      const row = await cancelPendingOrder(
        tx,
        order.id,
        'Cancelled automatically: payment not received within 15 minutes',
        'system:sweep',
      );
      if (!row) return null;

      await tx
        .update(payments)
        .set({
          status: 'cancelled',
          failureReason: 'Order expired before payment',
          settlementTokenHash: null,
          updatedAt: nowText,
        })
        .where(
          and(
            eq(payments.orderId, order.id),
            inArray(payments.status, ['pending', 'awaiting_approval', 'processing']),
          ),
        );

      return row;
    });

    if (!result) continue;
    cancelled += 1;

    if (result.customerId) {
      await createCustomerNotification({
        customerId: result.customerId,
        type: 'order',
        title: 'Order cancelled',
        message: `Order ${result.reference} was cancelled because payment was not received. The items are back in stock.`,
      });
    }
  }

  await recordActivity({
    action: 'order.sweep',
    entity: 'order',
    before: null,
    after: { cancelled, considered: stale.length },
    adminId: admin.id,
    adminEmail: admin.email,
  });

  return json({ data: { cancelled, considered: stale.length } });
}
