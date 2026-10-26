import { desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/db';
import {
  refunds,
  orderItems,
  orderStatusEvents,
  orders,
  payments,
  type OrderItem,
  type OrderStatusEvent,
  type Payment,
  type Refund,
} from '@/db/schema';
import { getCurrentCustomer } from '@/lib/customerSession';
import { customerOrderView } from '@/lib/customerOrderView';
import { error, json } from '@/lib/http';

/**
 * A customer's own order history.
 *
 * Payments are projected through the shared customer view. The raw rows carry
 * the settlement-token hash, the payer's phone and the gateway reference, none
 * of which belongs in a browser response, and the derived money summary is the
 * same one the single-order endpoint computes, so the two screens cannot
 * disagree about whether an order is paid.
 */
export async function GET(request: Request) {
  const customer = await getCurrentCustomer(request);
  if (!customer) return error('Not signed in', 401);

  const url = new URL(request.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 50, 1), 100);
  const offset = Math.max(Number(url.searchParams.get('offset')) || 0, 0);

  const ordersList = await db
    .select()
    .from(orders)
    .where(eq(orders.customerId, customer.id))
    .orderBy(desc(orders.createdAt))
    .limit(limit)
    .offset(offset);

  const orderIds = ordersList.map((o) => o.id);

  const [allItems, allTimeline, allPayments, allRefunds] = await Promise.all([
    orderIds.length > 0
      ? db.select().from(orderItems).where(inArray(orderItems.orderId, orderIds))
      : Promise.resolve([] as OrderItem[]),
    orderIds.length > 0
      ? db.select().from(orderStatusEvents).where(inArray(orderStatusEvents.orderId, orderIds))
      : Promise.resolve([] as OrderStatusEvent[]),
    orderIds.length > 0
      ? db.select().from(payments).where(inArray(payments.orderId, orderIds))
      : Promise.resolve([] as Payment[]),
    orderIds.length > 0
      ? db.select().from(refunds).where(inArray(refunds.orderId, orderIds))
      : Promise.resolve([] as Refund[]),
  ]);

  // Grouping in one pass keeps this at five queries whatever the page size.
  const itemsByOrder = new Map<number, typeof allItems[number][]>();
  const timelineByOrder = new Map<number, typeof allTimeline[number][]>();
  const paymentsByOrder = new Map<number, typeof allPayments[number][]>();
  const refundsByOrder = new Map<number, typeof allRefunds[number][]>();

  // `orderId` is nullable on payments, because an intent can be created before
  // an order exists. Such a row belongs to no order in this list, so it is
  // dropped rather than filed under a made-up key.
  const bucket = <T extends { orderId: number | null }>(map: Map<number, T[]>, row: T) => {
    if (row.orderId == null) return;
    const arr = map.get(row.orderId) ?? [];
    arr.push(row);
    map.set(row.orderId, arr);
  };

  for (const row of allItems) bucket(itemsByOrder, row);
  for (const row of allTimeline) bucket(timelineByOrder, row);
  for (const row of allPayments) bucket(paymentsByOrder, row);
  for (const row of allRefunds) bucket(refundsByOrder, row);

  const data = ordersList.map((order) =>
    customerOrderView({
      order,
      items: itemsByOrder.get(order.id) ?? [],
      timeline: (timelineByOrder.get(order.id) ?? []).sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      ),
      payments: paymentsByOrder.get(order.id) ?? [],
      refunds: refundsByOrder.get(order.id) ?? [],
    }),
  );

  const totalRow = await db.select({ total: sql<number>`count(*)` }).from(orders).where(eq(orders.customerId, customer.id));

  return json({
    data,
    meta: {
      total: Number(totalRow[0]?.total ?? 0),
      limit,
      offset,
      returned: data.length,
    },
  });
}
