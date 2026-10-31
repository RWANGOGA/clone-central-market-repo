import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { hashPassword as hashEncodedPassword, hashToken as hashOpaqueToken, verifyPassword } from '@/lib/password';
import { cookieAttributes } from '@/lib/webOrigins';

const SESSION_HOURS = 24 * 7;
const LEGACY_SALT = Buffer.alloc(16);
const KEY_LENGTH = 64;
const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options?: { N?: number; r?: number; p?: number; maxmem?: number },
) => Promise<Buffer>;

const COMMON_PASSWORD_BASES = [
  '123456', '12345678', '123456789', '1234567890', 'password', 'qwerty', 'abc123',
  'letmein', 'welcome', 'admin', 'iloveyou', 'monkey', 'dragon', 'sunshine', 'princess',
  'football', 'secret', 'passw0rd', '111111', '000000', '123123', '654321', '1q2w3e4r',
  'qwertyuiop', 'asdfghjkl', 'changeme', 'trustno1', 'whatever', 'hello', 'mustang',
  'shadow', 'master', 'login', 'starwars', 'freedom', 'whatever', 'michael', 'jennifer',
  'jordan', 'soccer', 'hockey', 'computer', 'michelle', 'charlie', 'jessica', 'daniel',
  'ashley', 'thomas', 'andrew', 'george', 'summer', 'winter', 'spring', 'autumn', 'qazwsx',
  'pass', 'password!', 'password@', 'welcome!', 'admin@', 'uganda', 'kampala', 'mukono',
  'entebbe', 'nakawa', 'central', 'katale', 'mu-katale', 'mukatale', 'mtn', 'airtel',
  'orange', 'banana', 'coffee', 'family', 'lovely', 'whatever', 'baseball', 'access',
  'mustang', 'shadow', 'master', 'hello123', 'admin123', 'password123', 'qwerty123',
  'iloveyou!', 'welcome1', 'letmein1', 'monkey1', 'football1', 'princess1', 'sunshine1',
];
const COMMON_PASSWORD_SUFFIXES = [
  '0', '1', '12', '123', '1234', '12345', '123456', '1234567', '12345678', '123456789',
  '!', '!!', '@', '#', '$', '1!', '!1', '01', '00', '111', '222', '321', '2020', '2021',
  '2022', '2023', '2024', '2025', '2026', '2027',
];
const COMMON_PASSWORDS = new Set([
  ...COMMON_PASSWORD_BASES,
  ...COMMON_PASSWORD_BASES.flatMap((base) => COMMON_PASSWORD_SUFFIXES.map((suffix) => `${base}${suffix}`)),
]);

export function isCommonPassword(password: string): boolean {
  return COMMON_PASSWORDS.has(password.toLowerCase());
}

export function createSessionToken(): { token: string; tokenHash: string } {
  const token = randomBytes(48).toString('base64url');
  return { token, tokenHash: hashToken(token) };
}

/** Session tokens have ample CSPRNG entropy, so a plain SHA-256 hash is sufficient. */
export function hashToken(token: string): string {
  return hashOpaqueToken(token);
}

export async function hashPassword(password: string): Promise<string> {
  return hashEncodedPassword(password, 8);
}

async function legacyScrypt(password: string): Promise<string> {
  return (await scrypt(password, LEGACY_SALT, KEY_LENGTH)).toString('hex');
}

export async function checkCustomerPassword(
  password: string,
  stored: string,
): Promise<{ ok: boolean; upgrade: string | null }> {
  if (!stored) return { ok: false, upgrade: null };

  if (stored.startsWith('scrypt$')) {
    return { ok: await verifyPassword(password, stored), upgrade: null };
  }

  const legacy = await legacyScrypt(password);
  const actual = Buffer.from(legacy, 'hex');
  const expected = Buffer.from(stored, 'hex');
  const ok = actual.length === expected.length && timingSafeEqual(actual, expected);

  return { ok, upgrade: ok ? await hashPassword(password) : null };
}

export function readCustomerSessionToken(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(/(?:^|;\s*)mk_customer_session=([^;]*)/);
  if (!match?.[1]) return null;

  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

export function readCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  const safeName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${safeName}=([^;]*)`));
  if (!match?.[1]) return null;

  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

export function sessionCookie(token: string, expiresAt: string): string {
  return `mk_customer_session=${encodeURIComponent(token)}; Path=/; HttpOnly; ${cookieAttributes()}; Expires=${new Date(expiresAt).toUTCString()}`;
}

export function clearedCookie(): string {
  return `mk_customer_session=; Path=/; HttpOnly; ${cookieAttributes()}; Max-Age=0`;
}

export function cartCookie(token: string): string {
  return `mk_cart=${encodeURIComponent(token)}; Path=/api; HttpOnly; ${cookieAttributes()}; Max-Age=${30 * 24 * 60 * 60}`;
}

/**
 * The guest's proof that an order is theirs. Scoped to /api rather than
 * /api/orders so it also reaches the payment intent route: the cart that made
 * an order is consumed the moment the order exists, so the order itself is the
 * only thing left to authorise a guest's payment against.
 */
export function trackingCookie(token: string): string {
  return `mk_order_tracking=${encodeURIComponent(token)}; Path=/api; HttpOnly; ${cookieAttributes()}; Max-Age=${30 * 24 * 60 * 60}`;
}

export function getSessionExpiry(): string {
  return new Date(Date.now() + SESSION_HOURS * 3600_000).toISOString();
}
