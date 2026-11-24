import type { IncomingMessage, ServerResponse } from 'http';
import * as cookie from 'cookie';
import { config } from '../core/config';
import { isSecure, hostAllowed, adminIpOk } from '../http/net';
import * as db from '../core/db';
import type { Row } from '../core/db';
import type { SessionUser } from '../../shared/types';
import * as sec from './security';
import { AppError } from '../core/errors';

const names = (req: IncomingMessage) => { const p = isSecure(req) ? '__Host-' : ''; return { SID: `${p}nivo_sid`, CSRF: `${p}nivo_csrf`, secure: Boolean(p) }; };
const SESSION_DAYS = 14;
const ADMIN_SESSION_MS = 8 * 3600e3;
const sessionMs = (role: string): number => (role === 'admin' ? ADMIN_SESSION_MS : SESSION_DAYS * 864e5);
const SESSION_RE = /^[A-Za-z0-9_-]{43}$/;

function setCookie(req: IncomingMessage, res: ServerResponse, name: string, value: string, maxAgeSec: number): void {
  const line = cookie.serialize(name, value, { path: '/', httpOnly: true, sameSite: 'lax', secure: names(req).secure, maxAge: maxAgeSec });
  const prev = res.getHeader('Set-Cookie');
  res.setHeader('Set-Cookie', prev === undefined ? [line] : ([] as string[]).concat(prev as string | string[], line));
}
const publicUser = (r: Row): SessionUser => ({ id: r.id, username: r.username, email: r.email, name: r.name, role: r.role, balance: Number(r.balance), twofa: Boolean(r.totp_enabled) });

async function attach(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.nivoAttached) return;
  req.nivoAttached = true;
  const { SID, CSRF } = names(req);
  const c = cookie.parse(req.headers.cookie || '');
  req.cookieCsrfValid = sec.csrfValid(c[CSRF]);
  req.csrfToken = req.cookieCsrfValid ? String(c[CSRF]) : sec.csrfCreate();
  if (!req.cookieCsrfValid) setCookie(req, res, CSRF, req.csrfToken, 60 * 60 * 24 * 30);
  req.user = null;
  const sid = c[SID];
  if (!sid || !SESSION_RE.test(sid)) return;
  const now = new Date();
  const row = await db.one(
    `SELECT s.id AS sid, s.last_seen_at, u.id, u.username, u.email, u.name, u.role, u.balance, u.status, u.totp_enabled
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?`, [sec.sha256(sid), now]);
  if (!row || row.status !== 'active') return;
  req.user = publicUser(row);
  req.sessionId = row.sid;
  if (now.getTime() - new Date(row.last_seen_at).getTime() > 5 * 60e3) {
    await db.query('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?', [now, new Date(now.getTime() + sessionMs(row.role)), row.sid]);
  }
}

async function startSession(req: IncomingMessage, res: ServerResponse, userId: number, role: string = 'user'): Promise<void> {
  const token = sec.randomToken(32);
  const now = new Date();
  await db.query('INSERT INTO sessions (user_id, token_hash, ip, ua, expires_at) VALUES (?,?,?,?,?)',
    [userId, sec.sha256(token), String(req.ip || '').slice(0, 45), String(req.headers['user-agent'] || '').slice(0, 255), new Date(now.getTime() + sessionMs(role))]);
  await db.query('DELETE FROM sessions WHERE user_id = ? AND id NOT IN (SELECT id FROM (SELECT id FROM sessions WHERE user_id = ? ORDER BY id DESC LIMIT 10) x)', [userId, userId]);
  setCookie(req, res, names(req).SID, token, Math.floor(sessionMs(role) / 1000));
  const t = sec.csrfCreate(); req.csrfToken = t; setCookie(req, res, names(req).CSRF, t, 60 * 60 * 24 * 30);
}
async function endSession(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.sessionId) await db.query('DELETE FROM sessions WHERE id = ?', [req.sessionId]);
  setCookie(req, res, names(req).SID, '', 0);
}
const endOtherSessions = (userId: number, keepId?: number) => db.query('DELETE FROM sessions WHERE user_id = ? AND id <> ?', [userId, keepId || 0]);
const endAllSessions = (userId: number) => db.query('DELETE FROM sessions WHERE user_id = ?', [userId]);

function requireAuth(req: IncomingMessage): void {
  if (!req.user) throw new AppError(401, 'unauthorized', 'Masuk dulu untuk melanjutkan.');
}
function requireAdmin(req: IncomingMessage): void {
  if (!adminIpOk(req)) throw new AppError(404, 'not_found', 'Endpoint tidak ditemukan.');
  if (!req.user) throw new AppError(401, 'unauthorized', 'Masuk dulu untuk melanjutkan.');
  if (req.user.role !== 'admin') throw new AppError(403, 'forbidden', 'Akses ditolak.');
  if (config.admin.require2fa && !req.user.twofa) throw new AppError(403, 'twofa_required', 'Aktifkan autentikasi dua langkah (2FA) di menu Akun saya untuk membuka panel admin.');
}
function csrfGuard(req: IncomingMessage): void {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method || '')) return;
  const deny = () => new AppError(403, 'csrf', 'Sesi tidak valid. Muat ulang halaman lalu coba lagi.');
  const origin = req.headers.origin;
  if (origin) {
    let host = ''; try { host = new URL(origin).host; } catch { throw deny(); }
    if (!hostAllowed(host, req) && !(!config.isProd && /^localhost(:\d+)?$/.test(host))) throw deny();
  } else {
    const site = req.headers['sec-fetch-site'];
    if (site && !['same-origin', 'none'].includes(String(site))) throw deny();
  }
  const hdr = req.headers['x-csrf-token'];
  if (typeof hdr !== 'string' || !req.cookieCsrfValid || !sec.safeEqual(hdr, req.csrfToken)) throw deny();
}

export { attach, startSession, endSession, endOtherSessions, endAllSessions, requireAuth, requireAdmin, csrfGuard, publicUser };
