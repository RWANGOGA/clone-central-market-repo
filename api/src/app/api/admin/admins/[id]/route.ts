import { and, count, eq, gt, sql } from 'drizzle-orm';
import { marketScope } from '@/lib/marketScope';
import { z } from 'zod';
import { db } from '@/db';
import { adminSessions, admins, markets, nowText } from '@/db/schema';
import { guardAdmin } from '@/lib/adminAuth';
import { adminDto } from '@/lib/adminAccounts';
import { hashPassword } from '@/lib/password';
import { recordActivity } from '@/lib/activity';
import { error, json } from '@/lib/http';

/**
 * Change one staff account.
 *
 * The rules that protect the shop from locking itself out live here rather than
 * in the UI: an owner cannot demote or deactivate themselves, and the last
 * active owner cannot be removed. A password set through this route belongs to
 * somebody else, so it signs that person out everywhere. Changing your own
 * password stays on /admin/password, which verifies the current one first.
 */

type Ctx = { params: Promise<{ id: string }> };

const patchSchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    role: z.enum(['owner', 'manager', 'staff']).optional(),
    active: z.boolean().optional(),
    password: z.string().min(10).max(200).optional(),
    revokeSessions: z.boolean().optional(),
    /** Moving an account between markets. Only a platform account may. */
    marketId: z.number().int().positive().nullish(),
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: 'Nothing to change.',
  });

export async function PATCH(request: Request, { params }: Ctx) {
  const guard = await guardAdmin(request, 'admins.write');
  if (!guard.ok) return error(guard.message, guard.status);
  const admin = guard.admin;

  const { id } = await params;
  const key = Number(id);
  if (!Number.isInteger(key) || key <= 0) return error('Account not found', 404);

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return error(parsed.error.issues[0]?.message ?? 'Invalid change', 422);
  }

  const { name, role, active, password, revokeSessions } = parsed.data;

  const target = await db.query.admins.findFirst({
    where: and(eq(admins.id, key), marketScope(admin, admins.marketId)),
  });
  if (!target) return error('Account not found', 404);

  if (target.id === admin.id) {
    if (active === false) return error('You cannot deactivate your own account.', 422);
    if (role !== undefined && role !== target.role) {
      return error('You cannot change your own role.', 422);
    }
    if (password !== undefined) {
      return error('Use the password form to change your own password.', 422);
    }
  }

  // Moving an account from one market to another is a platform decision: an
  // owner of one market must not be able to lend their team to a rival, nor
  // pull in somebody else's staff.
  let movesTo: number | null | undefined;
  if (parsed.data.marketId !== undefined) {
    if (admin.marketId !== null) {
      return error('Only a platform owner can move an account between markets.', 403);
    }
    movesTo = parsed.data.marketId ?? null;
    if (movesTo !== null) {
      const destination = await db.query.markets.findFirst({ where: eq(markets.id, movesTo) });
      if (!destination) return error(`Market ${movesTo} is not on the platform`, 404);
    }
  }

  const demoting = target.role === 'owner' && role !== undefined && role !== 'owner';
  const deactivating = target.role === 'owner' && active === false;
  if (demoting || deactivating) {
    const [owners] = await db
      .select({ n: count() })
      .from(admins)
      .where(
        and(
          eq(admins.role, 'owner'),
          eq(admins.active, true),
          target.marketId === null
            ? sql`${admins.marketId} IS NULL`
            : eq(admins.marketId, target.marketId),
        ),
      );
    if (Number(owners?.n ?? 0) <= 1) {
      return error('At least one active owner must remain.', 409);
    }
  }

  const passwordHash = password !== undefined ? await hashPassword(password) : undefined;
  // A password change and a deactivation both make existing tokens unsafe.
  const revoking = Boolean(passwordHash) || active === false || revokeSessions === true;

  const updates = {
    ...(name !== undefined ? { name } : {}),
    ...(role !== undefined ? { role } : {}),
    ...(active !== undefined ? { active } : {}),
    ...(passwordHash ? { passwordHash } : {}),
    ...(movesTo !== undefined ? { marketId: movesTo } : {}),
  };

  const updated = await db.transaction(async (tx) => {
    // "Sign out everywhere" changes no column, and an empty UPDATE is invalid.
    let row = target;
    if (Object.keys(updates).length > 0) {
      const [changed] = await tx
        .update(admins)
        .set(updates)
        .where(eq(admins.id, key))
        .returning();
      if (!changed) return null;
      row = changed;
    }

    if (revoking) {
      await tx.delete(adminSessions).where(eq(adminSessions.adminId, key));
    }

    return row;
  });

  if (!updated) return error('Account not found', 404);

  const onlyRevoked =
    revokeSessions === true &&
    name === undefined &&
    role === undefined &&
    active === undefined &&
    password === undefined &&
    parsed.data.marketId === undefined;

  await recordActivity({
    action: onlyRevoked ? 'admin.revoke' : 'admin.update',
    entity: 'admin',
    entityId: key,
    before: { name: target.name, role: target.role, active: target.active },
    after: {
      name: updated.name,
      role: updated.role,
      active: updated.active,
      sessionsRevoked: revoking,
    },
    adminId: admin.id,
    adminEmail: admin.email,
  });

  const [live] = await db
    .select({ n: count() })
    .from(adminSessions)
    .where(and(eq(adminSessions.adminId, key), gt(adminSessions.expiresAt, nowText)));

  return json({ data: adminDto(updated, Number(live?.n ?? 0)) });
}
