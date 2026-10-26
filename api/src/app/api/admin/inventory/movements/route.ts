import { and, count, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { admins, products, stockMovements, nowText } from '@/db/schema';
import { requireAdmin } from '@/lib/catalogue';
import { error, json } from '@/lib/http';

/**
 * The stock ledger, read newest first.
 *
 * This is the answer to "why is this number what it is". Every row is one
 * change with a reason, a reference back to the order or purchase order that
 * caused it, and who made it.
 */

const REASONS = [
  'opening',
  'sale',
  'delivery',
  'adjustment',
  'waste',
  'return',
  'correction',
] as const;

const listSchema = z.object({
  productId: z.coerce.number().int().positive().optional(),
  reason: z.enum(REASONS).optional(),
  reference: z.string().max(80).optional(),
  from: z.string().max(40).optional(),
  to: z.string().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

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
    productId: url.searchParams.get('productId') ?? undefined,
    reason: url.searchParams.get('reason') ?? undefined,
    reference: url.searchParams.get('reference') ?? undefined,
    from: url.searchParams.get('from') ?? undefined,
    to: url.searchParams.get('to') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
    offset: url.searchParams.get('offset') ?? undefined,
  });
  if (!parsed.success) return error(parsed.error.issues[0]?.message ?? 'Invalid query', 422);

  const { productId, reason, reference, from, to, limit, offset } = parsed.data;

  const filters = [];

  // The ledger stores a product id, not a market, so the boundary is the
  // product's. Written as a subquery rather than a join because the summary
  // below runs the same filter without joining products at all.
  if (admin.marketId !== null) {
    filters.push(sql`${stockMovements.productId} IN (SELECT id FROM products WHERE market_id = ${admin.marketId})`);
  }
  if (productId) filters.push(eq(stockMovements.productId, productId));
  if (reason) filters.push(eq(stockMovements.reason, reason));

  if (reference) filters.push(eq(stockMovements.reference, reference));

  const fromDate = from ? normaliseDate(from) : null;
  const toDate = to ? normaliseDate(to) : null;
  if (from && !fromDate) return error(`"from" is not a date I understand: ${from}`, 422);
  if (to && !toDate) return error(`"to" is not a date I understand: ${to}`, 422);
  if (fromDate) filters.push(gte(stockMovements.createdAt, fromDate));
  if (toDate) filters.push(lte(stockMovements.createdAt, toDate));

  const where = filters.length > 0 ? and(...filters) : undefined;

  const rows = await db
    .select({
      id: stockMovements.id,
      productId: stockMovements.productId,
      productName: products.name,
      productSlug: products.slug,
      unit: products.unit,
      delta: stockMovements.delta,
      reason: stockMovements.reason,
      reference: stockMovements.reference,
      note: stockMovements.note,
      actorLabel: stockMovements.actorLabel,
      actorEmail: admins.email,
      createdAt: stockMovements.createdAt,
    })
    .from(stockMovements)
    // Joined for display only. The ledger stores an id, so renaming a product
    // or removing an admin does not rewrite history.
    .leftJoin(products, eq(products.id, stockMovements.productId))
    .leftJoin(admins, eq(admins.id, stockMovements.actorAdminId))
    .where(where)
    .orderBy(desc(stockMovements.createdAt), desc(stockMovements.id))
    .limit(limit)
    .offset(offset);

  // Net movement over the filtered set, which is the number that has to match
  // the change in stock over the same period.
  const summary = await db
    .select({
      movements: sql<number>`count(*)`,
      net: sql<number>`coalesce(sum(${stockMovements.delta}), 0)`,
    })
    .from(stockMovements)
    .where(where);

  return json({
    data: rows,
    meta: {
      total: Number(summary[0]?.movements ?? 0),
      net: Number(summary[0]?.net ?? 0),
      limit,
      offset,
      returned: rows.length,
      reasons: REASONS,
    },
  });
}
