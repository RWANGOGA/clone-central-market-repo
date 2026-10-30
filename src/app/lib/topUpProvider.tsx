import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { addOrderItem, fetchOrder, type TopUpTotals, type TrackedOrder } from './customerApi';

/**
 * "Add more items" while the order is still open.
 *
 * All three testers failed the task "add one more item before you pay" because
 * the payment screen had no way back into the shop, and by then the basket is no
 * longer a basket: checkout converts it into an order, reserves the stock and
 * claims the code. So this is not a second cart — it is a mode over the shop that
 * edits the order itself through POST /api/orders/:id/items.
 *
 * The order is open only while it is pending and unpaid, which is exactly what
 * "lock the basket only after payment is confirmed" means on the money axis: the
 * server refuses once a payment has settled, and this provider stops offering the
 * mode as soon as it sees an order that has moved on.
 *
 * The reference arrives in the URL (?topUp=GRC-…) so a reload or a browser Back
 * restores the mode instead of silently dropping the customer back into ordinary
 * basket edits against a cart that has already been converted. Afterwards it is
 * held in state, so moving between the shop and a product page keeps it.
 */

const PARAM = 'topUp';

export interface TopUpContextType {
  /** The order being topped up, or null when the shop is in ordinary basket mode. */
  reference: string | null;
  order: TrackedOrder | null;
  totals: TopUpTotals | null;
  /** True while an add is in flight, so a double tap cannot add twice. */
  busy: boolean;
  error: string | null;
  lastAdded: string | null;
  start: (reference: string) => void;
  stop: () => void;
  /** Go back to the payment screen, which re-reads the order it is charging. */
  finish: () => void;
  add: (productId: number, quantity?: number) => Promise<boolean>;
  dismissError: () => void;
}

const TopUpContext = createContext<TopUpContextType | null>(null);

export function TopUpProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [reference, setReference] = useState<string | null>(null);
  const [order, setOrder] = useState<TrackedOrder | null>(null);
  const [totals, setTotals] = useState<TopUpTotals | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastAdded, setLastAdded] = useState<string | null>(null);

  const fromUrl = new URLSearchParams(location.search).get(PARAM);

  // Pick up a mode the URL asked for — the payment screen's "Add more items",
  // or the same page reloaded.
  useEffect(() => {
    if (fromUrl && fromUrl !== reference) {
      setReference(fromUrl);
      setError(null);
      setLastAdded(null);
    }
  }, [fromUrl, reference]);

  useEffect(() => {
    if (!reference) {
      setOrder(null);
      setTotals(null);
      return;
    }
    let cancelled = false;
    fetchOrder(reference)
      .then((data) => {
        if (cancelled) return;
        setOrder(data);
        setTotals({
          subtotal: data.subtotal,
          discount: data.discount,
          shipping: data.shipping,
          tax: data.tax,
          total: data.total,
        });
        // Nothing to do when there is no session or tracking cookie behind this
        // order: the bar would promise an edit that the server will refuse.
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setReference(null);
        setError(err instanceof Error ? err.message : 'This order could not be opened for changes.');
      });
    return () => {
      cancelled = true;
    };
  }, [reference]);

  const start = useCallback((ref: string) => {
    setReference(ref);
    setError(null);
    setLastAdded(null);
    navigate(`/?${PARAM}=${encodeURIComponent(ref)}`);
  }, [navigate]);

  const stop = useCallback(() => {
    setReference(null);
    setOrder(null);
    setTotals(null);
    setError(null);
    setLastAdded(null);
    navigate('/');
  }, [navigate]);

  const finish = useCallback(() => {
    const ref = reference;
    setReference(null);
    setOrder(null);
    setTotals(null);
    setError(null);
    setLastAdded(null);
    navigate(ref ? `/pay/${ref}` : '/');
  }, [navigate, reference]);

  const add = useCallback(
    async (productId: number, quantity = 1) => {
      if (!reference || busy) return false;
      setBusy(true);
      setError(null);
      try {
        const result = await addOrderItem(reference, { productId, quantity });
        setTotals(result.totals);
        setLastAdded(`${result.added.name} × ${result.added.quantity}${result.added.unit}`);
        setOrder((current) =>
          current
            ? {
                ...current,
                subtotal: result.totals.subtotal,
                discount: result.totals.discount,
                shipping: result.totals.shipping,
                tax: result.totals.tax,
                total: result.totals.total,
              }
            : current,
        );
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'We could not add that to your order.');
        return false;
      } finally {
        setBusy(false);
      }
    },
    [busy, reference],
  );

  const value = useMemo<TopUpContextType>(
    () => ({
      reference,
      // An order that has already been accepted or paid is closed, whatever the
      // URL says. The server enforces this again; the shop must not offer it.
      order: order && order.status === 'pending' ? order : null,
      totals,
      busy,
      error,
      lastAdded,
      start,
      stop,
      finish,
      add,
      dismissError: () => setError(null),
    }),
    [reference, order, totals, busy, error, lastAdded, start, stop, finish, add],
  );

  return <TopUpContext.Provider value={value}>{children}</TopUpContext.Provider>;
}

export function useTopUp(): TopUpContextType {
  const ctx = useContext(TopUpContext);
  if (!ctx) throw new Error('useTopUp must be used within a TopUpProvider');
  return ctx;
}

/** Ordinary basket mode, or a mode over a closed order, is not a top-up at all. */
export function topUpIsOpen(ctx: TopUpContextType): boolean {
  return !!ctx.reference && !!ctx.order;
}
