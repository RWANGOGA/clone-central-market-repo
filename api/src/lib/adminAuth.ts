import { and, eq, gt, lt } from 'drizzle-orm';
import { db } from '@/db';
import { adminLoginAttempts, admins, adminSessions, nowText } from '@/db/schema';
import {
  can,
  PERMISSION_LABELS,
  type AdminRole,
  type Permission,
} from '@/lib/adminPermissions';
import { createSessionToken, hashToken, verifyPassword } from '@/lib/password';
import { cookieAttributes } from '@/lib/webOrigins';

/**
 * Admin authentication.
 *
 * Deliberately small: an opaque bearer token in an HttpOnly cookie, stored
 * hashed. There is no JWT, because a signed token cannot be revoked before it
 * expires and an admin session should be killable immediately.
 */

export const SESSION_COOKIE = 'mk_admin_session';
const SESSION_HOURS = 12;

/** Kept as API constants for the limiter in the login route. */
const MAX_ATTEMPTS = 8;
const ATTEMPT_WINDOW_MINUTES = 15;


export type AdminIdentity = {
  id: number;
  email: string;
  name: string;
  role: AdminRole;
};

function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;

  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export function tokenFromRequest(request: Request): string | null {
  // The cookie is the primary path. The header is accepted so a scripted
  // client or a test can authenticate without a cookie jar.
  const fromCookie = readCookie(request.headers.get('cookie'), SESSION_COOKIE);
  if (fromCookie) return fromCookie;

  const auth = request.headers.get('authorization');
  if (auth?.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();

  return null;
}

export async function login(
  email: string,
  password: string,
  userAgent: string | null,
): Promise<
  | { ok: true; token: string; expiresAt: string; admin: AdminIdentity }
  | { ok: false; status: number; error: string }
> {
  const normalised = email.trim().toLowerCase();


  const admin = await db.query.admins.findFirst({ where: eq(admins.email, normalised) });

  // Hash even when there is no such account, so a missing email and a wrong
  // password take the same time and cannot be told apart.
  const storedHash = admin?.passwordHash ?? DUMMY_HASH;
  const passwordOk = await verifyPassword(password, storedHash);

  if (!admin || !passwordOk || !admin.active) {
    await db.insert(adminLoginAttempts).values({ email: normalised, succeeded: false });
    // One message for both cases, so this cannot be used to discover which
    // addresses have accounts.
    return { ok: false, status: 401, error: 'Email or password is incorrect.' };
  }

  await db.insert(adminLoginAttempts).values({ email: normalised, succeeded: true });
  await db.update(admins).set({ lastLoginAt: nowText }).where(eq(admins.id, admin.id));

  const { token, tokenHash } = createSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 3600_000).toISOString();

  await db.insert(adminSessions).values({
    adminId: admin.id,
    tokenHash,
    expiresAt,
    userAgent: userAgent?.slice(0, 200) ?? null,
  });

  return {
    ok: true,
    token,
    expiresAt,
    admin: { id: admin.id, email: admin.email, name: admin.name, role: admin.role },
  };
}

/**
 * A valid scrypt hash of a value nobody knows, used to spend the same time on a
 * failed lookup as on a real verification.
 */
const DUMMY_HASH =
  'scrypt$16384$8$1$00000000000000000000000000000000$' +
  '0000000000000000000000000000000000000000000000000000000000000000' +
  '0000000000000000000000000000000000000000000000000000000000000000';

export type AdminGuard =
  | { ok: true; admin: AdminIdentity }
  | { ok: false; status: 401 | 403; message: string };

/**
 * The one gate for a staff route.
 *
 * Splitting 401 from 403 matters: "sign in again" and "your account is not
 * allowed to do this" are different problems and should not look the same in
 * the console.
 */
export async function guardAdmin(
  request: Request,
  permission?: Permission,
): Promise<AdminGuard> {
  const admin = await authenticate(request);
  if (!admin) return { ok: false, status: 401, message: 'Not signed in' };
  if (permission && !can(admin.role, permission)) {
    return {
      ok: false,
      status: 403,
      message: `Your role (${admin.role}) cannot ${PERMISSION_LABELS[permission]}. Ask an owner for access.`,
    };
  }
  return { ok: true, admin };
}

export async function authenticate(request: Request): Promise<AdminIdentity | null> {
  const token = tokenFromRequest(request);
  if (!token) return null;

  const row = await db.query.adminSessions.findFirst({
    where: and(
      eq(adminSessions.tokenHash, hashToken(token)),
      gt(adminSessions.expiresAt, nowText),
    ),
  });

  if (!row) return null;

  const admin = await db.query.admins.findFirst({ where: eq(admins.id, row.adminId) });
  if (!admin || !admin.active) return null;

  return { id: admin.id, email: admin.email, name: admin.name, role: admin.role };
}

export async function logout(request: Request): Promise<void> {
  const token = tokenFromRequest(request);
  if (!token) return;

  await db.delete(adminSessions).where(eq(adminSessions.tokenHash, hashToken(token)));
}

/** Remove sessions that have expired. */
export async function pruneSessions(): Promise<void> {
  await db.delete(adminSessions).where(lt(adminSessions.expiresAt, nowText));
}

export function sessionCookie(token: string, expiresAt: string): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; ${cookieAttributes()}; Expires=${new Date(expiresAt).toUTCString()}`;
}

export function clearedCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; ${cookieAttributes()}; Max-Age=0`;
}

export { MAX_ATTEMPTS, ATTEMPT_WINDOW_MINUTES, SESSION_HOURS };
