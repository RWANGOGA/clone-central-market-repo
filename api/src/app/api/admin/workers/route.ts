import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { marketWorkers } from '@/db/schema';
import { guardAdmin } from '@/lib/adminAuth';
import { marketScope, requestedMarket, targetMarket } from '@/lib/marketScope';
import { recordActivity } from '@/lib/activity';
import { error, json } from '@/lib/http';
import { csrfCheck } from '@/lib/security';

/**
 * The directory of people who work at a market.
 *
 * Deliverers, pickers, drivers and traders are not accounts: they sign in to
 * nothing. The market needs to know who is there, what they do, and whether
 * they can be given work today, so this is a roster rather than an identity —
 * and it is the roster the order queue assigns baskets from.
 *
 * A market never sees another market's roster. Knowing who carries baskets
 * somewhere else is not information a market needs, and it is exactly the kind
 * of detail that would matter to a competitor.
 */

const KINDS = ['deliverer', 'trader', 'picker', 'driver'] as const;

const workerSchema = z.object({
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim().max(40).optional(),
  kind: z.enum(KINDS).default('deliverer'),
  available: z.boolean().default(true),
  marketId: z.number().int().positive().optional(),
});

export async function GET(request: Request) {
  const guard = await guardAdmin(request);
  if (!guard.ok) return error(guard.message, guard.status);
  const admin = guard.admin;

  const url = new URL(request.url);
  const kind = url.searchParams.get('kind');
  const onlyAvailable = url.searchParams.get('available') === 'true';

  // The console may be showing one market, in which case the roster asked for
  // is that market's. A market account asking for somebody else's is refused by
  // `requestedMarket`, so this cannot be pointed at a rival.
  const market = requestedMarket(admin, url.searchParams.get('marketId'));
  if (!market.ok) return error(market.message, 403);

  const filters = [
    market.marketId === null
      ? marketScope(admin, marketWorkers.marketId)
      : eq(marketWorkers.marketId, market.marketId),
  ];
  if (kind && (KINDS as readonly string[]).includes(kind)) {
    filters.push(eq(marketWorkers.kind, kind as (typeof KINDS)[number]));
  }
  if (onlyAvailable) filters.push(eq(marketWorkers.available, true));

  const rows = await db
    .select()
    .from(marketWorkers)
    .where(and(...filters))
    .orderBy(asc(marketWorkers.name));

  return json({
    data: rows,
    meta: {
      total: rows.length,
      available: rows.filter((row) => row.available && row.active).length,
      kinds: KINDS,
    },
  });
}

export async function POST(request: Request) {
  const blocked = csrfCheck(request);
  if (blocked) return blocked;

  const guard = await guardAdmin(request, 'workers.write');
  if (!guard.ok) return error(guard.message, guard.status);
  const admin = guard.admin;

  const parsed = workerSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return error(parsed.error.issues[0]?.message ?? 'A worker needs a name.', 422);
  }

  const marketId = targetMarket(admin, parsed.data.marketId ?? null);
  if (!marketId.ok) return error(marketId.message, 422);

  const [created] = await db
    .insert(marketWorkers)
    .values({
      name: parsed.data.name,
      phone: parsed.data.phone || null,
      kind: parsed.data.kind,
      available: parsed.data.available,
      marketId: marketId.marketId,
      active: true,
    })
    .returning();

  await recordActivity({
    action: 'worker.create',
    entity: 'market_worker',
    entityId: created.id,
    after: { name: created.name, kind: created.kind },
    adminId: admin.id,
    adminEmail: admin.email,
    marketId: created.marketId,
  });

  return json({ data: created, meta: { addedBy: admin.email } }, { status: 201 });
}
