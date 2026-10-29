import { and, eq, sql } from 'drizzle-orm';
import { marketScope } from '@/lib/marketScope';
import { db } from '@/db';
import { products, nowText } from '@/db/schema';
import { guardAdmin } from '@/lib/adminAuth';
import { describeStock, stockState } from '@/lib/stock';
import { error, json } from '@/lib/http';
import { recordActivity } from '@/lib/activity';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: Ctx) {
  const guard = await guardAdmin(_request, 'catalogue.write');
  if (!guard.ok) return error(guard.message, guard.status);
  const admin = guard.admin;

  const { id } = await params;
  const key = Number(id);
  const existing = await db.query.products.findFirst({
    where: and(
      Number.isInteger(key) ? eq(products.id, key) : eq(products.slug, id),
      marketScope(admin, products.marketId),
    ),
  });
  if (!existing) return error(`Product "${id}" not found`, 404);
  if (existing.active) return error(`Product "${id}" is already active.`, 409);

  const [updated] = await db
    .update(products)
    .set({ active: true, updatedAt: nowText as unknown as string })
    .where(eq(products.id, existing.id))
    .returning();

  // The withdraw half of this already writes to the trail, and `product.restore`
  // has been in the action list since it was drafted without anything ever
  // emitting it. Bringing a line back is a decision worth naming.
  await recordActivity({
    action: 'product.restore',
    entity: 'product',
    entityId: updated.id,
    before: { active: existing.active },
    after: { active: true },
    adminId: admin.id,
    adminEmail: admin.email,
    marketId: updated.marketId,
  });

  return json({
    data: {
      ...updated,
      stockState: stockState(updated.stock),
      remaining: describeStock(updated.stock, updated.unit),
      images: updated.imageFiles.map((file) => `/api/assets/${file}`),
    },
    meta: {
      restoredBy: admin.email,
      note: 'Product is visible in the catalogue again.',
    },
  });
}
