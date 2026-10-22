import { apiUrl } from './apiBase';

/**
 * Live stock levels for the catalogue.
 *
 * The frontend keeps its own catalogue for names, prices and images, so stock
 * is merged in from /api/inventory by product id rather than replacing the
 * catalogue wholesale. As with cartApi, a stopped backend returns null instead
 * of throwing, and the UI falls back to the figures compiled into the source
 * while saying so.
 */

export type StockState = 'in_stock' | 'low' | 'out';

export type StockLevel = {
  productId: number;
  stock: number;
  unit: string;
  state: StockState;
  /** e.g. "27 kg remaining", "Only 7 kg left", "Sold out". */
  remaining: string;
};

export type InventorySummary = {
  total: number;
  inStock: number;
  lowStock: number;
  outOfStock: number;
  threshold: number;
};

const LOW_STOCK_THRESHOLD = 10;

/** Same rule as api/src/lib/stock.ts, kept in step deliberately. */
export function stockStateOf(stock: number, threshold = LOW_STOCK_THRESHOLD): StockState {
  if (stock <= 0) return 'out';
  if (stock <= threshold) return 'low';
  return 'in_stock';
}

export function describeStockOf(stock: number, unit: string, threshold = LOW_STOCK_THRESHOLD): string {
  if (stock <= 0) return 'Sold out';
  const noun = `${Math.round(stock)} ${unit}`;
  return stock <= threshold ? `Only ${noun} left` : `${noun} remaining`;
}

export async function fetchStock(
  signal?: AbortSignal,
): Promise<{ levels: Map<number, StockLevel>; summary: InventorySummary } | null> {
  try {
    const response = await fetch(apiUrl('/api/inventory'), { signal });
    if (!response.ok) return null;

    const body = (await response.json()) as {
      data: {
        id: number;
        stock: number;
        unit: string;
        state: StockState;
        remaining: string;
      }[];
      meta: InventorySummary;
    };

    const levels = new Map<number, StockLevel>();
    for (const row of body.data) {
      levels.set(row.id, {
        productId: row.id,
        stock: row.stock,
        unit: row.unit,
        state: row.state,
        remaining: row.remaining,
      });
    }

    return { levels, summary: body.meta };
  } catch {
    return null;
  }
}

/** Record a local stock change so the badge moves without waiting for a refetch. */
export function applyStockDelta(
  levels: Map<number, StockLevel>,
  productId: number,
  delta: number,
): Map<number, StockLevel> {
  const current = levels.get(productId);
  if (!current) return levels;

  const next = Math.max(0, current.stock - delta);

  return new Map(levels).set(productId, {
    ...current,
    stock: next,
    state: stockStateOf(next),
    remaining: describeStockOf(next, current.unit),
  });
}
