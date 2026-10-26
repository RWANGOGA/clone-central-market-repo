import { and, eq, inArray } from 'drizzle-orm';
import { marketScope } from '@/lib/marketScope';
import { db } from '@/db';
import { purchaseOrders } from '@/db/schema';
import { guardAdmin } from '@/lib/adminAuth';
import { error, json } from '@/lib/http';
import { recordActivity } from '@/lib/activity';

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Ctx) {
  const guard = await guardAdmin(request, 'suppliers.write');
  if (!guard.ok) return error(guard.message, guard.status);
  const admin = guard.admin;

  const { id } = await params;
  const key = Number(id);
  if (!Number.isInteger(key) || key <= 0) return error('A purchase order id is required', 400);

  const order = await db.query.purchaseOrders.findFirst({
    where: and(eq(purchaseOrders.id, key), marketScope(admin, purchaseOrders.marketId)),
  });
  if (!order) return error(`Purchase order ${id} not found`, 404);

  if (order.status === 'cancelled') {
    return error(`Purchase order ${order.reference} is already cancelled.`, 409);
  }
  if (order.status === 'received') {
    return error(
      `Purchase order ${order.reference} was already received and cannot be cancelled.`,
      409,
    );
  }

  // Compare-and-set against the status that was read. Receiving and cancelling
  // race here: whoever writes first wins, and the loser gets a 409 instead of
  // overwriting a delivery that has already moved stock.
  const [updated] = await db
    .update(purchaseOrders)
    .set({ status: 'cancelled' })
    .where(
      and(
        eq(purchaseOrders.id, order.id),
        eq(purchaseOrders.status, order.status),
        inArray(purchaseOrders.status, ['draft', 'sent']),
      ),
    )
    .returning();

  if (!updated) {
    return error(
      `Purchase order ${order.reference} changed while you were working on it. Reload and check its status.`,
      409,
    );
  }

  await recordActivity({
    action: 'purchase_order.cancel',
    entity: 'purchase_order',
    entityId: order.reference,
    before: { status: order.status },
    after: { status: 'cancelled' },
    adminId: admin.id,
    adminEmail: admin.email,
  });

  return json({
    data: {
      purchaseOrderId: updated.id,
      reference: updated.reference,
      status: updated.status,
    },
    meta: { cancelledBy: admin.email },
  });
}
