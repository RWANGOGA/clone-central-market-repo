import React from 'react';
import type { StockLevel } from '../lib/stockApi';

interface StockBadgeProps {
  level: StockLevel | null;
  /** `inline` for a list card, `block` for the product detail page. */
  variant?: 'inline' | 'block';
  /** Shown when the API could not be reached, so the figure is not live. */
  stale?: boolean;
}

const TONE = {
  in_stock: {
    text: 'text-brand',
    chip: 'bg-brand/10 text-brand border-brand/20',
    bar: 'bg-brand',
    label: 'In stock',
  },
  low: {
    text: 'text-[#b07d2b]',
    chip: 'bg-[#b07d2b]/12 text-[#b07d2b] border-[#b07d2b]/25',
    bar: 'bg-[#b07d2b]',
    label: 'Low stock',
  },
  out: {
    text: 'text-[#9a9a9a]',
    chip: 'bg-neutral-100 text-muted-foreground border-neutral-200',
    bar: 'bg-neutral-300',
    label: 'Sold out',
  },
} as const;

/**
 * Shows what is actually left, in the product's own sale unit, so a buyer
 * planning a kitchen order sees "27 kg remaining" rather than a bare number
 * they would have to interpret.
 */
export default function StockBadge({ level, variant = 'inline', stale = false }: StockBadgeProps) {
  // No figure at all: say so rather than implying a known quantity.
  if (!level) {
    return (
      <span className="text-[11px] font-normal text-[#9a9a9a]">
        {stale ? 'Stock unavailable' : 'Checking stock…'}
      </span>
    );
  }

  const tone = TONE[level.state];
  const soldOut = level.state === 'out';

  if (variant === 'block') {
    return (
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className={`text-[13px] font-medium ${tone.text}`}>
            {level.remaining}
          </span>
          <span
            className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full border font-medium ${tone.chip}`}
          >
            {tone.label}
          </span>
        </div>

        {!soldOut && (
          <>
            <div className="h-1.5 rounded-full bg-neutral-200 overflow-hidden">
              {/* A fixed reference rather than a true fill: there is no
                  capacity figure, so this signals "some left", not how much
                  of a whole. */}
              <div className={`h-full ${tone.bar} rounded-full`} style={{ width: level.state === 'low' ? '18%' : '62%' }} />
            </div>
            <p className="text-[11px] font-normal text-[#9a9a9a]">
              {stale
                ? 'Last known figure, the live service is unreachable.'
                : `Counted in ${level.unit}. Orders are checked against this when you pay.`}
            </p>
          </>
        )}

        {soldOut && (
          <p className="text-[11px] font-normal text-[#9a9a9a]">
            Nothing available. A delivery would be needed before this can be ordered.
          </p>
        )}
      </div>
    );
  }

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium leading-tight ${tone.chip}`}
    >
      {level.remaining}
    </span>
  );
}
