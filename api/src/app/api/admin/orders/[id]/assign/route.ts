import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { marketWorkers, orders } from '@/db/schema';
import { guardAdmin } from '@/lib/adminAuth';
import { findOrder } from '@/lib/orderDetail';
import { recordActivity } from '@/lib/activity';
import { error, json } from '@/lib/http';
import { csrfCheck } from '@/lib/security';

/**
 * Give a delivery to one of the market's people.
 *
 * The worker is not an account and signs in to nothing, so this is the whole of
 * the handover: an admin who can update orders names a deliverer on one. Both
 * sides are checked, because a slip here is how a Kampala basket gets sent from
 * Mbarara — the order and the person must belong to the same market.
 */

type Ctx = { params: Promise<{ id: string }> };

const bodySchema = z
  .object({
    /** null gives the order back to the market, unassigned. */
    delivererId: z.number().int().positive().nullish(),
  })
  .strict();

export async function POST(request: Request, { params }: Ctx) {
  const blocked = csrfCheck(request);
  if (blocked) return blocked;

  const guard = await guardAdmin(request, 'orders.write');
  if (!guard.ok) return error(guard.message, guard.status);
  const admin = guard.admin;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return error(parsed.error.issues[0]?.message ?? 'Name a deliverer, or null to unassign.', 422);
  }

  const { id } = await params;
  const order = await findOrder(id, admin.marketId);
  if (!order) return error(`Order "${id}" not found`, 404);

  const delivererId = parsed.data.delivererId ?? null;

  if (delivererId === null) {
    await db.update(orders).set({ delivererId: null }).where(eq(orders.id, order.id));
    await recordActivity({
      action: 'order.assign',
      entity: 'order',
      entityId: order.id,
      before: { delivererId: order.delivererId },
      after: { delivererId: null },
      adminId: admin.id,
      adminEmail: admin.email,
      marketId: order.marketId,
    });
    return json({ data: { id: order.id, reference: order.reference, delivererId: null } });
  }

  const worker = await db.query.marketWorkers.findFirst({
    where: eq(marketWorkers.id, delivererId),
  });
  if (!worker) return error(`Worker ${delivererId} is not on any roster`, 404);

  if (worker.marketId !== order.marketId) {
    return error(`${worker.name} works at a different market from this order.`, 409);
  }
  if (!worker.active) {
    return error(`${worker.name} is no longer on the roster.`, 409);
  }
  if (worker.kind !== 'deliverer' && worker.kind !== 'driver') {
    return error(`${worker.name} is listed as a ${worker.kind}, not a deliverer.`, 409);
  }

  await db
    .update(orders)
    .set({ delivererId: worker.id })
    .where(eq(orders.id, order.id));

  await recordActivity({
    action: 'order.assign',
    entity: 'order',
    entityId: order.id,
    before: { delivererId: order.delivererId },
    after: { delivererId: worker.id, name: worker.name },
    adminId: admin.id,
    adminEmail: admin.email,
    marketId: order.marketId,
  });

  return json({
    data: { id: order.id, reference: order.reference, delivererId: worker.id, deliverer: worker.name },
    meta: { assignedBy: admin.email },
  });
}
