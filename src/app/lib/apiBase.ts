/**
 * Where the API lives.
 *
 * Usually this is empty. The Vite dev proxy, the nginx container and the
 * docker-compose stack all put the shop and its API on one origin, so every
 * call can stay a root-relative `/api/...` path and the session cookies are
 * first-party ones the browser sends without being asked.
 *
 * GitHub Pages is the exception: it serves static files only, so the API has to
 * run somewhere else and the build sets VITE_API_BASE to that host. A request
 * to another origin carries no cookie and no `mk_cart` unless it says so
 * explicitly, which is why every call site pairs this with
 * `credentials: 'include'` and why the API answers with matching CORS headers
 * and `SameSite=None` cookies. Keep the two sides in step: an absolute base
 * with a same-origin-only backend produces 401s that look like lost logins.
 */
export const API_BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/+$/, '');

/** Joins the API base with a root-relative API path such as `/api/products`. */
export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}
