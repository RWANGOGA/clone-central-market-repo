import { and, count, desc, eq, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { notifications } from '@/db/schema';
import { requireAdmin } from '@/lib/catalogue';
import { error, json } from '@/lib/http';

export const dynamic = 'force-dynamic';

/**
 * Staff notifications.
 *
 * Rows with a null adminId are system alerts (low stock, for example) meant
 * for everyone with a dashboard; rows addressed to one admin are theirs alone.
 */
export async function GET(request: Request) {
  const admin = await requireAdmin(request);
  if (!admin) return error('Not signed in', 401);

  const url = new URL(request.url);
  const unreadOnly = url.searchParams.get('unreadOnly') === 'true';
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 50, 1), 100);

  const audience = or(eq(notifications.adminId, admin.id), isNull(notifications.adminId));
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

  const audience = or(eq(notifications.adminId, admin.id), isNull(notifications.adminId));
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
