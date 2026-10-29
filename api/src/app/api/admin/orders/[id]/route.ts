import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { orderStatusEvents, orders, payments, nowText, type Order } from '@/db/schema';
import { requireAdmin } from '@/lib/catalogue';
import { guardAdmin } from '@/lib/adminAuth';
import { cancelOrder } from '@/lib/orderCancellation';
import { ORDER_FLOW, allowedNext, canTransition, isOrderStatus } from '@/lib/orderFlow';
import { findOrder, orderDetail } from '@/lib/orderDetail';
import { error, json } from '@/lib/http';
import { publishOrderEvent } from '@/lib/orderEvents';
import { recordActivity } from '@/lib/activity';
import { createCustomerNotification } from '@/lib/notifications';

/**
 * Staff order detail and fulfilment.
 *
 * Replaces an unauthenticated `PATCH /api/orders/:id`, which let anyone who
 * could reach the API mark any order fulfilled or cancelled.
 *
 * Every accepted transition writes an `order_status_events` row in the same
 * transaction as the status change, so the timeline cannot drift from the
 * order's actual state.
 */

type Ctx = { params: Promise<{ id: string }> };

const updateSchema = z.object({
  status: z.string().min(1),
  note: z.string().max(500).optional(),
});

export async function GET(request: Request, { params }: Ctx) {
  const admin = await requireAdmin(request);
  if (!admin) return error('Not signed in', 401);

  const { id } = await params;
  const order = await findOrder(id, admin.marketId);
  if (!order) return error(`Order "${id}" not found`, 404);

  return json({ data: await orderDetail(order) });
}

export async function PATCH(request: Request, { params }: Ctx) {
  const guard = await guardAdmin(request, 'orders.write');
  if (!guard.ok) return error(guard.message, guard.status);
  const admin = guard.admin;

  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return error('A status is required', 422);

  const { status, note } = parsed.data;
  const { id } = await params;
  const existing = await findOrder(id, admin.marketId);
  if (!existing) return error(`Order "${id}" not found`, 404);

  if (!isOrderStatus(status)) {
    return error(
      `"${status}" is not a fulfilment state. Use one of: ${Object.keys(ORDER_FLOW).join(', ')}.`,
      422,
    );
  }

  if (!canTransition(existing.status, status)) {
    const allowed = allowedNext(existing.status);
    return error(
      allowed.length > 0
        ? `An order that is ${existing.status} can only become: ${allowed.join(', ')}.`
        : `An order that is ${existing.status} cannot change.`,
      409,
    );
  }

  // Payment gates fulfilment. Stock is reserved when the order is placed, so a
  // pending order is goods held for someone who has not paid yet; staff must
  // not start picking it on the strength of the order existing.
  if (existing.status === 'pending' && status === 'processing') {
    const paid = await db
      .select({ id: payments.id })
      .from(payments)
      .where(
        and(eq(payments.orderId, existing.id), inArray(payments.status, ['succeeded', 'cod'])),
      )
      .limit(1);
    if (paid.length === 0) {
      return error('This order has not been paid. Take payment before starting fulfilment.', 409);
    }
  }

  // Cash on delivery travels with the goods, so the cash must be in the till
  // before the order is closed as delivered. Collecting it is its own step.
  if (existing.status === 'shipped' && status === 'delivered') {
    const cashOutstanding = await db
      .select({ id: payments.id })
      .from(payments)
      .where(and(eq(payments.orderId, existing.id), eq(payments.status, 'cod')))
      .limit(1);
    if (cashOutstanding.length > 0) {
      return error('Collect the cash for this order before marking it delivered.', 409);
    }
  }

  // Cancelling goes down its own path: it also puts the goods back and closes
  // any payment still in flight. A customer cancelling has to produce exactly
  // the same result, so both call one helper rather than repeating the steps.
  const RACED = 'This order changed while you were working on it. Reload and check its current status.';

  let updated: Order | null;
  let stockReturned = false;

  if (status === 'cancelled') {
    const outcome = await cancelOrder(
      existing,
      { kind: 'admin', adminId: admin.id, adminEmail: admin.email },
      note ?? null,
    );
    if (!outcome.ok) return error(RACED, 409);
    updated = outcome.order;
    stockReturned = outcome.stockReturned;
  } else {
    updated = await db.transaction(async (tx) => {
      // Compare-and-set: the expected status is in the WHERE clause, so a
      // request racing this one loses instead of applying the transition twice.
      const [row] = await tx
        .update(orders)
        .set({ status, updatedAt: nowText })
        .where(and(eq(orders.id, existing.id), eq(orders.status, existing.status)))
        .returning();
      if (!row) return null;

      await tx.insert(orderStatusEvents).values({
        orderId: row.id,
        fromStatus: existing.status,
        toStatus: status,
        note: note ?? null,
        changedByAdminId: admin.id,
        changedByEmail: admin.email,
      });

      return row;
    });
  }

  if (!updated) return error(RACED, 409);

  await recordActivity({
    action: 'order.status',
    entity: 'order',
    entityId: updated.reference,
    before: { status: existing.status },
    after: { status: updated.status },
    adminId: admin.id,
    adminEmail: admin.email,
  });

  const detail = await orderDetail(updated);
  const { money } = detail;

  // Tell any open dashboard, so the queue moves without a refresh.
  publishOrderEvent({
    type: 'order.status',
    id: updated.id,
    reference: updated.reference,
    from: existing.status,
    to: status,
    total: updated.total,
    currency: updated.currency,
    marketId: updated.marketId ?? null,
    region: updated.region,
    district: updated.district,
    customerName: updated.customerName,
    at: updated.updatedAt,
  });

  // Signed-in customers hear about the change in their inbox. Guest orders
  // have no customerId and are tracked by reference instead.
  if (updated.customerId) {
    await createCustomerNotification({
      customerId: updated.customerId,
      type: 'order',
      title:
        status === 'cancelled'
          ? 'Order cancelled'
          : status === 'delivered'
            ? 'Order delivered'
            : status === 'shipped'
              ? 'Order on its way'
              : 'Order update',
      message:
        status === 'cancelled'
          ? money.refundDue
            ? `Order ${updated.reference} was cancelled. Any stock held for it has been returned, and we will contact you about your refund.`
            : `Order ${updated.reference} was cancelled. Any stock held for it has been returned.`
          : `Order ${updated.reference} is now ${status}.`,
    });
  }

  return json({
    data: detail,
    meta: {
      changedBy: admin.email,
      previousStatus: existing.status,
      note: note ?? null,
      // Staff need to know the goods went back, not assume it.
      stockReturned,
      stockReturnNote: stockReturned
        ? 'Each line was returned through the stock ledger, referencing this order.'
        : null,
      // A cancelled order that was already paid still owes the customer money.
      refundDue: money.refundDue,
      refundable: money.refundable,
    },
  });
}
