/**
 * Admin sign-in: passwords as salted PBKDF2-SHA256 (100,000 iterations, Workers' maximum), sessions
 * as a random cookie whose SHA-256 is all the database keeps, and a limit on failed logins per
 * address. The cookie is HttpOnly, Secure, SameSite=Strict and scoped to /admin.
 */

/** PBKDF2 rounds: within the free plan's 10 ms of CPU per request (100,000 took ~25 ms on the edge and could fail the request).
 *  Each user keeps the count their hash was made with, so raising it later only affects new passwords. */
export const ITERATIONS = 25_000;
export const SESSION_DAYS = 7;
export const COOKIE = 'pulsar_session';
const MAX_FAILURES = 10;
const FAILURE_WINDOW_MIN = 15;

const enc = new TextEncoder();
export const b64 = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s: string) => { const b = atob(s); const out = new Uint8Array(new ArrayBuffer(b.length)); for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i); return out; };
export const randomBytes = (n: number) => crypto.getRandomValues(new Uint8Array(new ArrayBuffer(n)));

export async function hashPassword(password: string, salt: Uint8Array<ArrayBuffer>, iterations = ITERATIONS): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return b64(bits);
}

/** Constant time, so the comparison doesn't tell how much of a hash matched. */
export function sameString(a: string, b: string): boolean {
  const x = enc.encode(a); const y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export async function sha256(s: string): Promise<string> {
  return b64(await crypto.subtle.digest('SHA-256', enc.encode(s)));
}

export interface User { id: string; username: string }

/** The signed-in admin, from the request's session cookie; null if none or expired. */
export async function currentUser(db: D1Database, req: Request): Promise<User | null> {
  const token = cookie(req, COOKIE);
  if (!token || !/^[A-Za-z0-9_-]{40,60}$/.test(token)) return null;
  const row = await db.prepare(
    `SELECT u.id, u.username FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?`,
  ).bind(await sha256(token), new Date().toISOString()).first<User>();
  return row ?? null;
}

export function cookie(req: Request, name: string): string | null {
  for (const part of (req.headers.get('cookie') ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

const urlSafe = (bytes: Uint8Array) => b64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Check a username and password (counting failures per address); the user's id when right. */
export async function verify(db: D1Database, ip: string, username: string, password: string): Promise<{ ok: true; userId: string } | { ok: false; reason: 'limited' | 'wrong' }> {
  const now = new Date();
  const since = new Date(now.getTime() - FAILURE_WINDOW_MIN * 60_000).toISOString();
  const failures = (await db.prepare('SELECT count(*) AS n FROM login_failures WHERE ip = ? AND at > ?').bind(ip, since).first<{ n: number }>())?.n ?? 0;
  if (failures >= MAX_FAILURES) return { ok: false, reason: 'limited' };
  const u = await db.prepare('SELECT id, pw_hash, pw_salt, iterations FROM users WHERE username = ?').bind(username.trim()).first<{ id: string; pw_hash: string; pw_salt: string; iterations: number }>();
  // Hash even for an unknown user, so the time taken doesn't tell which usernames exist.
  const hash = await hashPassword(password, u ? unb64(u.pw_salt) : randomBytes(16), u?.iterations ?? ITERATIONS);
  if (!u || !sameString(hash, u.pw_hash)) {
    await db.batch([
      db.prepare('INSERT INTO login_failures (ip, at) VALUES (?, ?)').bind(ip, now.toISOString()),
      db.prepare('DELETE FROM login_failures WHERE at < ?').bind(new Date(now.getTime() - 86_400_000).toISOString()),
    ]);
    return { ok: false, reason: 'wrong' };
  }
  await db.prepare('DELETE FROM login_failures WHERE ip = ?').bind(ip).run();
  return { ok: true, userId: u.id };
}

/** Check a username and password; on success, a new session and its Set-Cookie value. */
export async function login(db: D1Database, ip: string, username: string, password: string): Promise<{ ok: true; setCookie: string } | { ok: false; reason: 'limited' | 'wrong' }> {
  const v = await verify(db, ip, username, password);
  if (!v.ok) return v;
  const now = new Date();
  const token = urlSafe(randomBytes(32));
  const expires = new Date(now.getTime() + SESSION_DAYS * 86_400_000);
  await db.batch([
    db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').bind(await sha256(token), v.userId, now.toISOString(), expires.toISOString()),
    db.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now.toISOString()),
  ]);
  return { ok: true, setCookie: `${COOKIE}=${token}; Path=/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_DAYS * 86_400}` };
}

export async function logout(db: D1Database, req: Request): Promise<string> {
  const token = cookie(req, COOKIE);
  if (token) await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run();
  return `${COOKIE}=; Path=/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

/** A new password's hash and salt. */
export async function newPassword(password: string) {
  const salt = randomBytes(16);
  return { pw_hash: await hashPassword(password, salt), pw_salt: b64(salt), iterations: ITERATIONS };
}

export const PASSWORD_RULE = 'At least 12 characters.';
export const passwordOk = (p: string) => typeof p === 'string' && p.length >= 12 && p.length <= 200;
