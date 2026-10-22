import { apiUrl } from './apiBase';

const BASE = apiUrl('/api/admin');

/**
 * Client for the staff order endpoints, plus the live feed.
 *
 * Sessions live in an HttpOnly cookie the browser attaches on its own, so
 * there is no token here to hold or leak. EventSource cannot set headers,
 * which is one of the reasons the session is a cookie rather than a bearer
 * token.
 */

export type OrderStatus = 'pending' | 'processing' | 'shipped' | 'delivered' | 'cancelled';

export const ORDER_STATUSES: OrderStatus[] = [
  'pending',
  'processing',
  'shipped',
  'delivered',
  'cancelled',
];

/** Mirrors the server's money summary; see api/src/lib/orderMoney.ts. */
export type MoneyState =
  | 'unpaid'
  | 'cod_due'
  | 'paid'
  | 'part_refunded'
  | 'refunded'
  | 'refund_due';

export type OrderMoney = {
  paid: number;
  codDue: number;
  refundable: number;
  refunded: number;
  net: number;
  state: MoneyState;
  refundDue: boolean;
  currency: string;
};

export type OrderRow = {
  id: number;
  reference: string;
  status: OrderStatus;
  customerName: string | null;
  phone: string | null;
  region: string | null;
  district: string | null;
  total: number;
  currency: string;
  itemCount: number;
  unitCount: number;
  money: OrderMoney;
  createdAt: string;
  updatedAt: string;
};

export type OrderItem = {
  id: number;
  productId: number;
  name: string;
  priceValue: number;
  quantity: number;
  lineTotal: number;
};

export type PaymentRow = {
  id: number;
  reference: string;
  channel: 'mobile_money' | 'card' | 'wallet' | 'cod';
  provider: string;
  status: string;
  amount: number;
  currency: string;
  payerName: string | null;
  payerPhone: string | null;
  maskedCard: string | null;
  failureReason: string | null;
  settledAt: string | null;
  settledByEmail: string | null;
  createdAt: string;
  updatedAt: string;
};

export type RefundRow = {
  id: number;
  reference: string;
  paymentId: number | null;
  amount: number;
  currency: string;
  method: 'cash' | 'mobile_money' | 'wallet';
  reason: string;
  status: 'recorded' | 'cancelled';
  createdByEmail: string | null;
  createdAt: string;
};

export type TimelineEntry = {
  id: number;
  fromStatus: string | null;
  toStatus: string;
  note: string | null;
  changedByEmail: string | null;
  createdAt: string;
};

export type OrderDetail = OrderRow & {
  customerId: number;
  subtotal: number;
  shipping: number;
  tax: number;
  shippingAddress: {
    fullName: string;
    phone: string;
    address: string;
    region: string;
    district: string | null;
  } | null;
  items: OrderItem[];
  payments: PaymentRow[];
  refunds: RefundRow[];
  money: OrderMoney;
  timeline: TimelineEntry[];
  nextStatuses: OrderStatus[];
};

export type OrderListMeta = {
  total: number;
  limit: number;
  offset: number;
  returned: number;
  regions: string[];
  filters: Record<string, string | null>;
};

export type OrderFilters = {
  status?: string;
  region?: string;
  q?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
};

type Result<T> = { ok: true; data: T } | { ok: false; error: string; status: number } | null;

async function call<T>(path: string, init?: RequestInit): Promise<Result<T>> {
  try {
    const response = await fetch(`${BASE}${path}`, {
      ...init,
      credentials: 'include',
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    });

    if (response.status === 401) return { ok: false, error: 'Session expired.', status: 401 };

    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const error =
        (body as { error?: string } | null)?.error ?? `Request failed (${response.status})`;
      return { ok: false, error, status: response.status };
    }

    return { ok: true, data: body as T };
  } catch {
    return null;
  }
}

export async function listOrders(
  filters: OrderFilters,
): Promise<Result<{ data: OrderRow[]; meta: OrderListMeta }>> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== '' && value !== null) params.set(key, String(value));
  }
  const qs = params.toString();
  return call<{ data: OrderRow[]; meta: OrderListMeta }>(`/orders${qs ? `?${qs}` : ''}`);
}

export async function getOrder(idOrRef: string | number): Promise<Result<{ data: OrderDetail }>> {
  return call<{ data: OrderDetail }>(`/orders/${encodeURIComponent(String(idOrRef))}`);
}

export async function setOrderStatus(
  idOrRef: string | number,
  status: string,
  note?: string,
): Promise<Result<{ data: OrderDetail }>> {
  return call<{ data: OrderDetail }>(`/orders/${encodeURIComponent(String(idOrRef))}`, {
    method: 'PATCH',
    body: JSON.stringify({ status, note }),
  });
}

/** Take the cash for a cash-on-delivery order. */
export async function collectCash(
  idOrRef: string | number,
): Promise<Result<{ data: OrderDetail }>> {
  return call<{ data: OrderDetail }>(
    `/orders/${encodeURIComponent(String(idOrRef))}/collect-cash`,
    { method: 'POST' },
  );
}

export type RefundDraft = {
  amount: number;
  method: 'cash' | 'mobile_money' | 'wallet';
  reason: string;
};

/** Record money already handed back to the customer. */
export async function recordRefund(
  idOrRef: string | number,
  draft: RefundDraft,
): Promise<Result<{ data: OrderDetail }>> {
  return call<{ data: OrderDetail }>(`/orders/${encodeURIComponent(String(idOrRef))}/refunds`, {
    method: 'POST',
    body: JSON.stringify(draft),
  });
}

export type LiveOrderEvent = {
  type: 'order.created' | 'order.status';
  id: number;
  reference: string;
  from?: string | null;
  to: string;
  total: number;
  currency: string;
  region: string | null;
  district: string | null;
  customerName: string | null;
  at: string;
};

/**
 * Subscribe to order changes.
 *
 * Returns an unsubscribe function. The stream reconnects on its own; `onEvent`
 * is only called for events that actually arrive. Callers should still poll,
 * because the stream is process-local and adds latency on a multi-instance
 * deployment rather than failing loudly.
 */
export function subscribeToOrders(
  onEvent: (event: LiveOrderEvent) => void,
  onStatus?: (connected: boolean) => void,
): () => void {
  let source: EventSource | null = null;
  let closed = false;

  try {
    source = new EventSource(`${BASE}/events`, { withCredentials: true });

    source.addEventListener('ready', () => onStatus?.(true));

    source.addEventListener('order', (message) => {
      try {
        onEvent(JSON.parse((message as MessageEvent).data) as LiveOrderEvent);
      } catch {
        // A malformed frame should not tear down the subscription.
      }
    });

    source.onerror = () => onStatus?.(false);
  } catch {
    onStatus?.(false);
  }

  return () => {
    closed = true;
    if (closed) {
      source?.close();
      source = null;
    }
  };
}