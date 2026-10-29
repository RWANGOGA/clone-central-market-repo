import { and, count, desc, eq, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { notifications } from '@/db/schema';
import { requireAdmin } from '@/lib/catalogue';
import type { AdminIdentity } from '@/lib/adminAuth';
import { visibleMarketFilter } from '@/lib/marketScope';
import { error, json } from '@/lib/http';

export const dynamic = 'force-dynamic';

/**
 * The notification rows one account is allowed to see.
 *
 * A row addressed to this admin is theirs alone. An unaddressed system alert is
 * bounded by market: a warning raised at Nakasero must not arrive in a Kampala
 * dashboard, because it describes stock the other market does not sell. A null
 * market is a genuine platform announcement and every tier reads it.
 *
 * Shared by the read and the mark-as-read path so neither can drift ahead of the
 * other — a filter that only guards GET would still let `all: true` tick rows
 * from a market the caller cannot see.
 */
function audienceFor(admin: AdminIdentity) {
  const addressed = eq(notifications.adminId, admin.id);
  const broadcast =
    admin.marketId === null
      ? isNull(notifications.adminId)
      : and(
          isNull(notifications.adminId),
          visibleMarketFilter(admin, notifications.marketId),
        );

  return or(addressed, broadcast);
}

/**
 * Staff notifications.
 *
 * Rows with a null adminId are system alerts (low stock, for example) meant for
 * whoever runs the market they were raised about; rows addressed to one admin are
 * theirs alone. See `audienceFor` for the boundary.
 */
export async function GET(request: Request) {
  const admin = await requireAdmin(request);
  if (!admin) return error('Not signed in', 401);

  const url = new URL(request.url);
  const unreadOnly = url.searchParams.get('unreadOnly') === 'true';
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 50, 1), 100);

  const audience = audienceFor(admin);
  const where = unreadOnly ? and(audience, eq(notifications.read, false)) : audience;

  const rows = await db
    .select()
    .from(notifications)
    .where(where)
    .orderBy(desc(notifications.createdAt))
    .limit(limit);

  const unreadCountRow = await db
    .select({ count: sql<number>`count(*)` })
    .from(notifications)
    .where(and(audience, eq(notifications.read, false)));

  return json({
    data: rows,
    meta: {
      total: rows.length,
      unread: Number(unreadCountRow[0]?.count ?? 0),
    },
  });
}

const markSchema = z
  .object({
    id: z.number().int().positive().optional(),
    all: z.boolean().optional(),
  })
  .strict();

/** Mark one notification, or every unread one, as read. */
export async function PATCH(request: Request) {
  const admin = await requireAdmin(request);
  if (!admin) return error('Not signed in', 401);

  const parsed = markSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || (!parsed.data.all && parsed.data.id === undefined)) {
    return error('Send { "id": number } or { "all": true }', 422);
  }

  const audience = audienceFor(admin);
  const where = parsed.data.all
    ? and(audience, eq(notifications.read, false))
    : and(audience, eq(notifications.id, parsed.data.id!));

  const updated = await db
    .update(notifications)
    .set({ read: true })
    .where(where)
    .returning({ id: notifications.id });

  return json({ data: { updated: updated.length } });
}
