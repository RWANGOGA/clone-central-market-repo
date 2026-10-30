import { formatUgx } from '../lib/currency';
import type { TopUpContextType } from '../lib/topUpProvider';

/**
 * The line that answers "am I still editing the same order?".
 *
 * Testers lost their place the moment they left the payment screen: the shop
 * looked exactly as it always had, so adding something felt like starting a new
 * shop trip rather than finishing the one they were on. This bar sits above the
 * aisle for as long as the order is open and carries the three things the
 * customer needs to trust the mode — which order, what it now costs, and how to
 * get back to paying for it.
 */
export default function TopUpBar({ topUp }: { topUp: TopUpContextType }) {
  const { reference, order, totals, busy, error, lastAdded } = topUp;

  if (!reference) return null;

  return (
    <div
      role="region"
      aria-label={`Adding to order ${reference}`}
      className="shrink-0 border-b border-brand/20 bg-brand-soft px-6 py-2.5"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          {order ? (
            <p className="truncate text-[13px] font-medium text-brand-deep">
              Adding to order {reference}
            </p>
          ) : (
            <p className="truncate text-[13px] font-medium text-brand-deep">Order {reference}</p>
          )}
          {order ? (
            <p className="text-[12px] leading-[17px] text-brand-deep/80">
              {busy
                ? 'Adding…'
                : `${totals ? formatUgx(totals.total) : '—'} total${lastAdded ? ` · ${lastAdded} added` : ''}`}
            </p>
          ) : (
            <p className="text-[12px] leading-[17px] text-brand-deep/80">
              {error ?? 'This order is closed for changes.'}
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={topUp.stop}
            className="rounded-lg border border-brand/30 px-2.5 py-1.5 text-[12px] font-normal text-brand-deep"
          >
            Discard
          </button>
          <button
            type="button"
            onClick={topUp.finish}
            disabled={busy}
            className="cursor-pointer rounded-lg bg-brand px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-60"
          >
            Pay now
          </button>
        </div>
      </div>

      {order && error && (
        <p role="alert" className="mt-1 text-[11px] leading-[15px] font-medium text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
