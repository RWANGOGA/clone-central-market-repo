import { error } from './http';
import { isWebOrigin } from './webOrigins';

/**
 * Reject mutating requests whose Origin host differs from Host (CSRF).
 *
 * Hostnames are compared rather than host:port pairs, because the dev proxy
 * forwards to a different port than the page is served from. Cross-site
 * requests still differ by hostname, which is what this check is for.
 *
 * An origin named in WEB_ORIGINS is trusted by name instead. It can never match
 * Host — that is the whole point of serving the shop from GitHub Pages and this
 * API from somewhere else — so it is checked against the list rather than
 * waved through.
 */
export function csrfCheck(request: Request): Response | null {
  const method = request.method;
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return null;
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  if (!origin || !host) return null;
  if (isWebOrigin(origin)) return null;
  try {
    const o = new URL(origin);
    if (o.hostname !== host.split(':')[0]) return error('Origin must match Host', 403);
  } catch {
    return error('Invalid Origin', 403);
  }
  return null;
}

/** Baseline security headers applied by routes or a gateway/proxy. */
export const securityHeaders: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Content-Security-Policy': "default-src 'self'; frame-ancestors 'none'",
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
};
