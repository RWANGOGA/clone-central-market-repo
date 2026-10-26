import { SQL, SQLWrapper, eq, sql } from 'drizzle-orm';
import type { AdminIdentity } from '@/lib/adminAuth';

// Re-exported so a route can name the caller's type without importing the
// auth module twice; the scope helpers are the reason that type is wanted.
export type { AdminIdentity };

/**
 * The market boundary.
 *
 * `admins.role` answers what an account may do. This answers the other half of
 * the question — where it may do it — and the two are independent: a manager of
 * one market is not a manager of the platform, and the platform owner is not
 * "a manager of every market" but something else entirely.
 *
 * A market admin must never be able to read a row that belongs to another
 * market, so the filter is applied to the query rather than to the response.
 * Filtering after the database has answered leaves the row in the payload of
 * some future endpoint that forgets to slice it; a `WHERE` cannot be forgotten
 * in the same way, and it keeps the counts honest.
 *
 * `marketId === null` on an account is the platform tier, which sees everything.
 * The same null on a data row means "predates markets", which the seeder hands
 * to the first market — a null is only ever an absence of boundary on an
 * account, never an invitation to show unowned data to everyone.
 */

/**
 * The market a row belongs to, when "no market" is a legal answer.
 *
 * `targetMarket` refuses an unowned row, which is right for stock: a product
 * nobody sells is invisible. A platform-wide promo is different — it belongs to
 * no market on purpose, because the platform is paying for it. A market admin
 * cannot create one: its `marketId` is always its own.
 */
export function ownerMarket(admin: AdminIdentity, requested: number | null | undefined): number | null {
  return admin.marketId ?? requested ?? null;
}

/**
 * Can this account see this row, given that a null market means "everyone's"?
 *
 * The read-side twin of `ownerMarket`: platform rows are visible to every
 * market, market rows are visible only to the market that issued them.
 */
export function visibleMarketFilter(
  admin: AdminIdentity,
  column: SQLWrapper,
): SQL | undefined {
  if (admin.marketId === null) return undefined;
  return sql`${column} IS NULL OR ${eq(column, admin.marketId)}`;
}

export function isPlatform(admin: AdminIdentity): boolean {
  return admin.marketId === null;
}

/**
 * The `WHERE` fragment restricting a query to what this account can see.
 *
 * Returns `undefined` for the platform tier, which drizzle's `and()` and
 * `where()` treat as "no constraint" — so a list endpoint reads the same
 * whether or not the caller is scoped, and there is nothing to special-case.
 */
export function marketScope(admin: AdminIdentity, column: SQLWrapper): SQL | undefined {
  if (admin.marketId === null) return undefined;
  return eq(column, admin.marketId);
}

/**
 * True when a single row is outside the caller's market.
 *
 * For the `/[id]` routes, where there is no list to filter and the only honest
 * answer is that this record does not exist as far as the caller is concerned.
 */
export function isInOtherMarket(admin: AdminIdentity, rowMarketId: number | null): boolean {
  if (admin.marketId === null) return false;
  return rowMarketId !== admin.marketId;
}

/**
 * The market the caller is asking about, for the platform tier's switcher.
 *
 * Only the platform tier may point a query at a market of its choosing; a
 * market admin is pinned to its own whatever the query string says. Silently
 * ignoring the parameter is not enough — a market admin passing `?marketId=7`
 * and getting a 200 would have no way to learn that the parameter did nothing.
 */
export function requestedMarket(
  admin: AdminIdentity,
  raw: string | null,
): { ok: true; marketId: number | null } | { ok: false; message: string } {
  if (raw === null || raw === '') return { ok: true, marketId: admin.marketId };

  const marketId = Number(raw);
  if (!Number.isInteger(marketId) || marketId <= 0) {
    return { ok: false, message: 'marketId must be a positive integer.' };
  }

  if (admin.marketId !== null && marketId !== admin.marketId) {
    return { ok: false, message: 'Your account can only report on its own market.' };
  }

  return { ok: true, marketId };
}

/**
 * The market a new row should be written into.
 *
 * A market admin's rows belong to its market with no say in the matter. A
 * platform admin must say which market, because "no market" is not something a
 * shop customer should ever be able to be sold by — a null here would make the
 * row invisible to every market admin and is the one mistake this prevents.
 */
export function targetMarket(
  admin: AdminIdentity,
  requested: number | null | undefined,
): { ok: true; marketId: number } | { ok: false; message: string } {
  if (admin.marketId !== null) return { ok: true, marketId: admin.marketId };
  if (requested === null || requested === undefined) {
    return { ok: false, message: 'Choose which market this belongs to.' };
  }
  return { ok: true, marketId: requested };
}
