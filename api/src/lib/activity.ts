import { and, sql } from 'drizzle-orm';
import { db } from '@/db';
import { adminActivityLog, admins, nowText } from '@/db/schema';
import { requireAdmin } from '@/lib/catalogue';
import { marketScope } from '@/lib/marketScope';
import type { AdminIdentity } from '@/lib/adminAuth';
import { error, json } from '@/lib/http';

export type ActivityAction =
  | 'product.create'
  | 'product.update'
  | 'product.restore'
  | 'product.price_history'
  | 'order.status'
  | 'order.sweep'
  | 'order.refund'
  | 'payment.collect'
  | 'inventory.adjust'
  | 'purchase_order.create'
  | 'purchase_order.receive'
  | 'purchase_order.cancel'
  | 'supplier.create'
  | 'promo.create'
  | 'promo.pause'
  | 'promo.resume'
  | 'customer.deactivate'
  | 'admin.create'
  | 'admin.update'
  | 'admin.revoke'
  | 'admin.password_change'
  | 'market.create'
  | 'market.update'
  | 'worker.create'
  | 'worker.update'
  | 'order.assign';

export type ActivityInput = {
  action: ActivityAction;
  entity: string;
  entityId?: string | number;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  adminId?: number | null;
  adminEmail?: string | null;
  /**
   * Which market the event concerns, taken from the caller. Recorded rather
   * than derived so a market's trail survives the account that wrote it being
   * moved to another market later.
   */
  marketId?: number | null;
};

export async function recordActivity(input: ActivityInput) {
  const payload = {
    action: input.action,
    entity: input.entity,
    entityId: input.entityId != null ? String(input.entityId) : null,
    before: input.before ?? null,
    after: input.after ?? null,
    adminId: input.adminId ?? null,
    marketId: input.marketId ?? null,
  };

  await db.insert(adminActivityLog).values(payload);
}

export async function listActivity(filters: {
  adminId?: number;
  action?: string;
  entity?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
  /** The caller, when the trail must be narrowed to one market. */
  admin?: AdminIdentity;
}) {
  const limit = filters.limit ?? 50;
  const offset = filters.offset ?? 0;

  const where = [];
  if (filters.adminId) where.push(sql`${adminActivityLog.adminId} = ${filters.adminId}`);
  if (filters.action) where.push(sql`${adminActivityLog.action} = ${filters.action}`);
  if (filters.entity) where.push(sql`${adminActivityLog.entity} = ${filters.entity}`);
  if (filters.from) where.push(sql`${adminActivityLog.createdAt} >= ${filters.from}`);
  if (filters.to) where.push(sql`${adminActivityLog.createdAt} <= ${filters.to}`);
  // `undefined` for the platform tier, which `and()` drops — so the platform
  // owner reads every market's trail and no one else reads any but their own.
  if (filters.admin) {
    const scope = marketScope(filters.admin, adminActivityLog.marketId);
    if (scope) where.push(scope);
  }

  const rows = await db
    .select({
      id: adminActivityLog.id,
      action: adminActivityLog.action,
      entity: adminActivityLog.entity,
      entityId: adminActivityLog.entityId,
      before: adminActivityLog.before,
      after: adminActivityLog.after,
      adminEmail: admins.email,
      createdAt: adminActivityLog.createdAt,
    })
    .from(adminActivityLog)
    .leftJoin(admins, sql`${admins.id} = ${adminActivityLog.adminId}`)
    .where(where.length > 0 ? and(...where) : undefined)
    .orderBy(sql`${adminActivityLog.createdAt} DESC, ${adminActivityLog.id} DESC`)
    .limit(limit)
    .offset(offset);

  const totalRow = await db
    .select({ total: sql<number>`count(*)` })
    .from(adminActivityLog)
    .where(where.length > 0 ? and(...where) : undefined);

  return { rows, total: Number(totalRow[0]?.total ?? 0) };
}
