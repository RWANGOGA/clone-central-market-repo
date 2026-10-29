import { and, asc, count, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { marketWorkers, markets, orders, products } from '@/db/schema';
import { guardAdmin } from '@/lib/adminAuth';
import { slugify } from '@/lib/catalogue';
import { isPlatform, isSuper } from '@/lib/marketScope';
import { recordActivity } from '@/lib/activity';
import { error, json } from '@/lib/http';
import { csrfCheck } from '@/lib/security';

/**
 * The list of markets on the platform.
 *
 * A platform account reads every market, because opening one and naming its
 * owner is its work. A market account reads only its own — it needs the name
 * for the console header, and nothing else. There is no case in which a market
 * benefits from knowing how many rivals are on the platform or what they are
 * called, so that list is simply not sent.
 */

const createSchema = z.object({
  name: z.string().trim().min(3).max(120),
  slug: z
    .string()
    .trim()
    .max(120)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase words separated by hyphens.')
    .optional(),
  district: z.string().trim().max(80).optional(),
  region: z.string().trim().max(80).optional(),
});

export async function GET(request: Request) {
  const guard = await guardAdmin(request);
  if (!guard.ok) return error(guard.message, guard.status);
  const admin = guard.admin;

  const rows = admin.marketId === null
    ? await db.select().from(markets).orderBy(asc(markets.name))
    : await db.select().from(markets).where(eq(markets.id, admin.marketId)).orderBy(asc(markets.name));

  // A market line is only worth showing next to its weight: what it sells, how
  // much is moving through it, and how many people it has on the roster. The
  // counts are grouped per market in the database, so a platform owner reading
  // the list is not paying one query per market.
  const ids = rows.map((row) => row.id);
  const [catalogue, moving, people] = await Promise.all([
    ids.length
      ? db
          .select({ id: products.marketId, n: count() })
          .from(products)
          .where(and(inArray(products.marketId, ids), eq(products.active, true)))
          .groupBy(products.marketId)
      : Promise.resolve([]),
    ids.length
      ? db
          .select({ id: orders.marketId, n: count() })
          .from(orders)
          .where(
            and(
              inArray(orders.marketId, ids),
              isNotNull(orders.delivererId),
              sql`${orders.status} IN ('processing', 'shipped')`,
            ),
          )
          .groupBy(orders.marketId)
      : Promise.resolve([]),
    ids.length
      ? db
          .select({ id: marketWorkers.marketId, n: count() })
          .from(marketWorkers)
          .where(and(inArray(marketWorkers.marketId, ids), eq(marketWorkers.active, true)))
          .groupBy(marketWorkers.marketId)
      : Promise.resolve([]),
  ]);

  const of = (rows_: { id: number | null; n: number }[]) =>
    new Map(rows_.filter((row) => row.id !== null).map((row) => [row.id as number, Number(row.n)]));
  const stock = of(catalogue);
  const out = of(moving);
  const staff = of(people);

  return json({
    data: rows.map((row) => ({
      ...row,
      products: stock.get(row.id) ?? 0,
      deliveriesInProgress: out.get(row.id) ?? 0,
      workers: staff.get(row.id) ?? 0,
    })),
    meta: { total: rows.length, platform: isPlatform(admin) },
  });
}

export async function POST(request: Request) {
  const blocked = csrfCheck(request);
  if (blocked) return blocked;

  const guard = await guardAdmin(request, 'markets.write');
  if (!guard.ok) return error(guard.message, guard.status);
  const admin = guard.admin;

  // The permission says the role is senior enough. This says the account is the
  // platform itself: opening a market is a super admin's act, not a market
  // owner's, so an owner that somehow carries `markets.write` is still refused.
  if (!isSuper(admin)) {
    return error('Only a super admin can open a market. Ask the platform to add yours.', 403);
  }

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return error(parsed.error.issues[0]?.message ?? 'A market needs a name.', 422);
  }

  const slug = parsed.data.slug ?? slugify(parsed.data.name);
  if (!slug) return error('Could not derive a web address from that name. Give it a slug.', 422);

  const clash = await db.query.markets.findFirst({ where: eq(markets.slug, slug) });
  if (clash) return error(`A market with the address "${slug}" already exists.`, 409);

  const [created] = await db
    .insert(markets)
    .values({
      name: parsed.data.name,
      slug,
      district: parsed.data.district?.trim() || null,
      region: parsed.data.region?.trim() || null,
      active: true,
    })
    .returning();

  await recordActivity({
    action: 'market.create',
    entity: 'market',
    entityId: created.id,
    after: { name: created.name, slug: created.slug },
    adminId: admin.id,
    adminEmail: admin.email,
    // The new market is the subject of the entry, so its trail starts here.
    marketId: created.id,
  });

  return json({ data: created, meta: { openedBy: admin.email } }, { status: 201 });
}
