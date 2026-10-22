/**
 * The browser origins this API is allowed to serve cross-site.
 *
 * A same-origin deployment needs none of this. The dev proxy, the Vite proxy and
 * the nginx container all put the shop and the API on one host, so cookies are
 * first party and the CSRF check is a hostname comparison that always matches.
 *
 * Split hosting is the exception: the shop on GitHub Pages calls this API on
 * Render, so every request arrives with a foreign `Origin` and no first-party
 * cookie. Listing origins in WEB_ORIGINS turns on the three things that makes
 * work — the CORS headers, the CSRF allowance, and `SameSite=None` cookies —
 * and they are deliberately one switch rather than three, because a deployment
 * that has two of them is broken in a way that looks like a lost password.
 *
 * The list is exact. Wildcards are not offered: credentials are attached, so
 * `*` would let any website read a shopper's session.
 */
function parse(): string[] {
  return (process.env.WEB_ORIGINS ?? '')
    .split(',')
    .map((entry) => entry.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

/** Origins such as `https://rwangoga.github.io`, without a trailing slash. */
export const webOrigins: string[] = parse();

/** True when this API is expected to answer requests from another site. */
export const crossSite: boolean = webOrigins.length > 0;

export function isWebOrigin(origin: string | null | undefined): boolean {
  if (!origin) return false;
  return webOrigins.includes(origin.trim().replace(/\/+$/, ''));
}

/**
 * The CORS headers for a request, or none when the caller is not an origin this
 * API serves. Echoing the exact origin rather than `*` is what makes
 * `Allow-Credentials` legal.
 */
export function corsHeaders(origin: string | null): Record<string, string> {
  if (!isWebOrigin(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin as string,
    'Access-Control-Allow-Credentials': 'true',
    // The response now depends on the request header, so caches must key on it.
    Vary: 'Origin',
  };
}

/** Answers a CORS preflight, which never reaches a route handler. */
export function preflightResponse(origin: string | null): Response | null {
  const cors = corsHeaders(origin);
  if (!cors['Access-Control-Allow-Origin']) return null;
  return new Response(null, {
    status: 204,
    headers: {
      ...cors,
      'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'content-type',
      'Access-Control-Max-Age': '600',
    },
  });
}

/**
 * Cookie attributes for a session this API writes.
 *
 * SameSite=Strict is the right answer for a same-origin shop and the wrong one
 * for a split deployment: a cross-site fetch carries nothing at all, so the
 * shopper signs in successfully and is anonymous on the next request. None
 * requires Secure, which is why enabling cross-site also forces https.
 */
export function cookieAttributes(): string {
  if (crossSite) return 'SameSite=None; Secure';
  return process.env.NODE_ENV === 'production' ? 'SameSite=Strict; Secure' : 'SameSite=Strict';
}
