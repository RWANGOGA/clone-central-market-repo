/**
 * Which market the staff console is currently looking at.
 *
 * Only a platform account can change this: a market account is pinned by the
 * server, and every route already filters by its own market. The value is kept
 * here rather than in a component because the staff client and the order client
 * both need to attach it, and a console showing Mbarara must not fetch Kampala
 * data behind the user's back.
 */

let active: number | null = null;
const listeners = new Set<() => void>();

export function getActiveMarket(): number | null {
  return active;
}

export function setActiveMarket(marketId: number | null): void {
  if (active === marketId) return;
  active = marketId;
  for (const notify of listeners) notify();
}

export function onActiveMarketChange(notify: () => void): () => void {
  listeners.add(notify);
  return () => listeners.delete(notify);
}

/** Add the market the console is showing, unless the path already names one. */
export function withActiveMarket(path: string): string {
  if (active === null || path.includes('marketId=')) return path;
  const joiner = path.includes('?') ? '&' : '?';
  return `${path}${joiner}marketId=${active}`;
}
