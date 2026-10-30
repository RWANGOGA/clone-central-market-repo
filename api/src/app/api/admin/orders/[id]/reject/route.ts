import { randomBytes } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { orderItems, orders, payments, promoCodes, refunds, nowText } from '@/db/schema';
import { guardAdmin } from '@/lib/adminAuth';
import { findOrder, orderDetail } from '@/lib/orderDetail';
import { priceCart } from '@/lib/pricing';
import { promoDiscountFor } from '@/lib/promotions';
import { recordMovement } from '@/lib/stockLedger';
import { StockConflict } from '@/lib/stockErrors';
import { summariseMoney } from '@/lib/orderMoney';
import { recordActivity } from '@/lib/activity';
import { publishOrderEvent } from '@/lib/orderEvents';
import { createCustomerNotification } from '@/lib/notifications';
import { error, json } from '@/lib/http';

/**
 * Refuse one line of an order, and put that line's goods and money back.
 *
 * The testing report asked what happens when an item cannot be supplied, and the
 * three honest answers are: the goods go back on the shelf, the customer stops
 * owing for them, and the row itself is never deleted — it is the record of what
 * was asked for and why it did not happen.
 *
 * Which half of the money moves depends on how the order was paid. Where cash has
 * actually been taken, a refund is recorded for the line; where the money is still
 * owed to a rider, there is nothing to pay back, so the outstanding cash-on-delivery
 * attempt is re-priced to the new total instead. Doing the wrong one of those would
 * either hand back money that was never taken or leave a rider collecting more than
 * the order is now worth.
 */

type Ctx = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  lineId: z.coerce.number().int().positive(),
  /** Why the market cannot supply it. Shown to the customer beside the line. */
  note: z.string().trim().min(3).max(300),
  /** How the customer gets their money back, when money was taken. */
  method: z.enum(['cash', 'mobile_money', 'wallet']).default('cash'),
});

/** Line rejections stop as soon as the goods are on a rider's bike. */
const REJECTABLE = ['pending', 'confirmed'] as const;

