import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { productPriceHistory, products, nowText } from '@/db/schema';
import { priceLabelFor, productUpdateSchema } from '@/lib/catalogue';
import { guardAdmin } from '@/lib/adminAuth';
import { marketScope, type AdminIdentity } from '@/lib/marketScope';
import { describeStock, stockState } from '@/lib/stock';
import { storeProductImage } from '@/lib/uploads';
import { error, json } from '@/lib/http';
import { recordActivity } from '@/lib/activity';

/**
 * Update or withdraw one product.
 *
 * PATCH changes fields. DELETE withdraws rather than deletes: the row stays so
 * past orders keep referring to something real, and the product can be brought
 * back by setting active to true.
 *
 * Price and unit changes are recorded in `product_price_history` so the full
 * audit trail is queryable without parsing product revisions. Stock is not
 * edited here: it is a cached total owned by the stock ledger, and adjustments
 * must go through `PATCH /api/admin/inventory/products/:id` with a signed delta
 * and a reason.
 */

type Ctx = { params: Promise<{ id: string }> };

/**
 * The product as this account is allowed to see it.
 *
 * A product belonging to another market is answered with 404 rather than 403,
 * because 403 confirms it exists — and the id was the only thing the caller had
 * to guess.
 */
async function findProduct(id: string, admin: AdminIdentity) {
  const key = Number(id);
  return db.query.products.findFirst({
    where: and(
      Number.isInteger(key) ? eq(products.id, key) : eq(products.slug, id),
      marketScope(admin, products.marketId),
    ),
  });
}

function present(row: typeof products.$inferSelect) {
  return {
    ...row,
    stockState: stockState(row.stock),
    remaining: describeStock(row.stock, row.unit),
    images: row.imageFiles.map((file) => `/api/assets/${file}`),
  };
}

export async function PATCH(request: Request, { params }: Ctx) {
  const guard = await guardAdmin(request, 'catalogue.write');
  if (!guard.ok) return error(guard.message, guard.status);
  const admin = guard.admin;

  const { id } = await params;
  const existing = await findProduct(id, admin);
  if (!existing) return error(`Product "${id}" not found`, 404);

  const parsed = productUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return error(parsed.error.issues[0]?.message ?? 'Invalid payload', 422);
  }

  const input = parsed.data;

  // `marketId` is present on the input schema for creation, and deliberately
  // not applied here: moving stock between markets is a reassignment, not an
  // edit, and it is not this route's job to decide who may do it.

  if (input.slug && input.slug !== existing.slug) {
    const clash = await db.query.products.findFirst({ where: sql`${products.slug} = ${input.slug}` });
    if (clash) return error(`Another product already uses the slug "${input.slug}".`, 409);
  }

  if (input.stock !== undefined) {
    return error('Stock is not editable through this route. Use PATCH /api/admin/inventory/products/' + id + ' with a signed delta and a reason.', 422);
  }

  if (input.updatedAt !== undefined && input.updatedAt !== existing.updatedAt) {
    return error('This product was modified by someone else. Please refresh and try again.', 409);
  }

  const set: Partial<typeof products.$inferInsert> = {};

  if (input.name !== undefined) set.name = input.name;
  if (input.slug !== undefined) set.slug = input.slug;
  if (input.description !== undefined) set.description = input.description;
  if (input.farm !== undefined) set.farm = input.farm;
  if (input.location !== undefined) set.location = input.location;
  if (input.dietary !== undefined) set.dietary = input.dietary;
  if (input.active !== undefined) set.active = input.active;

  const priceChanged = input.priceValue !== undefined && input.priceValue !== existing.priceValue;
  const unitChanged = input.unit !== undefined && input.unit !== existing.unit;

  if (input.priceValue !== undefined) set.priceValue = input.priceValue;
  const unit = input.unit ?? existing.unit;
  if (input.priceValue !== undefined || input.unit !== undefined) {
    set.priceLabel = priceLabelFor(input.priceValue ?? existing.priceValue, unit);
  }
  if (input.unit !== undefined) set.unit = input.unit;

  if (input.imageDataUrl) {
    try {
      const stored = await storeProductImage(input.imageDataUrl);
      set.imageFiles = [...existing.imageFiles, `uploads/${stored.filename}`];
    } catch (err) {
      return error(err instanceof Error ? err.message : 'Image could not be stored', 422);
    }
  }

  const updated = await db.transaction(async (tx) => {
    // Compare-and-set on updatedAt: two staff editing the same product cannot
    // silently overwrite each other, and a price history row is only written
    // for a change that actually landed.
    const [row] = await tx
      .update(products)
      .set({ ...set, updatedAt: nowText })
      .where(and(eq(products.id, existing.id), eq(products.updatedAt, existing.updatedAt)))
      .returning();
    if (!row) return null;

    if (priceChanged || unitChanged) {
      await tx.insert(productPriceHistory).values({
        productId: row.id,
        priceValue: row.priceValue,
        unit: row.unit,
        priceLabel: row.priceLabel,
        changedByAdminId: admin.id,
        changedByEmail: admin.email,
      });
    }

    return row;
  });

  if (!updated) {
    return error('This product was modified by someone else. Please refresh and try again.', 409);
  }

  await recordActivity({
    action: 'product.update',
    entity: 'product',
    entityId: updated.id,
    before: {
      name: existing.name,
      priceValue: existing.priceValue,
      unit: existing.unit,
      active: existing.active,
    },
    after: {
      name: updated.name,
      priceValue: updated.priceValue,
      unit: updated.unit,
      active: updated.active,
    },
    adminId: admin.id,
    adminEmail: admin.email,
    marketId: existing.marketId,
  });

  return json({ data: present(updated), meta: { updatedBy: admin.email, priceChanged, unitChanged } });
}

export async function DELETE(request: Request, { params }: Ctx) {
  const guard = await guardAdmin(request, 'catalogue.write');
  if (!guard.ok) return error(guard.message, guard.status);
  const admin = guard.admin;

  const { id } = await params;
  const existing = await findProduct(id, admin);
  if (!existing) return error(`Product "${id}" not found`, 404);

  const [withdrawn] = await db
    .update(products)
    .set({ active: false })
    .where(eq(products.id, existing.id))
    .returning();

  await recordActivity({
    action: 'product.update',
    entity: 'product',
    entityId: withdrawn.id,
    before: { active: existing.active },
    after: { active: false },
    adminId: admin.id,
    adminEmail: admin.email,
    marketId: withdrawn.marketId,
  });

  return json({
    data: present(withdrawn),
    meta: {
      withdrawnBy: admin.email,
      // Said plainly, because the row is still here and can be restored.
      note: 'The row is retained so existing orders keep referring to it. PATCH with { "active": true } to restore.',
    },
  });
}
