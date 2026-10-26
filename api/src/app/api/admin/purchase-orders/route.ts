import { and, desc, eq } from 'drizzle-orm';
import { marketScope } from '@/lib/marketScope';
import { z } from 'zod';
import { db } from '@/db';
import { purchaseOrderItems, purchaseOrders, suppliers } from '@/db/schema';
import { requireAdmin } from '@/lib/catalogue';
import { guardAdmin } from '@/lib/adminAuth';
import { error, json, parsePositiveInt } from '@/lib/http';
import { recordActivity } from '@/lib/activity';

function makeReference() {
  return `PO-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
}

/**
 * Raise a purchase order.
 *
 * A purchase order is the inflow half of the stock ledger. Receiving one writes
 * the delivery movements; raising it changes nothing about stock, so a draft
 * can be edited freely without the ledger moving.
 */

const lineSchema = z.object({
  productId: z.number().int().positive(),
  quantity: z.number().int().min(1),
  unitPrice: z.number().int().min(0),
});

const createSchema = z.object({
  supplierId: z.number().int().positive(),
  expectedAt: z.string().max(40).optional(),
  note: z.string().max(500).optional(),
  items: z.array(lineSchema).min(1, 'A purchase order needs at least one line.'),
});

export async function GET(request: Request) {
  const admin = await requireAdmin(request);
  if (!admin) return error('Not signed in', 401);

  const url = new URL(request.url);
  const statusFilter = url.searchParams.get('status');
  const id = parsePositiveInt(url.searchParams.get('id'));

  const order = id
    ? await db.query.purchaseOrders.findFirst({
        where: and(eq(purchaseOrders.id, id), marketScope(admin, purchaseOrders.marketId)),
      })
    : null;

  if (id && !order) return error(`Purchase order ${id} not found`, 404);

  if (order) {
    const items = await db.query.purchaseOrderItems.findMany({
      where: (t, { eq: eqOp }) => eqOp(t.purchaseOrderId, order.id),
    });
    return json({ data: { ...order, items } });
  }

  const rows = statusFilter
    ? await db.query.purchaseOrders.findMany({
        where: and(
        eq(purchaseOrders.status, statusFilter as 'draft'),
        marketScope(admin, purchaseOrders.marketId),
      ),
        orderBy: (t, { desc }) => [desc(t.createdAt)],
      })
    : await db.query.purchaseOrders.findMany({
        where: marketScope(admin, purchaseOrders.marketId),
        orderBy: (t, { desc }) => [desc(t.createdAt)],
      });

  return json({ data: rows, meta: { total: rows.length } });
}

export async function POST(request: Request) {
  const guard = await guardAdmin(request, 'suppliers.write');
  if (!guard.ok) return error(guard.message, guard.status);
  const admin = guard.admin;

  const body = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return error(parsed.error.issues[0]?.message ?? 'Invalid payload', 422);

  const supplier = await db.query.suppliers.findFirst({
    where: (t, { and: andOp, eq: eqOp }) =>
      andOp(eqOp(t.id, parsed.data.supplierId), marketScope(admin, t.marketId)),
  });
  if (!supplier) return error(`Supplier ${parsed.data.supplierId} not found`, 404);

  // Resolve every line up front. The unit comes from the catalogue rather than
  // being assumed, and a bad id fails before the transaction opens.
  const lines: { productId: number; quantity: number; unit: string; unitPrice: number }[] = [];
  for (const line of parsed.data.items) {
    const product = await db.query.products.findFirst({
      where: (t, { and: andOp, eq: eqOp }) =>
      andOp(eqOp(t.id, line.productId), marketScope(admin, t.marketId)),
    });
    if (!product) return error(`Product ${line.productId} not found`, 404);
    lines.push({ productId: product.id, quantity: line.quantity, unit: product.unit, unitPrice: line.unitPrice });
  }

  const created = await db.transaction(async (tx) => {
    const [order] = await tx
      .insert(purchaseOrders)
      .values({
        reference: makeReference(),
        supplierId: supplier.id,
        // A replenishment belongs to the market that ordered it, copied from
        // the farm it came from rather than from whoever pressed the button.
        marketId: supplier.marketId,
        status: 'sent',
        expectedAt: parsed.data.expectedAt?.trim() || null,
        note: parsed.data.note?.trim() || null,
        createdByAdminId: admin.id,
      })
      .returning();

    await tx.insert(purchaseOrderItems).values(
      lines.map((line) => ({ purchaseOrderId: order.id, ...line })),
    );

    return order;
  });

  await recordActivity({
    action: 'purchase_order.create',
    entity: 'purchase_order',
    entityId: created.reference,
    after: { supplierId: supplier.id, status: 'sent', items: lines.length },
    adminId: admin.id,
    marketId: created.marketId,
    adminEmail: admin.email,
  });

  return json({ data: created, meta: { createdBy: admin.email, supplier: supplier.name } }, { status: 201 });
}
