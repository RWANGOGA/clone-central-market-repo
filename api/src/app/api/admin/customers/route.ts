import { and, asc, count, desc, eq, inArray, like, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { marketScope } from '@/lib/marketScope';
import { db } from '@/db';
import { customers, orders } from '@/db/schema';
import { guardAdmin } from '@/lib/adminAuth';
import { error, json } from '@/lib/http';

const listSchema = z.object({
  q: z.string().max(120).optional(),
  active: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});

export async function GET(request: Request) {
  // Any signed-in staff member may look a customer up; delivery needs it.
  const guard = await guardAdmin(request);
  if (!guard.ok) return error(guard.message, guard.status);
  const admin = guard.admin;

  const url = new URL(request.url);
  const parsed = listSchema.safeParse({
    q: url.searchParams.get('q') ?? undefined,
    active: url.searchParams.get('active') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
    offset: url.searchParams.get('offset') ?? undefined,
  });
  if (!parsed.success) return error(parsed.error.issues[0]?.message ?? 'Invalid query', 422);

  const { q, active, limit, offset } = parsed.data;

  const filters = [];

  // There is no customer_id column to filter on, because a customer is one
  // account across the platform. A market is shown the people it has
  // actually served, which is the only list it has a right to read.
  if (admin.marketId !== null) filters.push(sql`(SELECT 1 FROM orders o WHERE o.customer_id = ${customers.id} AND o.market_id = ${admin.marketId} LIMIT 1) IS NOT NULL`);
  if (active !== undefined) filters.push(eq(customers.active, active === 'true'));

  if (q && q.trim()) {
    const needle = `%${q.trim().replace(/[%_]/g, '')}%`;
    filters.push(
      or(
        like(customers.fullName, needle),
        like(customers.phone, needle),
        like(customers.email, needle),
      )!,
    );
  }

  const where = filters.length > 0 ? and(...filters) : undefined;

  const [rows, totals] = await Promise.all([
    db
      .select({
        id: customers.id,
        fullName: customers.fullName,
        phone: customers.phone,
        email: customers.email,
        region: customers.region,
        district: customers.district,
        active: customers.active,
        createdAt: customers.createdAt,
      })
      .from(customers)
      .where(where)
      .orderBy(desc(customers.createdAt), desc(customers.id))
      .limit(limit)
      .offset(offset),
    db.select({ n: count() }).from(customers).where(where),
  ]);

  // Live order context per customer, so the list is more than contact details.
  // A market only counts its own orders; the platform tier counts all of them.
  // Lifetime value ignores cancelled orders — money never actually spent.
  const ids = rows.map((row) => row.id);
  const stats = ids.length
    ? await db
        .select({
          customerId: orders.customerId,
          orderCount: count(),
          lastOrderAt: sql<string>`max(${orders.createdAt})`,
          lifetimeValue: sql<number>`coalesce(sum(case when ${orders.status} <> 'cancelled' then ${orders.total} else 0 end), 0)`,
        })
        .from(orders)
        .where(
          and(
            inArray(orders.customerId, ids),
            admin.marketId == null ? undefined : eq(orders.marketId, admin.marketId),
          ),
        )
        .groupBy(orders.customerId)
    : [];

  const byCustomer = new Map(
    stats.map((row) => [
      row.customerId,
      {
        orderCount: Number(row.orderCount),
        lastOrderAt: row.lastOrderAt ?? null,
        lifetimeValue: Number(row.lifetimeValue),
      },
    ]),
  );

  return json({
    data: rows.map((row) => ({
      ...row,
      orderCount: byCustomer.get(row.id)?.orderCount ?? 0,
      lastOrderAt: byCustomer.get(row.id)?.lastOrderAt ?? null,
      lifetimeValue: byCustomer.get(row.id)?.lifetimeValue ?? 0,
    })),
    meta: {
      total: Number(totals[0]?.n ?? 0),
      limit,
      offset,
      returned: rows.length,
    },
  });
}
