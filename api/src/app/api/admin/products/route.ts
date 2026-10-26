import { asc, sql } from 'drizzle-orm';
import { db } from '@/db';
import { products, nowText } from '@/db/schema';
import { productInputSchema, priceLabelFor, requireAdmin, slugify } from '@/lib/catalogue';
import { guardAdmin } from '@/lib/adminAuth';
import { requestedMarket, targetMarket } from '@/lib/marketScope';
import { describeStock, stockState } from '@/lib/stock';
import { storeProductImage } from '@/lib/uploads';
import { error, json } from '@/lib/http';
import { recordActivity } from '@/lib/activity';

/**
 * Catalogue management.
 *
 * Creating a product never touches the rows already here: every write is an
 * insert or a targeted update by id, and removal is a soft delete that flips
 * `active` rather than dropping the row. That matters because order_items and
 * order history reference products, and a hard delete would either break those
 * references or quietly rewrite what a past order said it contained.
 *
 * The whole list is filtered by market before it is sorted, counted or
 * returned, so a market admin's `meta.total` is the size of their shelf and not
 * the platform's.
 */

export async function GET(request: Request) {
  const admin = await requireAdmin(request);
  if (!admin) return error('Not signed in', 401);

  const url = new URL(request.url);
  // Admins see withdrawn products too, otherwise they could never restore one.
  const includeInactive = url.searchParams.get('includeInactive') !== 'false';

  const market = requestedMarket(admin, url.searchParams.get('marketId'));
  if (!market.ok) return error(market.message, 403);

  // The switcher on the console can ask for one market even when the caller
  // spans all of them; a market admin is pinned to its own either way.
  const scope =
    market.marketId === null
      ? undefined
      : sql`${products.marketId} = ${market.marketId}`;

  const rows = await db.select().from(products).where(scope).orderBy(asc(products.name));
  const filtered = includeInactive ? rows : rows.filter((r) => r.active);

  return json({
    data: filtered.map((row) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      description: row.description,
      farm: row.farm,
      location: row.location,
      priceValue: row.priceValue,
      price: row.priceLabel,
      currency: row.currency,
      unit: row.unit,
      stock: row.stock,
      stockState: stockState(row.stock),
      remaining: describeStock(row.stock, row.unit),
      dietary: row.dietary,
      images: row.imageFiles.map((file) => `/api/assets/${file}`),
      active: row.active,
      marketId: row.marketId,
      createdAt: row.createdAt,
    })),
    meta: {
      total: filtered.length,
      active: filtered.filter((r) => r.active).length,
      marketId: market.marketId,
    },
  });
}

export async function POST(request: Request) {
  const guard = await guardAdmin(request, 'catalogue.write');
  if (!guard.ok) return error(guard.message, guard.status);
  const admin = guard.admin;

  const parsed = productInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return error(parsed.error.issues[0]?.message ?? 'Invalid payload', 422);
  }

  const input = parsed.data;

  // A product with no market is a product no market admin can find, so the
  // market is decided here rather than left to a default.
  const marketId = targetMarket(admin, input.marketId ?? null);
  if (!marketId.ok) return error(marketId.message, 422);

  const slug = input.slug ?? slugify(input.name);
  if (!slug) return error('Could not derive a slug from that name. Supply one.', 422);

  const clash = await db.query.products.findFirst({ where: sql`${products.slug} = ${slug}` });
  if (clash) return error(`A product with the slug "${slug}" already exists.`, 409);

  let imageFiles: string[] = [];
  if (input.imageDataUrl) {
    try {
      const stored = await storeProductImage(input.imageDataUrl);
      imageFiles = [`uploads/${stored.filename}`];
    } catch (err) {
      return error(err instanceof Error ? err.message : 'Image could not be stored', 422);
    }
  }

  const [created] = await db
    .insert(products)
    .values({
      slug,
      name: input.name,
      description: input.description,
      farm: input.farm,
      location: input.location,
      priceValue: input.priceValue,
      priceLabel: priceLabelFor(input.priceValue, input.unit),
      currency: 'UGX',
      unit: input.unit,
      stock: input.stock,
      dietary: input.dietary,
      imageFiles,
      marketId: marketId.marketId,
      active: true,
      updatedAt: nowText,
    })
    .returning();

  await recordActivity({
    action: 'product.create',
    entity: 'product',
    entityId: created.id,
    after: { name: created.name, priceValue: created.priceValue, unit: created.unit },
    adminId: admin.id,
    adminEmail: admin.email,
    marketId: created.marketId,
  });

  return json(
    {
      data: {
        ...created,
        remaining: describeStock(created.stock, created.unit),
        stockState: stockState(created.stock),
        images: created.imageFiles.map((file) => `/api/assets/${file}`),
        createdBy: admin.email,
      },
    },
    { status: 201 },
  );
}
