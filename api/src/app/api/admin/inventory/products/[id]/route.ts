import { and, eq } from 'drizzle-orm';
import { marketScope } from '@/lib/marketScope';
import { z } from 'zod';
import { db } from '@/db';
import { products } from '@/db/schema';
import { guardAdmin } from '@/lib/adminAuth';
import { LOW_STOCK_THRESHOLD } from '@/lib/stock';
import { StockConflict } from '@/lib/stockErrors';
import { recordMovement } from '@/lib/stockLedger';
import { error, json } from '@/lib/http';
import { recordActivity } from '@/lib/activity';

/**
 * Staff-only stock adjustment.
 *
 * Replaces `PATCH /api/inventory`, which let anyone who could reach the API set
 * stock to any value. The public `GET /api/inventory` stays open, because the
 * shop shows remaining stock to buyers.
 *
 * `delta` is a signed change rather than an absolute figure on purpose: setting
 * a total loses whatever movement produced the previous number. Every call goes
 * through recordMovement, so it also writes a stock_movements row and the
 * ledger stays reconcilable.
 *
 * `reason` is a movement kind, not free text, so "why did this change" can be
 * answered with a filter rather than by reading notes.
 */

const REASONS = ['adjustment', 'waste', 'return', 'correction', 'delivery'] as const;

const patchSchema = z.object({
  // A single adjustment can never move more than ten thousand sale units in
  // one go; anything larger is a typo or a bulk import that should not be done
  // through a stock adjustment.
  delta: z.number().int().min(-10_000).max(10_000),
  reason: z.enum(REASONS),
  note: z.string().max(300).optional(),
});

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Ctx) {
  const guard = await guardAdmin(request, 'inventory.write');
  if (!guard.ok) return error(guard.message, guard.status);
  const admin = guard.admin;

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return error(parsed.error.issues[0]?.message ?? 'Invalid payload', 422);
  }

  const { delta, reason, note } = parsed.data;
  if (delta === 0) return error('delta must not be zero', 422);

  // The reason and the sign must agree: waste removes stock, a delivery or a
  // return adds it. Only a correction or a plain adjustment may go either way.
  if (reason === 'waste' && delta > 0) {
    return error('Waste is recorded as a negative delta.', 422);
  }
  if ((reason === 'delivery' || reason === 'return') && delta < 0) {
    return error(`${reason === 'delivery' ? 'A delivery' : 'A return'} is recorded as a positive delta.`, 422);
  }

  const { id } = await params;
  const key = Number(id);

  const product = await db.query.products.findFirst({
    where: and(
      Number.isInteger(key) ? eq(products.id, key) : eq(products.slug, id),
      marketScope(admin, products.marketId),
    ),
  });
  if (!product) return error(`Product "${id}" not found`, 404);

  const threshold = product.lowStockThreshold ?? LOW_STOCK_THRESHOLD;

  try {
    const result = await recordMovement({
      productId: product.id,
      delta,
      reason,
      note: note ?? null,
      actorAdminId: admin.id,
    });

    await recordActivity({
      action: 'inventory.adjust',
      entity: 'inventory',
      entityId: product.id,
      before: { stock: result.previous, delta, reason },
      after: { stock: result.stock, delta, reason },
      adminId: admin.id,
      adminEmail: admin.email,
    });

    return json({
      data: {
        id: product.id,
        slug: product.slug,
        name: product.name,
        stock: result.stock,
        previous: result.previous,
        delta: result.delta,
        unit: result.unit,
        state: result.state,
        remaining: result.remaining,
        threshold: result.threshold,
        lowStockThreshold: product.lowStockThreshold,
        reorderQuantity: product.reorderQuantity,
        supplierId: product.supplierId,
      },
      meta: { reason, note: note ?? null, adjustedBy: admin.email },
    });
  } catch (err) {
    if (!(err instanceof StockConflict)) throw err;

    return error(
      `Cannot remove ${Math.abs(delta)} from ${product.name}: only ${product.stock}${product.unit} in stock.`,
      409,
    );
  }
}

/** Thresholds, reorder quantity and supplier are set separately from stock. */
const settingsSchema = z.object({
  lowStockThreshold: z.number().int().min(0).max(1_000_000).nullable().optional(),
  reorderQuantity: z.number().int().min(0).max(1_000_000).nullable().optional(),
  supplierId: z.number().int().positive().nullable().optional(),
});

export async function PUT(request: Request, { params }: Ctx) {
  const guard = await guardAdmin(request, 'inventory.write');
  if (!guard.ok) return error(guard.message, guard.status);
  const admin = guard.admin;

  const parsed = settingsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return error(parsed.error.issues[0]?.message ?? 'Invalid payload', 422);

  const { id } = await params;
  const key = Number(id);

  const product = await db.query.products.findFirst({
    where: Number.isInteger(key) ? eq(products.id, key) : eq(products.slug, id),
  });
  if (!product) return error(`Product "${id}" not found`, 404);

  const input = parsed.data;
  const set: Partial<typeof products.$inferInsert> = {};
  if (input.lowStockThreshold !== undefined) set.lowStockThreshold = input.lowStockThreshold;
  if (input.reorderQuantity !== undefined) set.reorderQuantity = input.reorderQuantity;
  if (input.supplierId !== undefined) set.supplierId = input.supplierId;

  const [updated] = await db
    .update(products)
    .set(set)
    .where(eq(products.id, product.id))
    .returning();

  await recordActivity({
    action: 'product.update',
    entity: 'product',
    entityId: updated.id,
    before: {
      lowStockThreshold: product.lowStockThreshold,
      reorderQuantity: product.reorderQuantity,
      supplierId: product.supplierId,
    },
    after: {
      lowStockThreshold: updated.lowStockThreshold,
      reorderQuantity: updated.reorderQuantity,
      supplierId: updated.supplierId,
    },
    adminId: admin.id,
    adminEmail: admin.email,
  });

  return json({
    data: {
      id: updated.id,
      slug: updated.slug,
      name: updated.name,
      stock: updated.stock,
      unit: updated.unit,
      lowStockThreshold: updated.lowStockThreshold,
      reorderQuantity: updated.reorderQuantity,
      supplierId: updated.supplierId,
    },
    meta: { updatedBy: admin.email },
  });
}
