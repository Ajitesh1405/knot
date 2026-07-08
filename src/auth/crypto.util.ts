// ─────────────────────────────────────────────────────────────────
// Self-contained auth primitives — password hashing (scrypt) and
// HS256 JWTs — built on Node's `crypto`. No external deps (bcrypt /
// @nestjs/jwt) so the mobile auth layer stays install-free.
// ─────────────────────────────────────────────────────────────────
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'crypto';

// ─── Password hashing (scrypt) ───────────────────────────────────
// Stored as `scrypt$<saltHex>$<hashHex>` so the salt travels with it.
const KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, KEYLEN).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = (stored ?? '').split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  const candidate = scryptSync(password, salt, expected.length || KEYLEN);
  return (
    candidate.length === expected.length && timingSafeEqual(candidate, expected)
  );
}

// ─── Minimal HS256 JWT ───────────────────────────────────────────
export type TokenType = 'access' | 'refresh';

export interface JwtPayload {
  sub: string; // userId, e.g. "usr-<cuid>"
  email: string;
  typ: TokenType;
  iat: number;
  exp: number;
}

function b64url(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64url');
}

export function signJwt(
  claims: { sub: string; email: string; typ: TokenType },
  secret: string,
  ttlSeconds: number,
): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(
    JSON.stringify({ ...claims, iat: now, exp: now + ttlSeconds }),
  );
  const sig = createHmac('sha256', secret)
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${sig}`;
}

export function verifyJwt(token: string, secret: string): JwtPayload {
  const parts = (token ?? '').split('.');
  if (parts.length !== 3) throw new Error('Malformed token');
  const [header, payload, sig] = parts;

  const expected = createHmac('sha256', secret)
    .update(`${header}.${payload}`)
    .digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new Error('Invalid signature');
  }

  const decoded = JSON.parse(
    Buffer.from(payload, 'base64url').toString('utf8'),
  ) as JwtPayload;
  if (decoded.exp && Math.floor(Date.now() / 1000) > decoded.exp) {
    throw new Error('Token expired');
  }
  return decoded;
}
