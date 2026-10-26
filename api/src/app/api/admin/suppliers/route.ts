import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { products, suppliers } from '@/db/schema';
import { requireAdmin } from '@/lib/catalogue';
import { guardAdmin } from '@/lib/adminAuth';
import { marketScope, targetMarket } from '@/lib/marketScope';
import { error, json } from '@/lib/http';
import { recordActivity } from '@/lib/activity';

/**
 * Suppliers.
 *
 * Stock inflow goes through a purchase order against a supplier rather than
 * through a bare adjustment, so "where did this come from" has an answer and
 * the cost per unit is recorded at the price actually paid.
 */

const supplierSchema = z.object({
  name: z.string().min(2).max(120),
  contactName: z.string().max(120).optional(),
  phone: z.string().max(40).optional(),
  district: z.string().max(80).optional(),
  region: z.string().max(80).optional(),
  marketId: z.number().int().positive().optional(),
});

export async function GET(request: Request) {
  const admin = await requireAdmin(request);
  if (!admin) return error('Not signed in', 401);

  // A supplier is a market's relationship, not a platform fact: the farm that
  // delivers to Kampala is not automatically on Mbarara's books.
  const rows = await db.query.suppliers.findMany({
    where: marketScope(admin, suppliers.marketId),
    orderBy: suppliers.name,
  });

  const linked = await db.query.products.findMany({
    columns: { id: true, supplierId: true },
    where: marketScope(admin, products.marketId),
  });
  const counts = new Map<number, number>();
  for (const product of linked) {
    if (product.supplierId === null) continue;
    counts.set(product.supplierId, (counts.get(product.supplierId) ?? 0) + 1);
  }

  return json({
    data: rows.map((row) => ({ ...row, productCount: counts.get(row.id) ?? 0 })),
    meta: { total: rows.length },
  });
}

export async function POST(request: Request) {
  const guard = await guardAdmin(request, 'suppliers.write');
  if (!guard.ok) return error(guard.message, guard.status);
  const admin = guard.admin;

  const parsed = supplierSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return error(parsed.error.issues[0]?.message ?? 'Invalid payload', 422);

  const name = parsed.data.name.trim();

  const marketId = targetMarket(admin, parsed.data.marketId ?? null);
  if (!marketId.ok) return error(marketId.message, 422);

  const clash = await db.query.suppliers.findFirst({
    // Per market, not global: two markets can each buy from a farm called
    // "Bukalasi", and neither should be told the name is taken.
    where: and(eq(suppliers.name, name), eq(suppliers.marketId, marketId.marketId)),
  });
  if (clash) return error(`A supplier called "${name}" already exists in this market.`, 409);

  const [created] = await db
    .insert(suppliers)
    .values({
      name,
      contactName: parsed.data.contactName?.trim() || null,
      phone: parsed.data.phone?.trim() || null,
      district: parsed.data.district?.trim() || null,
      region: parsed.data.region?.trim() || null,
      marketId: marketId.marketId,
    })
    .returning();

  await recordActivity({
    action: 'supplier.create',
    entity: 'supplier',
    entityId: created.id,
    after: { name: created.name, region: created.region, district: created.district },
    adminId: admin.id,
    adminEmail: admin.email,
    marketId: created.marketId,
  });

  return json({ data: created, meta: { createdBy: admin.email } }, { status: 201 });
}

/** Link a supplier to the products they provide. */
export async function PUT(request: Request) {
  const guard = await guardAdmin(request, 'suppliers.write');
  if (!guard.ok) return error(guard.message, guard.status);
  const admin = guard.admin;

  // The body can only be read once; parsing it twice is why this endpoint
  // used to fail every time.
  const body = await request.json().catch(() => null);
  const parsed = z
    .object({
      supplierId: z.number().int().positive(),
      productIds: z.array(z.number().int().positive()).max(500).default([]),
    })
    .strict()
    .safeParse(body);
  if (!parsed.success) {
    return error(parsed.error.issues[0]?.message ?? 'A supplierId and productIds are required', 422);
  }

  const supplier = await db.query.suppliers.findFirst({
    where: and(eq(suppliers.id, parsed.data.supplierId), marketScope(admin, suppliers.marketId)),
  });
  if (!supplier) return error(`Supplier ${parsed.data.supplierId} not found`, 404);

  const productIds = [...new Set(parsed.data.productIds)];
  if (productIds.length > 0) {
    const found = await db
      .select({ id: products.id })
      .from(products)
      // Scoped, so linking another market's stock to this market's farm is
      // answered as "these products do not exist" rather than as a silent yes.
      .where(and(inArray(products.id, productIds), marketScope(admin, products.marketId)));
    const foundIds = new Set(found.map((row) => row.id));
    const missing = productIds.filter((id) => !foundIds.has(id));
    if (missing.length > 0) {
      return error(`These products do not exist: ${missing.join(', ')}`, 422);
    }

    await db.update(products).set({ supplierId: supplier.id }).where(inArray(products.id, productIds));
  }

  return json({ data: { supplier, linked: productIds }, meta: { updatedBy: admin.email } });
}
