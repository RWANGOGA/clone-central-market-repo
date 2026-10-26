import { z } from 'zod';

/**
 * The promo rule itself: pure, database-free logic shared by the preview
 * endpoint, the order transaction and the admin screens. Keeping it free of
 * the connection pool is what lets the rules be unit tested on their own.
 */

export const PROMO_CODE_PATTERN = /^[A-Z0-9-]{3,32}$/;

export type PromoRule = {
  code: string;
  kind: 'percent' | 'fixed';
  value: number;
  minSubtotal: number;
  maxDiscount: number | null;
  active: boolean;
  startsAt: string | null;
  endsAt: string | null;
  usageLimit: number | null;
  usedCount: number;
  perCustomerLimit: number | null;
};

export class PromoError extends Error {}

/** Upper-case, whitespace-free form, or null when it cannot be a code. */
export function normalizePromoCode(raw: string): string | null {
  const code = raw.trim().toUpperCase().replace(/\s+/g, '');
  return PROMO_CODE_PATTERN.test(code) ? code : null;
}

/** UTC "YYYY-MM-DD HH:MM:SS", the format used by every timestamp here. */
export function stampNow(date = new Date()): string {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

export type PromoEvaluation = { discount: number } | { reason: string };

export function evaluatePromo(promo: PromoRule, subtotal: number, now = new Date()): PromoEvaluation {
  if (!promo.active) return { reason: 'This code is no longer available.' };
  const stamp = stampNow(now);
  if (promo.startsAt && promo.startsAt > stamp) return { reason: 'This code is not active yet.' };
  if (promo.endsAt && promo.endsAt < stamp) return { reason: 'This code has expired.' };
  if (promo.usageLimit !== null && promo.usedCount >= promo.usageLimit) {
    return { reason: 'This code has been fully redeemed.' };
  }
  if (subtotal < promo.minSubtotal) {
    const shortfall = (promo.minSubtotal - subtotal).toLocaleString('en-UG');
    return { reason: `Add UGX ${shortfall} more to use this code.` };
  }

  const discount = promo.kind === 'percent'
    ? Math.floor((subtotal * promo.value) / 100)
    : promo.value;
  const capped = promo.maxDiscount !== null ? Math.min(discount, promo.maxDiscount) : discount;
  const applied = Math.min(capped, subtotal);
  if (applied <= 0) return { reason: 'This code does not reduce this basket.' };
  return { discount: applied };
}

export type PromoState = 'live' | 'scheduled' | 'paused' | 'expired' | 'exhausted';

export function promoState(promo: PromoRule, now = new Date()): PromoState {
  if (!promo.active) return 'paused';
  const stamp = stampNow(now);
  if (promo.startsAt && promo.startsAt > stamp) return 'scheduled';
  if (promo.endsAt && promo.endsAt < stamp) return 'expired';
  if (promo.usageLimit !== null && promo.usedCount >= promo.usageLimit) return 'exhausted';
  return 'live';
}

/** Accepts "YYYY-MM-DD", "YYYY-MM-DDTHH:MM" or a full ISO timestamp. */
export function toStamp(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return `${trimmed} 00:00:00`;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return stampNow(parsed);
}

const stampInput = z.string().trim().max(40).transform((value, ctx) => {
  const stamp = toStamp(value);
  if (!stamp) {
    ctx.addIssue({ code: 'custom', message: 'Enter a valid date and time.' });
    return z.NEVER;
  }
  return stamp;
});

export const promoInputSchema = z.object({
  code: z.string().trim().min(3).max(32),
  description: z.string().trim().max(200).optional().default(''),
  kind: z.enum(['percent', 'fixed']),
  value: z.number().int().positive(),
  minSubtotal: z.number().int().min(0).max(50_000_000).optional().default(0),
  maxDiscount: z.number().int().positive().max(50_000_000).nullish(),
  active: z.boolean().optional().default(true),
  startsAt: stampInput.nullish(),
  endsAt: stampInput.nullish(),
  usageLimit: z.number().int().positive().max(1_000_000).nullish(),
  perCustomerLimit: z.number().int().positive().max(100).nullish(),
  /** Null means a platform-wide code. Only a platform admin may create one. */
  marketId: z.number().int().positive().nullish(),
}).strict().superRefine((value, ctx) => {
  if (value.kind === 'percent' && value.value > 100) {
    ctx.addIssue({ code: 'custom', path: ['value'], message: 'A percentage cannot exceed 100.' });
  }
  if (value.kind === 'fixed' && value.value > 50_000_000) {
    ctx.addIssue({ code: 'custom', path: ['value'], message: 'That discount is too large.' });
  }
  if (value.maxDiscount != null && value.kind !== 'percent') {
    ctx.addIssue({ code: 'custom', path: ['maxDiscount'], message: 'Only percentage codes need a cap.' });
  }
  if (value.startsAt && value.endsAt && value.endsAt <= value.startsAt) {
    ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'The end must come after the start.' });
  }
});

export type PromoInput = z.infer<typeof promoInputSchema>;
