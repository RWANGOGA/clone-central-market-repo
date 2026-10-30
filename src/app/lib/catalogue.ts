import { useCallback, useEffect, useState } from 'react';
import { apiUrl, assetUrl } from './apiBase';

/**
 * The shop catalogue, read from the API so products an admin adds actually
 * appear for buyers.
 *
 * The compiled-in FALLBACK_CATALOGUE is used when the API cannot be reached, so
 * a stopped backend degrades to the previous behaviour instead of an empty
 * shop. That fallback is also what keeps the seeded nine products on screen if
 * the database is ever empty.
 */

export type CatalogueProduct = {
  id: number;
  name: string;
  price: string;
  priceValue: number;
  farm: string;
  images: string[];
  isFavorite: boolean;
  description: string;
  location: string;
  dietary: string[];
  stock: number;
  unit: string;
  /**
   * The market that sells this product, when the API is reachable. Absent on the
   * compiled-in fallback, which predates markets and must not block an add on a
   * guess — the server is the one that refuses a second market in one order.
   */
  marketId?: number | null;
};

type ApiProduct = {
  id: number;
  name: string;
  price: string;
  priceValue: number;
  farm: string;
  description: string;
  location: string;
  unit: string;
  stock: number;
  dietary: string[];
  images: string[];
  marketId?: number | null;
};

export type CatalogueState = {
  products: CatalogueProduct[];
  /** False while loading, and false again if the API is unreachable. */
  live: boolean;
  loading: boolean;
  refresh: () => Promise<void>;
};

export async function fetchCatalogue(signal?: AbortSignal): Promise<CatalogueProduct[] | null> {
  try {
    const response = await fetch(apiUrl('/api/products'), { signal });
    if (!response.ok) return null;

    const body = (await response.json()) as { data: ApiProduct[] };
    if (!Array.isArray(body.data) || body.data.length === 0) return null;

    return body.data.map((row) => ({
      id: row.id,
      name: row.name,
      price: row.price,
      priceValue: row.priceValue,
      farm: row.farm,
      // A product added without a photo still needs something to render, so an
      // empty list becomes a neutral placeholder rather than a broken image.
      // The paths come back relative to the API, which is a different origin
      // once the shop is on Pages, so they are made absolute on the way in.
      images: row.images.length > 0 ? row.images.map(assetUrl) : [''],
      isFavorite: false,
      description: row.description,
      location: row.location,
      dietary: row.dietary ?? [],
      stock: row.stock ?? 0,
      unit: row.unit,
      marketId: row.marketId ?? null,
    }));
  } catch {
    return null;
  }
}

/**
 * @param fallback the compiled-in catalogue, used when the API is unreachable
 */
export function useCatalogue(
  fallback: CatalogueProduct[],
  pollMs = 60_000,
): CatalogueState {
  const [products, setProducts] = useState<CatalogueProduct[]>(fallback);
  const [live, setLive] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const result = await fetchCatalogue();
    if (result) {
      setProducts(result);
      setLive(true);
    } else {
      // Keep whatever is on screen rather than blanking the shop.
      setLive(false);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const result = await fetchCatalogue();
      if (cancelled) return;
      if (result) {
        setProducts(result);
        setLive(true);
      } else {
        setLive(false);
      }
      setLoading(false);
    };

    load();
    const timer = window.setInterval(load, pollMs);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [pollMs]);

  return { products, live, loading, refresh };
}
