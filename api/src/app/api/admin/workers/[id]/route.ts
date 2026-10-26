import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { marketWorkers } from '@/db/schema';
import { guardAdmin } from '@/lib/adminAuth';
import { marketScope } from '@/lib/marketScope';
import { recordActivity } from '@/lib/activity';
import { error, json } from '@/lib/http';
import { csrfCheck } from '@/lib/security';

/**
 * Change one worker's details, or whether they can be given work today.
 *
 * There is no DELETE. A person who leaves does not vanish from the record:
 * `active` is flipped, so the deliveries they made keep naming someone real and
 * the roster can be brought back if they return.
 */

type Ctx = { params: Promise<{ id: string }> };

const KINDS = ['deliverer', 'trader', 'picker', 'driver'] as const;

const patchSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    phone: z.string().trim().max(40).optional(),
    kind: z.enum(KINDS).optional(),
    available: z.boolean().optional(),
    active: z.boolean().optional(),
  })
  .strict();

export async function PATCH(request: Request, { params }: Ctx) {
  const blocked = csrfCheck(request);
  if (blocked) return blocked;

  const guard = await guardAdmin(request, 'workers.write');
  if (!guard.ok) return error(guard.message, guard.status);
  const admin = guard.admin;

  const { id } = await params;
  const key = Number(id);
  if (!Number.isInteger(key) || key <= 0) return error('Worker not found', 404);

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return error(parsed.error.issues[0]?.message ?? 'Nothing to change', 422);
  }

  const existing = await db.query.marketWorkers.findFirst({
    where: and(
      eq(marketWorkers.id, key),
      // Strictly the caller's market: a market cannot edit another's roster,
      // and the platform tier's account spans all of them.
      marketScope(admin, marketWorkers.marketId),
    ),
  });
  if (!existing) return error('Worker not found', 404);

  const [updated] = await db
    .update(marketWorkers)
    .set({
      name: parsed.data.name ?? existing.name,
      phone: parsed.data.phone ?? existing.phone,
      kind: parsed.data.kind ?? existing.kind,
      available: parsed.data.available ?? existing.available,
      active: parsed.data.active ?? existing.active,
    })
    .where(eq(marketWorkers.id, existing.id))
    .returning();

  await recordActivity({
    action: 'worker.update',
    entity: 'market_worker',
    entityId: updated.id,
    before: {
      name: existing.name,
      kind: existing.kind,
      available: existing.available,
      active: existing.active,
    },
    after: { name: updated.name, kind: updated.kind, available: updated.available, active: updated.active },
    adminId: admin.id,
    adminEmail: admin.email,
    marketId: updated.marketId,
  });

  return json({ data: updated });
}
