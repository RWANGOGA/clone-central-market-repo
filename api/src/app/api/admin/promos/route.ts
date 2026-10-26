import { desc, sql } from 'drizzle-orm';
import { db } from '@/db';
import { promoCodes } from '@/db/schema';
import { requireAdmin } from '@/lib/catalogue';
import { guardAdmin } from '@/lib/adminAuth';
import { ownerMarket, visibleMarketFilter } from '@/lib/marketScope';
import { recordActivity } from '@/lib/activity';
import { error, json } from '@/lib/http';
import { csrfCheck } from '@/lib/security';
import { normalizePromoCode, promoInputSchema, promoState, insertPromo } from '@/lib/promotions';

function promoDto(row: typeof promoCodes.$inferSelect) {
  return {
    id: row.id,
    code: row.code,
    description: row.description,
    kind: row.kind,
    value: row.value,
    minSubtotal: row.minSubtotal,
    maxDiscount: row.maxDiscount,
    active: row.active,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    usageLimit: row.usageLimit,
    usedCount: row.usedCount,
    marketId: row.marketId,
    perCustomerLimit: row.perCustomerLimit,
    createdAt: row.createdAt,
    state: promoState(row),
  };
}

export async function GET(request: Request) {
  const admin = await requireAdmin(request);
  if (!admin) return error('Not signed in', 401);

  // A market sees its own codes and the platform's; it never sees another
  // market's promotion, which would tell it what the competition is discounting.
  const rows = await db
    .select()
    .from(promoCodes)
    .where(visibleMarketFilter(admin, promoCodes.marketId))
    .orderBy(desc(promoCodes.createdAt), desc(promoCodes.id));
  return json({ data: rows.map(promoDto) });
}

export async function POST(request: Request) {
  const blocked = csrfCheck(request);
  if (blocked) return blocked;
  const guard = await guardAdmin(request, 'promos.write');
  if (!guard.ok) return error(guard.message, guard.status);
  const admin = guard.admin;

  const parsed = promoInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return error(parsed.error.issues[0]?.message ?? 'Invalid promo', 422);

  const code = normalizePromoCode(parsed.data.code);
  if (!code) return error('Use letters, numbers and dashes, 3 to 32 characters.', 422);

  const clash = await db.query.promoCodes.findFirst({ where: sql`${promoCodes.code} = ${code}` });
  if (clash) return error(`The code ${code} already exists.`, 409);

  const created = await insertPromo({
    ...parsed.data,
    code,
    // Pinned to the caller's market for a market admin; a platform admin may
    // leave it null to issue a code for the whole platform.
    marketId: ownerMarket(admin, parsed.data.marketId),
  });

  await recordActivity({
    action: 'promo.create',
    entity: 'promo',
    entityId: created.id,
    adminId: admin.id,
    marketId: created.marketId,
    after: { code: created.code, kind: created.kind, value: created.value },
  });

  return json({ data: promoDto(created) }, { status: 201 });
}
