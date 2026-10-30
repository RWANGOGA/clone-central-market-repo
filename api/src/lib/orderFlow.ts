/**
 * Fulfilment state machine for orders.
 *
 * Kept out of the route files because Next.js only permits HTTP method exports
 * there. Payment lives on payments.status; this is about goods moving, which is
 * a different axis. A paid order that has not shipped is simply "processing".
 *
 * `confirmed` is the market's own check between payment and preparation: a
 * buyer's testers wanted to know whether anyone had actually looked at the
 * order before it was picked, and the answer used to be inferred from money.
 * Because there is no edge from pending to processing, an order cannot be
 * prepared without somebody accepting it — which also means a rejected line is
 * always caught before the goods leave the stall.
 */

export const ORDER_FLOW = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['processing', 'cancelled'],
  processing: ['shipped', 'cancelled'],
  shipped: ['delivered', 'cancelled'],
  delivered: [],
  cancelled: [],
} as const;

export type OrderStatus = keyof typeof ORDER_FLOW;

export function isOrderStatus(value: string): value is OrderStatus {
  return Object.prototype.hasOwnProperty.call(ORDER_FLOW, value);
}

/** False for anything not explicitly permitted, so a typo cannot widen access. */
export function canTransition(from: string, to: string): boolean {
  const allowed = (ORDER_FLOW as Record<string, readonly string[]>)[from];
  return Array.isArray(allowed) && allowed.includes(to);
}

export function allowedNext(from: string): readonly string[] {
  const allowed = (ORDER_FLOW as Record<string, readonly string[]>)[from];
  return Array.isArray(allowed) ? allowed : [];
}
