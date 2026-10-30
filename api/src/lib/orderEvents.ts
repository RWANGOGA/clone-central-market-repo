/**
 * In-process publish/subscribe for order changes, used to push live updates to
 * open dashboards over SSE.
 *
 * Scope worth knowing: this is a module-level registry inside one Node
 * process, so it works for a single server and for `npm run dev`. Running more
 * than one API instance, or serverless, would need Redis or a database-backed
 * stream instead, because a subscriber connected to instance A would not hear
 * an event published on instance B. The SSE client already falls back to
 * polling, so the failure mode is added latency rather than a broken screen.
 */

export type OrderEvent = {
  /**
   * `order.updated` is a basket change on a still-pending order: the total
   * moved but no fulfilment state did. The feed treats all three as "this order
   * changed, look again", which is why nothing here carries a payload beyond
   * the row's own summary.
   */
  type: 'order.created' | 'order.status' | 'order.updated';
  id: number;
  reference: string;
  from?: string | null;
  to: string;
  total: number;
  currency: string;
  /**
   * Which market the order belongs to. The live feed is filtered on this, so an
   * account pinned to one market never watches another market's sales arrive.
   */
  marketId: number | null;
  region: string | null;
  district: string | null;
  customerName: string | null;
  at: string;
};

type Subscriber = (event: OrderEvent) => void;
type EventFilter = (event: OrderEvent) => boolean;

/**
 * A subscriber plus the slice of the feed it is allowed to see. Held together so
 * the boundary travels with the connection and cannot be left behind by one
 * route that forgot to check.
 */
type Registration = { onEvent: Subscriber; filter?: EventFilter };

const subscribers = new Set<Registration>();

export function subscribe(onEvent: Subscriber, filter?: EventFilter): () => void {
  const registration: Registration = { onEvent, filter };
  subscribers.add(registration);
  return () => {
    subscribers.delete(registration);
  };
}

export function publishOrderEvent(event: OrderEvent): void {
  for (const { onEvent, filter } of subscribers) {
    // Filtered here rather than inside each subscriber: a new dashboard cannot
    // subscribe to the whole feed by accident.
    if (filter && !filter(event)) continue;
    try {
      onEvent(event);
    } catch {
      // A broken subscriber must not stop the others being notified.
    }
  }
}

export function subscriberCount(): number {
  return subscribers.size;
}

/**
 * The slice of the live feed one account is allowed to hear.
 *
 * Lives beside the registry that enforces it rather than in the route, so the
 * next dashboard cannot quietly subscribe to everything, and so the rule can be
 * tested without a request or a database. The platform tier gets `undefined`,
 * which means no filter: seeing every market is the whole point of the tier.
 *
 * Takes the shape it needs instead of importing `AdminIdentity`, keeping this
 * module free of the database like the permission matrix.
 */
export function marketFeedFilter(admin: {
  marketId: number | null;
}): EventFilter | undefined {
  if (admin.marketId === null) return undefined;
  return (event) => event.marketId === admin.marketId;
}
