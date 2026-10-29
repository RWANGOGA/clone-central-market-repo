import { db } from '@/db';
import { notifications, nowText } from '@/db/schema';
import { sql } from 'drizzle-orm';

export type NotificationType = 'order' | 'stock' | 'delivery' | 'system' | 'promotion';

export async function createCustomerNotification(params: {
  customerId: number;
  type: NotificationType;
  title: string;
  message: string;
}) {
  await db.insert(notifications).values({
    customerId: params.customerId,
    type: params.type,
    title: params.title,
    message: params.message,
  });
}

export async function createAdminNotification(params: {
  adminId: number;
  type: NotificationType;
  title: string;
  message: string;
}) {
  await db.insert(notifications).values({
    adminId: params.adminId,
    type: params.type,
    title: params.title,
    message: params.message,
  });
}

export async function createSystemNotification(params: {
  customerId?: number;
  adminId?: number;
  /** The market the alert concerns; omit only for a genuine platform announcement. */
  marketId?: number | null;
  type: NotificationType;
  title: string;
  message: string;
}) {
  const values: Record<string, unknown> = {
    type: params.type,
    title: params.title,
    message: params.message,
  };

  if (params.customerId) values.customerId = params.customerId;
  if (params.adminId) values.adminId = params.adminId;
  // Left unset means the platform issued it. A null here is a boundary, not an
  // absence: a market's own alert has to name its market or it becomes
  // platform-only and that market never sees it.
  if (params.marketId !== undefined) values.marketId = params.marketId;

  await db.insert(notifications).values(values as any);
}
