import { and, count, eq, ne, sql } from 'drizzle-orm';
import { db } from '@/db';
import { orders, promoCodes } from '@/db/schema';
import { PromoError, type PromoInput } from '@/lib/promoRules';

/**
 * Database side of discount codes.
 *
 * Validation and redemption happen inside the order transaction and the promo
 * row is locked, so two shoppers racing for the last redemption of a limited
 * code cannot both succeed. The rule evaluation itself lives in promoRules.ts
 * so it can be tested without a database.
 */

export {
  PromoError,
  evaluatePromo,
  normalizePromoCode,
  promoDiscountFor,
  promoInputSchema,
  promoState,
  stampNow,
  toStamp,
} from '@/lib/promoRules';
export type { PromoInput, PromoState } from '@/lib/promoRules';

export type PromoRow = typeof promoCodes.$inferSelect;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Read-only lookup for the "apply code" preview. */
export async function lookupPromo(code: string): Promise<PromoRow | null> {
  const row = await db.query.promoCodes.findFirst({ where: eq(promoCodes.code, code) });
  return row ?? null;
}

/** Locks the promo row for the duration of the order transaction. */
export async function findPromoForUpdate(tx: Tx, code: string): Promise<PromoRow | null> {
  const [row] = await tx.select().from(promoCodes).where(eq(promoCodes.code, code)).for('update');
  return row ?? null;
}

/**
 * Counts non-cancelled orders that already used this code for the same
 * customer id, or the same delivery phone for guests.
 */
export async function promoUsesFor(
  tx: Tx,
  promo: PromoRow,
  customerId: number | null,
  phone: string | null,
): Promise<number> {
  if (promo.perCustomerLimit === null) return 0;
  const scope = customerId ? eq(orders.customerId, customerId) : phone ? eq(orders.phone, phone) : null;
  if (!scope) return 0;
  const [row] = await tx
    .select({ uses: count() })
    .from(orders)
    .where(and(eq(orders.promoCode, promo.code), ne(orders.status, 'cancelled'), scope));
  return Number(row?.uses ?? 0);
}

/**
 * Claims one redemption. The WHERE clause enforces the total limit atomically,
 * so an exhausted code can never be oversold even under load.
 */
export async function redeemPromo(tx: Tx, promo: PromoRow): Promise<number> {
  const [claimed] = await tx
    .update(promoCodes)
    .set({ usedCount: sql`${promoCodes.usedCount} + 1` })
    .where(
      and(
        eq(promoCodes.id, promo.id),
        sql`(${promoCodes.usageLimit} is null or ${promoCodes.usedCount} < ${promoCodes.usageLimit})`,
      ),
    )
    .returning({ usedCount: promoCodes.usedCount });
  if (!claimed) throw new PromoError('This code has just been fully redeemed.');
  return claimed.usedCount;
}

/** Checks the per-customer allowance and claims a redemption in one step. */
export async function claimPromo(
  tx: Tx,
  promo: PromoRow,
  customerId: number | null,
  phone: string | null,
): Promise<void> {
  if (promo.perCustomerLimit !== null) {
    const uses = await promoUsesFor(tx, promo, customerId, phone);
    if (uses >= promo.perCustomerLimit) {
      throw new PromoError(
        promo.perCustomerLimit === 1
          ? 'You have already used this code.'
          : `This code can only be used ${promo.perCustomerLimit} times per customer.`,
      );
    }
  }
  await redeemPromo(tx, promo);
}

/** Persists a new code from validated admin input. */
export async function insertPromo(input: PromoInput): Promise<PromoRow> {
  const [created] = await db.insert(promoCodes).values({
    code: input.code,
    description: input.description ?? '',
    kind: input.kind,
    value: input.value,
    minSubtotal: input.minSubtotal ?? 0,
    maxDiscount: input.maxDiscount ?? null,
    active: input.active ?? true,
    startsAt: input.startsAt ?? null,
    endsAt: input.endsAt ?? null,
    usageLimit: input.usageLimit ?? null,
    perCustomerLimit: input.perCustomerLimit ?? null,
    marketId: input.marketId ?? null,
  }).returning();
  return created;
}
