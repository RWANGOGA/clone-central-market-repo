import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { promoCodes } from '@/db/schema';
import { guardAdmin } from '@/lib/adminAuth';
import { marketScope } from '@/lib/marketScope';
import { recordActivity } from '@/lib/activity';
import { error, json } from '@/lib/http';
import { csrfCheck } from '@/lib/security';
import { promoState } from '@/lib/promotions';

type Ctx = { params: Promise<{ id: string }> };

const patchSchema = z.object({ active: z.boolean() }).strict();

/** Pausing a code keeps its history; the rules themselves are immutable. */
export async function PATCH(request: Request, { params }: Ctx) {
  const blocked = csrfCheck(request);
  if (blocked) return blocked;
  const guard = await guardAdmin(request, 'promos.write');
  if (!guard.ok) return error(guard.message, guard.status);
  const admin = guard.admin;

  const { id } = await params;
  const key = Number(id);
  if (!Number.isInteger(key) || key <= 0) return error('Promo not found', 404);

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return error('Say whether the code should be active.', 422);

  const [updated] = await db.update(promoCodes)
    .set({ active: parsed.data.active })
    // Strictly the caller's own market: a market may pause the code it issued,
    // and a platform code it can see stays the platform's to pause.
    .where(and(eq(promoCodes.id, key), marketScope(admin, promoCodes.marketId)))
    .returning();
  if (!updated) return error('Promo not found', 404);

  await recordActivity({
    action: parsed.data.active ? 'promo.resume' : 'promo.pause',
    entity: 'promo',
    entityId: updated.id,
    adminId: admin.id,
    marketId: updated.marketId,
    after: { code: updated.code, active: updated.active },
  });

  return json({
    data: {
      id: updated.id,
      code: updated.code,
      description: updated.description,
      kind: updated.kind,
      value: updated.value,
      minSubtotal: updated.minSubtotal,
      maxDiscount: updated.maxDiscount,
      active: updated.active,
      startsAt: updated.startsAt,
      endsAt: updated.endsAt,
      usageLimit: updated.usageLimit,
      usedCount: updated.usedCount,
      perCustomerLimit: updated.perCustomerLimit,
      createdAt: updated.createdAt,
      state: promoState(updated),
    },
  });
}
