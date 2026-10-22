import { apiUrl } from './apiBase';

/**
 * Discount codes, priced by the API.
 *
 * The browser only ever sends the code and the cart id; the amount discounted
 * comes back from the server, which is the same rule the order transaction
 * applies. A quote here is a preview, not a promise.
 */

export type AppliedPromo = {
  code: string;
  description: string;
  kind: 'percent' | 'fixed';
  value: number;
  minSubtotal: number;
  maxDiscount: number | null;
};

export type PromoQuote = AppliedPromo & {
  subtotal: number;
  discount: number;
  shipping: number;
  tax: number;
  total: number;
  currency: string;
};

export type PromoResult =
  | { ok: true; data: PromoQuote }
  | { ok: false; error: string };

/** Same arithmetic as the server rule, used to keep the basket preview live. */
export function discountFor(promo: AppliedPromo, subtotal: number): number {
  if (subtotal < promo.minSubtotal) return 0;
  const raw = promo.kind === 'percent' ? Math.floor((subtotal * promo.value) / 100) : promo.value;
  const capped = promo.maxDiscount !== null ? Math.min(raw, promo.maxDiscount) : raw;
  return Math.max(0, Math.min(capped, subtotal));
}

/** How much more is needed before the code applies, or 0 when it already does. */
export function promoShortfall(promo: AppliedPromo, subtotal: number): number {
  return Math.max(0, promo.minSubtotal - subtotal);
}

export function toAppliedPromo(quote: PromoQuote): AppliedPromo {
  return {
    code: quote.code,
    description: quote.description,
    kind: quote.kind,
    value: quote.value,
    minSubtotal: quote.minSubtotal,
    maxDiscount: quote.maxDiscount,
  };
}

export async function validatePromo(cartId: number, code: string): Promise<PromoResult> {
  try {
    const response = await fetch(apiUrl('/api/promo/validate'), {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cartId, code }),
    });

    const payload = await response.json().catch(() => null) as
      | { data?: PromoQuote; error?: string }
      | null;

    if (!response.ok || !payload?.data) {
      return { ok: false, error: payload?.error ?? 'That code could not be applied.' };
    }
    return { ok: true, data: payload.data };
  } catch {
    return { ok: false, error: 'Could not reach the basket service. Check that the API is running.' };
  }
}
