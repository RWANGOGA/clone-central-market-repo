import { requireAdmin } from '@/lib/catalogue';
import { lowStockProducts, reconcileStock } from '@/lib/stockLedger';
import { json } from '@/lib/http';

/**
 * Two questions staff actually ask, answered from the ledger rather than from
 * a stored summary:
 *
 *  what needs reordering, and does stock still reconcile
 *
 * Low stock is derived, never stored. An alert table goes stale the moment
 * stock moves and ends up disagreeing with the ledger.
 *
 * Reconciliation should always return an empty list. Anything in it is a write
 * that bypassed recordMovement, or a bug in it, and that is precisely what the
 * check is for.
 */

export async function GET(request: Request) {
  const admin = await requireAdmin(request);
  if (!admin) return json({ error: 'Not signed in' }, { status: 401 });

  // One market's shelf, not the platform's, unless the caller spans the
  // platform. A low-stock list is a competitor's inventory sheet.
  const [low, drift] = await Promise.all([
    lowStockProducts(admin.marketId),
    reconcileStock(admin.marketId),
  ]);

  return json({
    data: {
      lowStock: low.map((row) => ({
        id: row.id,
        slug: row.slug,
        name: row.name,
        stock: row.stock,
        unit: row.unit,
        price: row.price_label,
        threshold: row.threshold,
        reorderQuantity: row.reorder_quantity,
        // How far below the line it has fallen, so the worst comes first.
        ratio: row.threshold > 0 ? Number((row.stock / row.threshold).toFixed(2)) : 0,
      })),
      reconciliation: drift,
    },
    meta: {
      lowStockCount: low.length,
      // The headline number: 0 means every product agrees with its ledger.
      unreconciledCount: drift.length,
      healthy: drift.length === 0,
    },
  });
}
