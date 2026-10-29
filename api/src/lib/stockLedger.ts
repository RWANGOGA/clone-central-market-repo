import { and, eq, sql } from 'drizzle-orm';
import { db, queryRows } from '@/db';
import { notifications, products, stockMovements } from '@/db/schema';
import { LOW_STOCK_THRESHOLD, describeStock, stockState } from './stock';
import { StockConflict } from './stockErrors';

/**
 * The only sanctioned way to change stock.
 *
 * `products.stock` is a cached total; this ledger is the record. Writing the
 * two in one transaction is what keeps SUM(delta) equal to the cached figure,
 * which is the property that turns a number into an explanation.
 *
 * Nothing else should issue an UPDATE against products.stock. Two places did
 * before this existed, and both now come through here.
 */

export type MovementReason =
  | 'opening'
  | 'sale'
  | 'delivery'
  | 'adjustment'
  | 'waste'
  | 'return'
  | 'correction';

export type MovementInput = {
  productId: number;
  /** Signed. Negative leaves stock, positive brings it in. */
  delta: number;
  reason: MovementReason;
  /** Order or purchase order reference, so a movement is traceable. */
  reference?: string | null;
  note?: string | null;
  actorAdminId?: number | null;
  /** Shown in the ledger when no admin is attached, e.g. "customer". */
  actorLabel?: string | null;
};

export type MovementResult = {
  productId: number;
  previous: number;
  stock: number;
  delta: number;
  reason: MovementReason;
  threshold: number;
  state: ReturnType<typeof stockState>;
  remaining: string;
  unit: string;
};

/**
 * Applies one movement. Pass a transaction to join it to a larger unit of
 * work, so an order and its stock draw-down commit or roll back together.
 */
export async function recordMovement(
  input: MovementInput,
  executor: Pick<typeof db, 'update' | 'insert'> = db,
): Promise<MovementResult> {
  const { productId, delta, reason, reference, note, actorAdminId, actorLabel } = input;

  if (!Number.isInteger(delta) || delta === 0) {
    throw new Error('A movement needs a non-zero integer delta.');
  }

  // Conditional on the current level being sufficient, so two concurrent sales
  // cannot both take the last unit.
  const where = and(
    eq(products.id, productId),
    ...(delta < 0 ? [sql`${products.stock} >= ${Math.abs(delta)}`] : []),
  );

  const [updated] = await executor
    .update(products)
    .set({ stock: sql`${products.stock} + ${delta}` })
    .where(where)
    .returning();

  if (!updated) {
    // Either the product does not exist, or there was not enough stock. The
    // caller turns this into a 409 with the product name.
    throw new StockConflict(productId, 'insufficient stock');
  }

  await executor.insert(stockMovements).values({
    productId,
    delta,
    reason,
    reference: reference ?? null,
    note: note ?? null,
    actorAdminId: actorAdminId ?? null,
    actorLabel: actorLabel ?? null,
  });

  const threshold = updated.lowStockThreshold ?? LOW_STOCK_THRESHOLD;

  const previousStock = updated.stock - delta;
  const previousState = stockState(previousStock, threshold);
  const nextState = stockState(updated.stock, threshold);

  // Alert once, on the crossing into low or out. Writing it in the same
  // transaction as the movement means an alert can never describe stock that
  // was rolled back.
  if (nextState !== 'in_stock' && previousState === 'in_stock') {
    await executor.insert(notifications).values({
      type: 'stock',
      // Pinned to the product's market: an unaddressed alert used to reach every
      // market on the platform, which leaked one market's supply position to
      // its competitors.
      marketId: updated.marketId ?? null,
      title: nextState === 'out' ? `Out of stock: ${updated.name}` : `Low stock: ${updated.name}`,
      message: `${updated.name} is at ${updated.stock}${updated.unit}. The reorder level is ${threshold}.`,
    });
  }

  return {
    productId,
    previous: previousStock,
    stock: updated.stock,
    delta,
    reason,
    threshold,
    state: nextState,
    remaining: describeStock(updated.stock, updated.unit, threshold),
    unit: updated.unit,
  };
}

/**
 * Products whose stock has fallen to or below their own threshold.
 *
 * Derived rather than stored: an alert table goes stale the moment stock
 * moves and will disagree with the ledger.
 */
export type LowStockRow = {
  id: number;
  name: string;
  slug: string;
  stock: number;
  unit: string;
  price_label: string;
  threshold: number;
  reorder_quantity: number | null;
};

export type ReconciliationRow = {
  id: number;
  name: string;
  slug: string;
  stock_column: number;
  ledger_total: number;
  drift: number;
};

export async function lowStockProducts(
  marketId?: number | null,
): Promise<LowStockRow[]> {
  // Null is the platform's own view, which is every shelf at once.
  const here = marketId == null ? sql`` : sql`AND p.market_id = ${marketId}`;
  return queryRows<LowStockRow>(sql`
    SELECT
      p.id,
      p.name,
      p.slug,
      p.stock,
      p.unit,
      p.price_label,
      COALESCE(p.low_stock_threshold, ${LOW_STOCK_THRESHOLD}) AS threshold,
      p.reorder_quantity
    FROM products p
    WHERE p.active = true
      AND p.stock <= COALESCE(p.low_stock_threshold, ${LOW_STOCK_THRESHOLD})
      ${here}
    ORDER BY
      CAST(p.stock AS REAL) / NULLIF(COALESCE(p.low_stock_threshold, ${LOW_STOCK_THRESHOLD}), 0) ASC,
      p.name ASC
  `);
}

/**
 * Where the cached stock column and the ledger disagree.
 *
 * Should always be empty. Anything listed is a bug or a write that bypassed
 * recordMovement, which is exactly what this is for.
 */
export async function reconcileStock(
  marketId?: number | null,
): Promise<ReconciliationRow[]> {
  const here = marketId == null ? sql`` : sql`AND p.market_id = ${marketId}`;
  return queryRows<ReconciliationRow>(sql`
    SELECT
      p.id,
      p.name,
      p.slug,
      p.stock AS stock_column,
      COALESCE(SUM(m.delta), 0)::int AS ledger_total,
      (p.stock - COALESCE(SUM(m.delta), 0))::int AS drift
    FROM products p
    LEFT JOIN stock_movements m ON m.product_id = p.id
    WHERE TRUE ${here}
    GROUP BY p.id
    HAVING p.stock <> COALESCE(SUM(m.delta), 0)
    ORDER BY ABS(p.stock - COALESCE(SUM(m.delta), 0)) DESC
  `);
}