import { and, asc, count, desc, eq, gte, inArray, like, lte, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { orderItems, orders, payments, refunds } from '@/db/schema';
import { requireAdmin } from '@/lib/catalogue';
import { marketScope } from '@/lib/marketScope';
import { ORDER_FLOW } from '@/lib/orderFlow';
import { summariseMoney } from '@/lib/orderMoney';
import { error, json } from '@/lib/http';

/**
 * Staff order queue.
 *
 * Replaces `GET /api/orders`, which returned every order with customer name,
 * phone and full address to anyone who asked.
 *
 * Search runs against the denormalised customerName and phone columns rather
 * than the shipping_address JSON, so it can use an index. Results are capped
 * and paginated, because an unbounded list of orders is both slow and a way to
 * pull the whole table in one request.
 */

const ORDER_FLOW_KEYS = Object.keys(ORDER_FLOW) as [
  'pending',
  'processing',
  'shipped',
  'delivered',
  'cancelled',
];

const listSchema = z.object({
  status: z.enum(ORDER_FLOW_KEYS).optional(),
  region: z.string().max(80).optional(),
  q: z.string().max(120).optional(),
  from: z.string().max(40).optional(),
  to: z.string().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});

/** Accepts YYYY-MM-DD or a full ISO timestamp. */
function normaliseDate(value: string): string | null {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return `${trimmed} 00:00:00`;
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().replace('T', ' ').slice(0, 19);
}

export async function GET(request: Request) {
  const admin = await requireAdmin(request);
  if (!admin) return error('Not signed in', 401);

  const url = new URL(request.url);
  const parsed = listSchema.safeParse({
    status: url.searchParams.get('status') ?? undefined,
    region: url.searchParams.get('region') ?? undefined,
    q: url.searchParams.get('q') ?? undefined,
    from: url.searchParams.get('from') ?? undefined,
    to: url.searchParams.get('to') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
    offset: url.searchParams.get('offset') ?? undefined,
  });
  if (!parsed.success) return error(parsed.error.issues[0]?.message ?? 'Invalid query', 422);

  const { status, region, q, from, to, limit, offset } = parsed.data;

  const filters = [];

  // First, before anything the caller can influence: a market's queue is only
  // ever its own orders. `undefined` for the platform tier.
  const scope = marketScope(admin, orders.marketId);
  if (scope) filters.push(scope);

  if (status) filters.push(eq(orders.status, status));
  if (region) filters.push(eq(orders.region, region));

  const fromDate = from ? normaliseDate(from) : null;
  const toDate = to ? normaliseDate(to) : null;
  if (from && !fromDate) return error(`"from" is not a date I understand: ${from}`, 422);
  if (to && !toDate) return error(`"to" is not a date I understand: ${to}`, 422);
  if (fromDate) filters.push(gte(orders.createdAt, fromDate));
  if (toDate) filters.push(lte(orders.createdAt, toDate));

  if (q && q.trim()) {
    // LIKE rather than =, so a partial phone number or a fragment of a name
    // still finds the order. Scoped to the indexed columns.
    const needle = `%${q.trim().replace(/[%_]/g, '')}%`;
    filters.push(
      or(
        like(orders.reference, needle),
        like(orders.phone, needle),
        like(orders.customerName, needle),
      )!,
    );
  }

  const where = filters.length > 0 ? and(...filters) : undefined;

  const [rows, totals] = await Promise.all([
    db
      .select()
      .from(orders)
      .where(where)
      .orderBy(desc(orders.createdAt), desc(orders.id))
      .limit(limit)
      .offset(offset),
    db.select({ n: count() }).from(orders).where(where),
  ]);

  // Line counts for the list, in one query rather than one per order.
  const orderIds = rows.map((row) => row.id);

  const [lineCounts, paymentRows, refundRows] = await Promise.all([
    rows.length
      ? db
          .select({
            orderId: orderItems.orderId,
            lines: count(),
            units: sql<number>`sum(${orderItems.quantity})`,
          })
          .from(orderItems)
          .where(and(...rows.map((row) => eq(orderItems.orderId, row.id))))
          .groupBy(orderItems.orderId)
      : Promise.resolve([]),
    // Money for the whole page in two queries, so each row can show whether
    // cash is still to be collected or a cancelled order owes a refund.
    rows.length
      ? db
          .select({
            orderId: payments.orderId,
            status: payments.status,
            amount: payments.amount,
            currency: payments.currency,
          })
          .from(payments)
          .where(inArray(payments.orderId, orderIds))
      : Promise.resolve([]),
    rows.length
      ? db
          .select({
            orderId: refunds.orderId,
            status: refunds.status,
            amount: refunds.amount,
          })
          .from(refunds)
          .where(inArray(refunds.orderId, orderIds))
      : Promise.resolve([]),
  ]);

  const byOrder = new Map(lineCounts.map((row) => [row.orderId, row]));

  const paymentsByOrder = new Map<
    number,
    { status: (typeof payments.$inferSelect)['status']; amount: number; currency: string }[]
  >();
  for (const row of paymentRows) {
    if (row.orderId == null) continue;
    const list = paymentsByOrder.get(row.orderId) ?? [];
    list.push({ status: row.status, amount: row.amount, currency: row.currency });
    paymentsByOrder.set(row.orderId, list);
  }

  const refundsByOrder = new Map<number, { status: 'recorded' | 'cancelled'; amount: number }[]>();
  for (const row of refundRows) {
    const list = refundsByOrder.get(row.orderId) ?? [];
    list.push({ status: row.status, amount: row.amount });
    refundsByOrder.set(row.orderId, list);
  }

  return json({
    data: rows.map((row) => ({
      id: row.id,
      reference: row.reference,
      status: row.status,
      customerName: row.customerName,
      phone: row.phone,
      region: row.region,
      district: row.district,
      total: row.total,
      currency: row.currency,
      itemCount: byOrder.get(row.id)?.lines ?? 0,
      unitCount: byOrder.get(row.id)?.units ?? 0,
      marketId: row.marketId,
      money: summariseMoney(
        paymentsByOrder.get(row.id) ?? [],
        refundsByOrder.get(row.id) ?? [],
        row.status,
      ),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    })),
    meta: {
      total: Number(totals[0]?.n ?? 0),
      limit,
      offset,
      returned: rows.length,
      // Distinct regions for the filter, so the UI does not need its own list.
      // Restricted to the caller's market, otherwise the filter itself leaks
      // which parts of the country another market is delivering to.
      regions: (
        await db
          .selectDistinct({ region: orders.region })
          .from(orders)
          .where(scope)
          .orderBy(asc(orders.region))
      )
        .map((row) => row.region)
        .filter((value): value is string => typeof value === 'string'),
      filters: { status: status ?? null, region: region ?? null, q: q ?? null, from: from ?? null, to: to ?? null },
    },
  });
}
