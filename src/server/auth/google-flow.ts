import type { IncomingMessage, ServerResponse } from 'http';
import * as cookie from 'cookie';
import { config } from '../core/config';
import { isSecure } from '../http/net';
import * as log from '../core/logger';
import { AppError } from '../core/errors';
import * as db from '../core/db';
import * as sec from './security';
import * as auth from './auth';
import * as google from './google';
import { complete } from './login-flow';
import { audit } from '../core/audit';
import { isDup } from '../core/errors';

const LOGIN = '/login';

/**
 * Masuk/daftar dengan profil Google yang sudah tervalidasi. Mengembalikan lokasi redirect (tidak pernah melempar untuk kasus bisnis).
 * - Akun yang sudah terhubung (google_sub sama) → masuk.
 * - Email sudah dipakai akun lain (didaftarkan dengan password; emailnya TIDAK pernah diverifikasi) → TIDAK otomatis ditautkan,
 *   karena penyerang bisa mendaftar lebih dulu dengan email korban. Pengguna harus masuk dengan password lalu menghubungkan Google dari halaman Akun.
 * - Selain itu → akun baru (password acak yang tak diketahui siapa pun; bisa diatur lewat "Lupa password").
 * - Akun admin tidak boleh masuk lewat Google (wajib password + 2FA).
 */
export async function signIn(req: IncomingMessage, res: ServerResponse, p: google.GoogleProfile, st: google.StatePayload): Promise<string> {
  const existing = async () => db.one('SELECT id, username, role, status FROM users WHERE google_sub = ?', [p.sub]);
  const enter = async (u: any): Promise<string> => {
    if (u.status !== 'active') return `${LOGIN}?ge=disabled`;
    if (u.role === 'admin') return `${LOGIN}?ge=admin`;
    const out = await complete(req, res, u);
    await audit(u.id, 'login_google', req);
    return st.nx || out.redirect;
  };

  const linked = await existing();
  if (linked) return enter(linked);
  if (await db.one('SELECT id FROM users WHERE email = ?', [p.email])) return `${LOGIN}?ge=exists`;

  const hash = await sec.hashPassword(`${sec.randomToken(32)}Aa1`);
  for (let i = 0; i < 5; i++) {
    const username = await google.pickUsername(p.email, async (u) => Boolean(await db.one('SELECT id FROM users WHERE username = ?', [u])));
    try {
      const out = await db.query('INSERT INTO users (username, email, name, password_hash, google_sub, last_login_at) VALUES (?,?,?,?,?,?)', [username, p.email, p.name, hash, p.sub, new Date()]);
      const id = Number(out.insertId);
      await auth.startSession(req, res, id);
      await audit(id, 'register_google', req);
      return st.nx || '/dashboard';
    } catch (e) {
      if (isDup(e, 'uq_users_email')) return `${LOGIN}?ge=exists`;
      if (isDup(e, 'uq_users_google_sub')) { const again = await existing(); if (again) return enter(again); }
      if (isDup(e)) continue;
      throw e;
    }
  }
  return `${LOGIN}?ge=failed`;
}

/** Menautkan Google ke akun yang sedang login (konfirmasi kepemilikan = sesi aktif). */
export async function link(req: IncomingMessage, userId: number, p: google.GoogleProfile): Promise<string> {
  const owner = await db.one('SELECT id FROM users WHERE google_sub = ?', [p.sub]);
  if (owner) return Number(owner.id) === userId ? '/account?google=linked' : '/account?google=taken';
  try {
    const r = await db.query('UPDATE users SET google_sub = ? WHERE id = ? AND google_sub IS NULL', [p.sub, userId]);
    if (r.affectedRows !== 1) return '/account?google=already';
  } catch (e) {
    if (isDup(e)) return '/account?google=taken';
    throw e;
  }
  await audit(userId, 'google_link', req);
  return '/account?google=linked';
}

const addCookie = (res: ServerResponse, line: string): void => {
  const prev = res.getHeader('Set-Cookie');
  res.setHeader('Set-Cookie', prev === undefined ? [line] : ([] as string[]).concat(prev as string | string[], line));
};
const stateCookie = (req: IncomingMessage, value: string, maxAge: number): string => {
  const secure = isSecure(req);
  return cookie.serialize(google.cookieName(secure), value, { path: '/', httpOnly: true, sameSite: 'lax', secure, maxAge });
};
const ERR: Record<string, string> = { google_unverified: 'unverified', google_invalid: 'failed', google_failed: 'failed' };

/** Awal alur: simpan state tersegel di cookie dan kembalikan URL Google (atau halaman login bila tak bisa). */
export function begin(req: IncomingMessage & { user?: { id: number } | null }, res: ServerResponse, q: URLSearchParams): string {
  if (!config.google.enabled) return '/login?ge=off';
  const link = q.get('mode') === 'link';
  if (link && !req.user) return '/login?next=%2Faccount';
  if (!link && req.user) return '/dashboard';
  const st = google.newState(link ? 'link' : 'login', req.user ? req.user.id : 0, q.get('next') || '');
  addCookie(res, stateCookie(req, google.sealState(st), Math.floor(google.STATE_TTL_MS / 1000)));
  return google.authUrl(st);
}

/** Akhir alur (callback dari Google): selalu mengembalikan lokasi redirect dan menghapus cookie state. */
export async function finish(req: IncomingMessage & { user?: { id: number } | null }, res: ServerResponse, q: URLSearchParams): Promise<string> {
  if (!config.google.enabled) return '/login?ge=off';
  const st = google.openState(cookie.parse(req.headers.cookie || '')[google.cookieName(isSecure(req))]);
  if (!st) return '/login?ge=expired';
  addCookie(res, stateCookie(req, '', 0));
  const back = (code: string) => (st.m === 'link' ? `/account?google=${code}` : `/login?ge=${code}`);
  if (q.get('error')) return back('cancelled');
  const code = q.get('code') || ''; const state = q.get('state') || '';
  if (!code || code.length > 2048 || !sec.safeEqual(state, st.s)) return back('failed');
  try {
    const profile = google.checkClaims(await google.exchangeCode(code, st.v), st.n);
    if (st.m === 'link') {
      if (!req.user || req.user.id !== st.u) return '/login?next=%2Faccount';
      return await link(req, req.user.id, profile);
    }
    if (req.user) return '/dashboard';
    return await signIn(req, res, profile, st);
  } catch (e: any) {
    if (e instanceof AppError) { log.warn('login google gagal', { code: e.code, msg: e.message }); return back(ERR[e.code] || 'failed'); }
    log.error('login google error', { msg: e && e.message });
    return back('failed');
  }
}
