import { asc, count, eq, gt } from 'drizzle-orm';
import { marketScope, targetMarket } from '@/lib/marketScope';
import { z } from 'zod';
import { db } from '@/db';
import { adminSessions, admins, nowText } from '@/db/schema';
import { guardAdmin } from '@/lib/adminAuth';
import { adminDto } from '@/lib/adminAccounts';
import { hashPassword } from '@/lib/password';
import { recordActivity } from '@/lib/activity';
import { error, json } from '@/lib/http';

/**
 * Staff accounts.
 *
 * Owner-only: creating an account is the same act as granting a role, so it
 * cannot be delegated to the role it creates. Passwords are hashed here and
 * never returned; the DTO deliberately has no field for them.
 */

const createSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().toLowerCase().email().max(160),
  role: z.enum(['owner', 'manager', 'staff']),
  password: z.string().min(10).max(200),
  /** Ignored for a market admin, which can only staff its own market. */
  marketId: z.number().int().positive().optional(),
});

export async function GET(request: Request) {
  const guard = await guardAdmin(request, 'admins.write');
  if (!guard.ok) return error(guard.message, guard.status);
  const admin = guard.admin;

  const [rows, sessions] = await Promise.all([
    // A market's staff list is its own. Platform accounts, and every other
    // market's team, are not visible here.
    db.select().from(admins).where(marketScope(admin, admins.marketId)).orderBy(asc(admins.id)),
    db
      .select({ adminId: adminSessions.adminId, n: count() })
      .from(adminSessions)
      .where(gt(adminSessions.expiresAt, nowText))
      .groupBy(adminSessions.adminId),
  ]);

  const live = new Map(sessions.map((row) => [row.adminId, Number(row.n)]));

  return json({ data: rows.map((row) => adminDto(row, live.get(row.id) ?? 0)) });
}

export async function POST(request: Request) {
  const guard = await guardAdmin(request, 'admins.write');
  if (!guard.ok) return error(guard.message, guard.status);
  const admin = guard.admin;

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return error(parsed.error.issues[0]?.message ?? 'Invalid account', 422);
  }

  const { name, email, role, password } = parsed.data;

  const marketId = targetMarket(admin, parsed.data.marketId ?? null);
  if (!marketId.ok) return error(marketId.message, 422);

  const existing = await db.query.admins.findFirst({ where: eq(admins.email, email) });
  if (existing) return error('An account with that email already exists.', 409);

  const passwordHash = await hashPassword(password);
  const [created] = await db
    .insert(admins)
    .values({ name, email, passwordHash, role, marketId: marketId.marketId })
    .returning();

  await recordActivity({
    action: 'admin.create',
    entity: 'admin',
    entityId: created.id,
    after: { name: created.name, email: created.email, role: created.role },
    adminId: admin.id,
    marketId: created.marketId,
    adminEmail: admin.email,
  });

  return json({ data: adminDto(created, 0) }, { status: 201 });
}
