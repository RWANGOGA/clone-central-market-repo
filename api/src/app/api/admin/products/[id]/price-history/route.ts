import { and, desc, eq } from 'drizzle-orm';
import { marketScope } from '@/lib/marketScope';
import { db } from '@/db';
import { productPriceHistory, products } from '@/db/schema';
import { requireAdmin } from '@/lib/catalogue';
import { error, json } from '@/lib/http';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  const admin = await requireAdmin(_request);
  if (!admin) return error('Not signed in', 401);

  const { id } = await params;
  const key = Number(id);
  const product = await db.query.products.findFirst({
    where: and(
      Number.isInteger(key) ? eq(products.id, key) : eq(products.slug, id),
      marketScope(admin, products.marketId),
    ),
  });
  if (!product) return error(`Product "${id}" not found`, 404);

  const rows = await db
    .select()
    .from(productPriceHistory)
    .where(eq(productPriceHistory.productId, product.id))
    .orderBy(desc(productPriceHistory.createdAt), desc(productPriceHistory.id));

  return json({
    data: rows,
    meta: {
      productId: product.id,
      productName: product.name,
      total: rows.length,
    },
  });
}
