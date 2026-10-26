import { and, asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import {
  orderItems,
  orderStatusEvents,
  orders,
  payments,
  refunds,
  type Order,
  type Payment,
} from '@/db/schema';
import { allowedNext } from '@/lib/orderFlow';
import { summariseMoney } from '@/lib/orderMoney';

/**
 * Everything the staff console needs about one order.
 *
 * Kept in one place so fetching an order, collecting cash and recording a
 * refund all answer with the same shape; the client can then replace its
 * selected order with whatever a write returned.
 */
export async function findOrder(
  id: string,
  marketId?: number | null,
): Promise<Order | undefined> {
  const key = Number(id);
  return db.query.orders.findFirst({
    where: and(
      Number.isInteger(key) ? eq(orders.id, key) : eq(orders.reference, id),
      // A market's order is not findable by another market, at any route,
      // because all three staff order routes come through here.
      marketId == null ? undefined : eq(orders.marketId, marketId),
    ),
  });
}

/**
 * A payment as staff need to see it.
 *
 * Payer details are included because a refund may need the phone number, but
 * the wallet identifier, provider reference and settlement token hash are
 * server-side settlement material and stay out of the browser.
 */
export type AdminPaymentDto = {
  id: number;
  reference: string;
  channel: Payment['channel'];
  provider: string;
  status: Payment['status'];
  amount: number;
  currency: string;
  payerName: string | null;
  payerPhone: string | null;
  maskedCard: string | null;
  failureReason: string | null;
  settledAt: string | null;
  settledByEmail: string | null;
  createdAt: string;
  updatedAt: string;
};

export function adminPaymentDto(payment: Payment): AdminPaymentDto {
  return {
    id: payment.id,
    reference: payment.reference,
    channel: payment.channel,
    provider: payment.provider,
    status: payment.status,
    amount: payment.amount,
    currency: payment.currency,
    payerName: payment.payerName,
    payerPhone: payment.payerPhone,
    maskedCard: payment.maskedCard,
    failureReason: payment.failureReason,
    settledAt: payment.settledAt,
    settledByEmail: payment.settledByEmail,
    createdAt: payment.createdAt,
    updatedAt: payment.updatedAt,
  };
}

export async function orderDetail(order: Order) {
  const [items, orderPayments, orderRefunds, timeline] = await Promise.all([
    db.select().from(orderItems).where(eq(orderItems.orderId, order.id)),
    db.select().from(payments).where(eq(payments.orderId, order.id)),
    db
      .select()
      .from(refunds)
      .where(eq(refunds.orderId, order.id))
      .orderBy(asc(refunds.createdAt), asc(refunds.id)),
    db
      .select()
      .from(orderStatusEvents)
      .where(eq(orderStatusEvents.orderId, order.id))
      .orderBy(asc(orderStatusEvents.createdAt), asc(orderStatusEvents.id)),
  ]);

  return {
    ...order,
    items,
    payments: orderPayments.map(adminPaymentDto),
    refunds: orderRefunds,
    money: summariseMoney(orderPayments, orderRefunds, order.status),
    timeline,
    // What staff may do next, so the UI does not re-implement the machine.
    nextStatuses: allowedNext(order.status),
  };
}
