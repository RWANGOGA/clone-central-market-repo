import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { markets } from '@/db/schema';
import { guardAdmin } from '@/lib/adminAuth';
import { slugify } from '@/lib/catalogue';
import { isPlatform } from '@/lib/marketScope';
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

  return json({
    data: rows,
    meta: { total: rows.length, platform: isPlatform(admin) },
  });
}

export async function POST(request: Request) {
  const blocked = csrfCheck(request);
  if (blocked) return blocked;

  const guard = await guardAdmin(request, 'markets.write');
  if (!guard.ok) return error(guard.message, guard.status);
  const admin = guard.admin;

  // The permission says the role is senior enough. This says the account is not
  // a market's owner at all, which is the only kind that may open another.
  if (!isPlatform(admin)) {
    return error('Only a platform owner can open a market. Ask the platform to add yours.', 403);
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
