import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { payments, refunds } from '@/db/schema';
import { guardAdmin } from '@/lib/adminAuth';
import { findOrder, orderDetail } from '@/lib/orderDetail';
import { summariseMoney } from '@/lib/orderMoney';
import { recordActivity } from '@/lib/activity';
import { createCustomerNotification } from '@/lib/notifications';
import { error, json } from '@/lib/http';

/**
 * Record money handed back to a customer.
 *
 * There is no gateway refund API wired up, so this records a refund that staff
 * have already made (cash at the counter, a mobile money send, a wallet
 * transfer). The row is the proof: who authorised it, how, why and when.
 *
 * The amount is checked against the *live* balance — paid minus refunds — so
 * two partial refunds cannot together exceed what the customer paid.
 */

type Ctx = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  amount: z.coerce.number().int().positive().max(100_000_000),
  method: z.enum(['cash', 'mobile_money', 'wallet']),
  reason: z.string().trim().min(3).max(300),
  /** Optional: which payment is being paid back. Defaults to the latest one. */
  paymentId: z.coerce.number().int().positive().optional(),
});

export async function POST(request: Request, { params }: Ctx) {
  const guard = await guardAdmin(request, 'refunds.write');
  if (!guard.ok) return error(guard.message, guard.status);
  const admin = guard.admin;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return error(parsed.error.issues[0]?.message ?? 'A refund needs an amount and a reason.', 422);
  }

  const { amount, method, reason, paymentId } = parsed.data;
  const { id } = await params;
  const order = await findOrder(id, admin.marketId);
  if (!order) return error(`Order "${id}" not found`, 404);

  const [orderPayments, orderRefunds] = await Promise.all([
    db.select().from(payments).where(eq(payments.orderId, order.id)),
    db.select().from(refunds).where(eq(refunds.orderId, order.id)),
  ]);

  const money = summariseMoney(orderPayments, orderRefunds, order.status);
  if (money.refundable <= 0) {
    return error('There is no paid money left to refund on this order.', 409);
  }
  if (amount > money.refundable) {
    return error(
      `Only ${money.currency} ${money.refundable.toLocaleString('en-US')} can still be refunded on this order.`,
      409,
    );
  }

  const succeeded = orderPayments.filter((payment) => payment.status === 'succeeded');
  const payment = paymentId
    ? succeeded.find((item) => item.id === paymentId)
    : [...succeeded].sort((a, b) => b.id - a.id)[0];

  if (paymentId && !payment) {
    return error('That payment is not a settled payment on this order.', 422);
  }

  const reference = `RFD-${randomBytes(5).toString('hex').toUpperCase()}`;

  await db
    .insert(refunds)
    .values({
      reference,
      orderId: order.id,
      paymentId: payment?.id ?? null,
      amount,
      currency: payment?.currency ?? order.currency,
      method,
      reason,
      createdByAdminId: admin.id,
      createdByEmail: admin.email,
    });

  await recordActivity({
    action: 'order.refund',
    entity: 'order',
    entityId: order.reference,
    before: { refundable: money.refundable },
    after: { refunded: amount, reference, method, reason },
    adminId: admin.id,
    adminEmail: admin.email,
  });

  if (order.customerId) {
    await createCustomerNotification({
      customerId: order.customerId,
      type: 'order',
      title: 'Refund recorded',
      message: `${order.currency} ${amount.toLocaleString('en-US')} has been paid back for order ${order.reference}.`,
    });
  }

  return json({
    data: await orderDetail(order),
    meta: {
      refund: { reference, amount, method },
      by: admin.email,
    },
  });
}