export async function POST(request: Request, { params }: Ctx) {
  // Refusing a line spends two authorities: it changes the order and it moves
  // money back. Checking both here means a staff account that can confirm orders
  // cannot quietly authorise refunds by way of a rejection.
  const guard = await guardAdmin(request, 'orders.write');
  if (!guard.ok) return error(guard.message, guard.status);
  const refundGuard = await guardAdmin(request, 'refunds.write');
  if (!refundGuard.ok) return error(refundGuard.message, refundGuard.status);
  const admin = guard.admin;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return error(parsed.error.issues[0]?.message ?? 'A rejection needs the line and a reason.', 422);
  }

  const { id } = await params;
  const order = await findOrder(id, admin.marketId);
  if (!order) return error(`Order "${id}" not found`, 404);

  if (!(REJECTABLE as readonly string[]).includes(order.status)) {
    return error(
      `An order that is ${order.status} is past the point where a line can be refused. Cancel it, or refund the whole order.`,
      409,
    );
  }

  const { lineId, note, method } = parsed.data;

  let outcome:
    | {
        ok: true;
        line: typeof orderItems.$inferSelect;
        totals: { subtotal: number; discount: number; shipping: number; tax: number; total: number };
        cashBack: number;
        refundReference: string | null;
        updated: typeof orders.$inferSelect;
      }
    | { ok: false; reason: 'RACE' | 'NOT_FOUND' | 'ALREADY' | 'STOCK'; line?: typeof orderItems.$inferSelect };

  try {
    outcome = await db.transaction(async (tx) => {
      const line = await tx.query.orderItems.findFirst({
        where: and(eq(orderItems.id, lineId), eq(orderItems.orderId, order.id)),
      });
      if (!line) return { ok: false, reason: 'NOT_FOUND' };
      if (line.lineStatus !== 'included') return { ok: false, reason: 'ALREADY', line };

      // Compare-and-set the line, so two staff accounts rejecting the same line
      // cannot both restock it and both refund it.
      const [flipped] = await tx
        .update(orderItems)
        .set({ lineStatus: 'rejected', rejectionNote: note })
        .where(and(eq(orderItems.id, line.id), eq(orderItems.lineStatus, 'included')))
        .returning();
      if (!flipped) return { ok: false, reason: 'RACE' };

      try {
        await recordMovement(
          {
            productId: line.productId,
            delta: line.quantity,
            reason: 'return',
            reference: order.reference,
            actorLabel: admin.email,
            note: `Returned from rejected line on ${order.reference}`,
          },
          tx,
        );
      } catch (err) {
        // The goods were reserved for this order, so coming back up should always
        // fit. If it does not, somebody has edited stock underneath us and the
        // rejection must not half-apply.
        if (err instanceof StockConflict) return { ok: false, reason: 'STOCK' };
        throw err;
      }

      // Price what the order now holds: every line still marked `included`.
      const remaining = await tx
        .select({ lineTotal: orderItems.lineTotal })
        .from(orderItems)
        .where(and(eq(orderItems.orderId, order.id), eq(orderItems.lineStatus, 'included')));
      const subtotal = remaining.reduce((sum, row) => sum + row.lineTotal, 0);

      // The code was redeemed when the order was placed, so it is re-run for
      // arithmetic only — the same rule that keeps a top-up honest.
      let discount = order.discount;
      if (order.promoCode) {
        const promo = await tx.query.promoCodes.findFirst({
          where: eq(promoCodes.code, order.promoCode),
        });
        if (promo) discount = promoDiscountFor(promo, subtotal);
      }
      const totals = priceCart(subtotal, discount);

      const [updated] = await tx
        .update(orders)
        .set({
          subtotal: totals.subtotal,
          discount: totals.discount,
          shipping: totals.shipping,
          tax: totals.tax,
          total: totals.total,
          updatedAt: nowText,
        })
        .where(eq(orders.id, order.id))
        .returning();

      const [orderPayments, orderRefunds] = await Promise.all([
        tx.select().from(payments).where(eq(payments.orderId, order.id)),
        tx.select().from(refunds).where(eq(refunds.orderId, order.id)),
      ]);
      const money = summariseMoney(orderPayments, orderRefunds, order.status);
      const cashBack = Math.min(line.lineTotal, money.refundable);
      let refundReference: string | null = null;

      if (cashBack > 0) {
        refundReference = `RFD-${randomBytes(5).toString('hex').toUpperCase()}`;
        const succeeded = orderPayments
          .filter((payment) => payment.status === 'succeeded')
          .sort((a, b) => b.id - a.id)[0];
        await tx.insert(refunds).values({
          reference: refundReference,
          orderId: order.id,
          paymentId: succeeded?.id ?? null,
          amount: cashBack,
          currency: succeeded?.currency ?? order.currency,
          method,
          reason: `${line.name} × ${line.quantity} was refused: ${note}`,
          createdByAdminId: admin.id,
          createdByEmail: admin.email,
        });
      }

      // Anything still owed to a rider follows the new total, or the delivery
      // would collect for goods that were never going to arrive.
      await tx
        .update(payments)
        .set({ amount: totals.total, updatedAt: nowText })
        .where(and(eq(payments.orderId, order.id), eq(payments.status, 'cod')));

      // A prompt that is still waiting for approval holds the old figure.
      await tx
        .update(payments)
        .set({
          status: 'cancelled',
          failureReason: 'Basket changed',
          settlementTokenHash: null,
          updatedAt: nowText,
        })
        .where(
          and(
            eq(payments.orderId, order.id),
            inArray(payments.status, ['pending', 'awaiting_approval']),
          ),
        );

      return { ok: true, line: flipped, totals, cashBack, refundReference, updated };
    });
  } catch (err) {
    throw err;
  }

  if (!outcome.ok) {
    if (outcome.reason === 'NOT_FOUND') return error('That line is not on this order.', 404);
    if (outcome.reason === 'ALREADY') return error('That line has already been refused.', 409);
    if (outcome.reason === 'STOCK')
      return error(
        'The stock ledger refused to take those goods back, so nothing was changed. Check the item’s stock figure first.',
        409,
      );
    return error('This order changed while you were working on it. Reload and check it again.', 409);
  }

  const { line, totals, cashBack, refundReference, updated } = outcome;

  await recordActivity({
    action: 'order.reject',
    entity: 'order',
    entityId: order.reference,
    before: { lineStatus: 'included', total: order.total },
    after: {
      lineStatus: 'rejected',
      total: totals.total,
      item: `${line.name} × ${line.quantity}`,
      note,
      refund: refundReference,
    },
    adminId: admin.id,
    adminEmail: admin.email,
  });

  publishOrderEvent({
    type: 'order.updated',
    id: order.id,
    reference: order.reference,
    from: updated.status,
    to: updated.status,
    total: totals.total,
    currency: updated.currency,
    marketId: updated.marketId ?? null,
    region: updated.region,
    district: updated.district,
    customerName: updated.customerName,
    at: updated.updatedAt,
  });

  if (order.customerId) {
    await createCustomerNotification({
      customerId: order.customerId,
      type: 'order',
      title: `We could not supply ${line.name}`,
      message: cashBack > 0
        ? `${line.name} × ${line.quantity} was taken off order ${order.reference} — ${note}. ${updated.currency} ${cashBack.toLocaleString('en-US')} has been paid back to you. The order total is now ${updated.currency} ${totals.total.toLocaleString('en-US')}.`
        : `${line.name} × ${line.quantity} was taken off order ${order.reference} — ${note}. You will not be charged for it: the order total is now ${updated.currency} ${totals.total.toLocaleString('en-US')}.`,
    });
  }

  return json({
    data: await orderDetail(updated),
    meta: {
      rejected: {
        lineId: line.id,
        name: line.name,
        quantity: line.quantity,
        lineTotal: line.lineTotal,
        note,
      },
      cashBack,
      refundReference,
      totals,
      changedBy: admin.email,
    },
  });
}
