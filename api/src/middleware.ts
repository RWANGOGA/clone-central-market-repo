import { NextResponse, type NextRequest } from 'next/server';
import { corsHeaders, isWebOrigin, preflightResponse } from '@/lib/webOrigins';

/**
 * Cross-cutting protections for the API.
 *
 * 1. CORS: when WEB_ORIGINS names a front end on another host (GitHub Pages
 *    talking to this API on Render), every answer has to carry that origin back
 *    with credentials allowed, and the preflight has to be answered here because
 *    it never reaches a route handler.
 * 2. CSRF: a mutating request whose Origin is neither this host nor an origin in
 *    WEB_ORIGINS is rejected. SameSite cookies already block most of it; the
 *    check covers clients and browsers that still send the cookie.
 * 3. Baseline security headers on every response. Uploaded assets get a
 *    stricter policy in their own route.
 *
 * Gateway webhooks have no Origin header and are authenticated by their HMAC
 * signature instead, so they pass through here untouched.
 */

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
};

export function middleware(request: NextRequest) {
  const origin = request.headers.get('origin');
  const cors = corsHeaders(origin);

  if (request.method === 'OPTIONS') {
    // A preflight is answered here or not at all: it never reaches a route.
    const answered = preflightResponse(origin);
    if (answered) return answered;
    return new NextResponse(null, { status: 204, headers: SECURITY_HEADERS });
  }

  if (MUTATING.has(request.method)) {
    const host = request.headers.get('host');

    if (origin && host && !isWebOrigin(origin)) {
      let originHost: string | null = null;
      try {
        originHost = new URL(origin).hostname;
      } catch {
        originHost = null;
      }
      // Compare hostnames, not ports: the dev proxy forwards to a different
      // port than the page is served from.
      if (!originHost || originHost !== host.split(':')[0]) {
        return new NextResponse(JSON.stringify({ error: 'Origin must match Host' }), {
          status: 403,
          headers: { 'content-type': 'application/json', ...SECURITY_HEADERS, ...cors },
        });
      }
    }
  }

  const response = NextResponse.next();
  for (const [name, value] of Object.entries({ ...SECURITY_HEADERS, ...cors })) {
    response.headers.set(name, value);
  }
  return response;
}

export const config = {
  matcher: '/api/:path*',
};
