import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { orderItems, orderStatusEvents, orders, payments, refunds } from '@/db/schema';
import { error, json } from '@/lib/http';
import { csrfCheck } from '@/lib/security';
import { getCurrentCustomer } from '@/lib/customerSession';
import { allow } from '@/lib/rateLimit';
import { publishOrderEvent } from '@/lib/orderEvents';
import { cancelOrder, customerCancelBlocker } from '@/lib/orderCancellation';
import { customerOrderView } from '@/lib/customerOrderView';

/**
 * A customer cancelling their own order.
 *
 * There was no way to do this at all: `DELETE` and `PATCH` on an order both
 * answered 405, so a change of mind meant phoning the market. Cancelling is
 * offered only while an order is still `pending` — see
 * `CUSTOMER_CANCELLABLE` for why the later stages are staff-only.
 *
 * Two deliberate limits beyond the status:
 *   - The session cookie proves identity here, not the tracking token. A
 *     tracking link is meant to be opened on a phone that may not be signed in,
 *     and possession of a URL is not a good enough basis for a state change.
 *     Guest orders therefore have no self-service cancel.
 *   - The whole write is one compare-and-set transaction shared with staff, so
 *     cancelling twice cannot put the same goods on the shelf twice.
 */

type Ctx = { params: Promise<{ id: string }> };

const bodySchema = z.object({ reason: z.string().trim().max(500).optional() }).strict();

export async function POST(request: Request, { params }: Ctx) {
  const blocked = csrfCheck(request);
  if (blocked) return blocked;

  const customer = await getCurrentCustomer(request);
  if (!customer) {
    return error('Sign in to cancel an order. A tracking link on its own is not enough.', 401);
  }

  // A cancel is cheap for one order but not for an account that keeps placing
  // and dropping baskets; ten an hour is well past any real change of mind.
  const limited = await allow(`customer-cancel:${customer.id}`, 10, 3600);
  if (!limited) {
    return error('Too many cancellations. Please wait before cancelling another order.', 429);
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    const unknown = parsed.error.issues.find((issue) => issue.code === 'unrecognized_keys');
    if (unknown) {
      const keys = (unknown as { keys?: string[] }).keys ?? [];
      return error(`Unsupported ${keys.length === 1 ? 'field' : 'fields'}: ${keys.join(', ')}`, 422);
    }
    return error('That cancellation note is too long.', 422);
  }

  const { id } = await params;
  const key = Number(id);
  const order = await db.query.orders.findFirst({
    where: Number.isInteger(key) && key > 0 ? eq(orders.id, key) : eq(orders.reference, id),
  });

  // Same answer as a stranger would get: this does not confirm the order
  // exists, only that it is not theirs to cancel.
  if (!order || order.customerId !== customer.id) return error('Order not found', 404);

  // The status gate is enforced here, not merely advertised in the response:
  // once picking starts, only staff may end the order.
  const blocker = customerCancelBlocker(order.status);
  if (blocker) return error(blocker, 409);

  const outcome = await cancelOrder(
    order,
    { kind: 'customer' },
    parsed.data.reason ?? 'Cancelled by the customer',
  );

  if (!outcome.ok) {
    return error(
      'This order moved on while you were cancelling it. Reload to see its current status.',
      409,
    );
  }

  const cancelled = outcome.order;

  // Staff see it immediately rather than at their next refresh.
  publishOrderEvent({
    type: 'order.status',
    id: cancelled.id,
    reference: cancelled.reference,
    from: order.status,
    to: cancelled.status,
    total: cancelled.total,
    currency: cancelled.currency,
    marketId: cancelled.marketId ?? null,
    region: cancelled.region,
    district: cancelled.district,
    customerName: cancelled.customerName,
    at: cancelled.updatedAt,
  });

  const [items, orderPayments, orderRefunds, timeline] = await Promise.all([
    db.select().from(orderItems).where(eq(orderItems.orderId, cancelled.id)),
    db.select().from(payments).where(eq(payments.orderId, cancelled.id)),
    db.select().from(refunds).where(eq(refunds.orderId, cancelled.id)),
    db
      .select()
      .from(orderStatusEvents)
      .where(eq(orderStatusEvents.orderId, cancelled.id))
      .orderBy(orderStatusEvents.createdAt),
  ]);

  const view = customerOrderView({
    order: cancelled,
    items,
    payments: orderPayments,
    refunds: orderRefunds,
    timeline,
  });

  return json({
    data: view,
    meta: {
      stockReturned: outcome.stockReturned,
      // The customer needs to know if the market still holds their money,
      // otherwise "cancelled" reads as "you will see it in your account".
      refundPending: view.money.refundDue,
      refundPendingAmount: view.money.refundDue ? view.money.net : 0,
    },
  });
}
