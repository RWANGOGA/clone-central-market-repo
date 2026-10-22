import { apiUrl } from './apiBase';

/**
 * Client for the payment endpoints in api/.
 *
 * As with cartApi, a stopped backend returns null rather than throwing, so the
 * payment screen degrades to "unavailable" instead of breaking.
 */

/**
 * Card is intentionally absent: card data is never posted to this server. A
 * card payment belongs on the gateway's hosted page.
 */
export type PaymentChannel = 'mobile_money' | 'wallet' | 'cod';

export type PaymentMethod = {
  id: string;
  provider: string;
  label: string;
  channel: string;
  ussd?: string;
  prefixes?: readonly string[];
  instructions?: string;
};

export type PaymentMethods = {
  groups: { channel: PaymentChannel; methods: PaymentMethod[] }[];
  currency: string;
};

export type PaymentIntent = {
  reference: string;
  channel: PaymentChannel;
  provider: string;
  status: string;
  amount: number;
  currency: string;
  maskedCard: string | null;
  failureReason: string | null;
  /**
   * Issued once, in development only. Presenting it is what allows this
   * browser to report the outcome; a production deployment settles through the
   * gateway webhook and never sends one.
   */
  settlementToken?: string;
  nextAction?: {
    channel: PaymentChannel;
    provider: string;
    status: string;
    instructions: string | null;
    ussd: string | null;
  };
};

export type PaymentTotals = {
  subtotal: number;
  discount: number;
  promoCode: string | null;
  shipping: number;
  tax: number;
  total: number;
  currency: string;
};

/**
 * Every route answers with a `{ data, meta?, totals? }` envelope. Callers pick
 * the part they need rather than having it unwrapped here, because totals and
 * the meta block sit alongside `data`.
 */
type Envelope<D> = {
  data: D;
  meta?: { currency?: string; [key: string]: unknown };
  totals?: PaymentTotals;
};

type Ok<D> = { ok: true; data: Envelope<D> };
type Fail = { ok: false; error: string; status: number };
type Result<D> = Ok<D> | Fail | null;

async function request<D>(path: string, init?: RequestInit): Promise<Result<D>> {
  try {
    const response = await fetch(apiUrl(`/api${path}`), {
      ...init,
      // An intent belongs to a cart and a tracking token, both of which live in
      // HttpOnly cookies, so a cross-origin call has to carry them.
      credentials: 'include',
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    });

    const body = await response.json().catch(() => null);

    if (!response.ok) {
      const message =
        (body as { error?: string } | null)?.error ?? `Request failed (${response.status})`;
      return { ok: false, error: message, status: response.status };
    }

    return { ok: true, data: body as Envelope<D> };
  } catch {
    // Backend not running.
    return null;
  }
}

export async function fetchPaymentMethods(): Promise<PaymentMethods | null> {
  const result = await request<{ channel: PaymentChannel; methods: PaymentMethod[] }[]>(
    '/payments/methods',
  );
  if (!result || !result.ok) return null;

  return {
    groups: result.data.data,
    currency: result.data.meta?.currency ?? 'UGX',
  };
}

export type CreateIntentInput = {
  cartId: number;
  /**
   * The order this intent pays for. The server reads the amount from it, so
   * the browser never states what is due.
   */
  orderReference: string;
  channel: PaymentChannel;
  provider: string;
  payerName?: string;
  payerPhone?: string;
  walletId?: string;
};

export async function createPaymentIntent(
  input: CreateIntentInput,
): Promise<Result<PaymentIntent>> {
  return request<PaymentIntent>('/payments/intents', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function fetchPaymentIntent(reference: string): Promise<Result<PaymentIntent>> {
  return request<PaymentIntent>(`/payments/intents/${reference}`);
}

/**
 * Report the outcome back to the server (development only).
 *
 * The settlement token from createPaymentIntent is required: it proves this
 * browser opened the intent, so a reference on its own cannot be used to mark
 * somebody else's payment succeeded. A production deployment replaces this with
 * a gateway webhook and drops the token entirely.
 */
export async function settlePaymentIntent(
  reference: string,
  settlementToken: string,
  status: 'succeeded' | 'failed' | 'cancelled',
  failureReason?: string,
): Promise<Result<PaymentIntent>> {
  return request<PaymentIntent>('/payments/intents', {
    method: 'PATCH',
    body: JSON.stringify({ reference, settlementToken, status, failureReason }),
  });
}
