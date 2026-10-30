import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { carts, orderItems, orderStatusEvents, orders, nowText } from '@/db/schema';
import { recordMovement } from '@/lib/stockLedger';

/**
 * State moves that involve more than the orders row.
 *
 * Every transition is a compare-and-set: the expected status is in the WHERE
 * clause, so two requests racing on the same order cannot both win. Stock and
 * the timeline are written in the caller's transaction so they cannot drift
 * from the status.
 */

type Tx = Pick<typeof db, 'update' | 'insert' | 'select' | 'query' | 'delete'>;

/**
 * Cancel a pending order and hand its goods back through the stock ledger.
 *
 * Returns null when the order was not pending, which is what makes a duplicate
 * cancellation a no-op instead of a second stock return.
 */
export async function cancelPendingOrder(
  tx: Tx,
  orderId: number,
  note: string,
  changedByEmail: string,
) {
  const [cancelled] = await tx
    .update(orders)
    .set({ status: 'cancelled', updatedAt: nowText })
    .where(and(eq(orders.id, orderId), eq(orders.status, 'pending')))
    .returning();

  if (!cancelled) return null;

  await tx.insert(orderStatusEvents).values({
    orderId,
    fromStatus: 'pending',
    toStatus: 'cancelled',
    note,
    changedByEmail,
  });

  const lines = await tx.select().from(orderItems).where(eq(orderItems.orderId, orderId));
  for (const line of lines) {
    await recordMovement(
      {
        productId: line.productId,
        delta: line.quantity,
        reason: 'return',
        reference: cancelled.reference,
        note: `Returned from cancelled order ${cancelled.reference}`,
      },
      tx,
    );
  }

  if (cancelled.cartId) {
    await tx
      .update(carts)
      .set({ status: 'abandoned', updatedAt: nowText })
      .where(eq(carts.id, cancelled.cartId));
  }

  return cancelled;
}
