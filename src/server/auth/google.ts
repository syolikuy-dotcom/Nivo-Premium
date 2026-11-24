import * as crypto from 'crypto';
import { config } from '../core/config';
import * as sec from './security';
import { AppError } from '../core/errors';
import { RESERVED } from '../http/validate';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
export const STATE_TTL_MS = 10 * 60e3;
export const cookieName = (secure: boolean): string => `${secure ? '__Host-' : ''}nivo_gst`;
export const redirectUri = (): string => `${config.appUrl}/api/auth/google/callback`;

export interface StatePayload { s: string; n: string; v: string; m: 'login' | 'link'; u: number; nx: string; exp: number }
export interface GoogleProfile { sub: string; email: string; name: string }

const b64 = (b: Buffer | string): string => Buffer.from(b).toString('base64url');
const sign = (body: string): string => sec.hmacHex('google-state', body);

/** Hanya path internal yang aman (tanpa //, backslash, atau karakter aneh) yang boleh jadi tujuan setelah login. */
export const safeNextPath = (n: unknown): string => (typeof n === 'string' && n.length <= 300 && /^\/(?![/\\])[\w\-./?=&%#]*$/.test(n) ? n : '');

export function newState(mode: 'login' | 'link', userId: number, next: string, now = Date.now()): StatePayload {
  return { s: sec.randomToken(24), n: sec.randomToken(24), v: sec.randomToken(48), m: mode, u: mode === 'link' ? userId : 0, nx: safeNextPath(next), exp: now + STATE_TTL_MS };
}
export const sealState = (p: StatePayload): string => { const body = b64(JSON.stringify(p)); return `${body}.${sign(body)}`; };
export function openState(token: unknown, now = Date.now()): StatePayload | null {
  if (typeof token !== 'string' || token.length > 1200) return null;
  const i = token.indexOf('.'); if (i < 1) return null;
  const body = token.slice(0, i);
  if (!sec.safeEqual(token.slice(i + 1), sign(body))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!p || typeof p.s !== 'string' || typeof p.n !== 'string' || typeof p.v !== 'string' || (p.m !== 'login' && p.m !== 'link') || typeof p.exp !== 'number' || p.exp < now) return null;
    return { s: p.s, n: p.n, v: p.v, m: p.m, u: Number(p.u) || 0, nx: safeNextPath(p.nx), exp: p.exp };
  } catch { return null; }
}

export function authUrl(p: StatePayload): string {
  const q = new URLSearchParams({
    client_id: config.google.clientId, redirect_uri: redirectUri(), response_type: 'code', scope: 'openid email profile',
    state: p.s, nonce: p.n, code_challenge: crypto.createHash('sha256').update(p.v).digest('base64url'), code_challenge_method: 'S256',
    prompt: 'select_account', access_type: 'online',
  });
  return `${AUTH_URL}?${q.toString()}`;
}

/**
 * Validasi klaim ID token. Token diterima LANGSUNG dari endpoint token Google lewat TLS (bukan dari browser),
 * sehingga sesuai OpenID Connect Core §3.1.3.7 verifikasi tanda tangan boleh dilewati; klaim tetap diperiksa ketat.
 */
export function checkClaims(c: any, nonce: string, now = Date.now()): GoogleProfile {
  const bad = (why: string) => new AppError(400, 'google_invalid', `Token Google tidak valid (${why}).`);
  if (!c || typeof c !== 'object') throw bad('kosong');
  if (!ISSUERS.includes(c.iss)) throw bad('iss');
  const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
  if (!aud.includes(config.google.clientId)) throw bad('aud');
  if (typeof c.exp !== 'number' || c.exp * 1000 < now - 60e3) throw bad('kedaluwarsa');
  if (typeof c.nonce !== 'string' || !sec.safeEqual(c.nonce, nonce)) throw bad('nonce');
  if (typeof c.sub !== 'string' || !/^\d{5,40}$/.test(c.sub)) throw bad('sub');
  if (c.email_verified !== true && c.email_verified !== 'true') throw new AppError(400, 'google_unverified', 'Email Google kamu belum terverifikasi.');
  const email = typeof c.email === 'string' ? c.email.trim().toLowerCase() : '';
  if (!email || email.length > 190 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw bad('email');
  const rawName = typeof c.name === 'string' ? c.name : '';
  return { sub: c.sub, email, name: cleanName(rawName, email) };
}

export function cleanName(raw: string, email: string): string {
  // eslint-disable-next-line no-control-regex
  const n = String(raw || '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (n.length >= 2) return n;
  const local = email.split('@')[0].replace(/[^A-Za-z0-9]+/g, ' ').trim().slice(0, 80);
  return local.length >= 2 ? local : 'Pengguna';
}

/** Buat username valid (3–20 karakter huruf/angka/_) dari email; `taken` mengecek ke DB. */
export async function pickUsername(email: string, taken: (u: string) => Promise<boolean>): Promise<string> {
  let base = email.split('@')[0].replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 14);
  if (base.length < 3) base = `user${base}`.slice(0, 14);
  for (let i = 0; i < 8; i++) {
    const suffix = i === 0 ? '' : String(crypto.randomInt(10, 10 ** Math.min(2 + i, 6)));
    const cand = `${base.slice(0, 20 - suffix.length)}${suffix}`;
    if (RESERVED.has(cand.toLowerCase())) continue;
    if (!(await taken(cand))) return cand;
  }
  return `u${crypto.randomBytes(8).toString('hex')}`.slice(0, 20);
}

export async function exchangeCode(code: string, verifier: string, fetchImpl: typeof fetch = fetch): Promise<any> {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 10000);
  try {
    const res = await fetchImpl(TOKEN_URL, {
      method: 'POST', signal: ac.signal, headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({ code, client_id: config.google.clientId, client_secret: config.google.secret, redirect_uri: redirectUri(), grant_type: 'authorization_code', code_verifier: verifier }).toString(),
    });
    const j: any = await res.json().catch(() => null);
    if (!res.ok || !j || typeof j.id_token !== 'string') throw new AppError(502, 'google_failed', 'Gagal menukar kode dengan Google. Coba lagi.');
    const parts = j.id_token.split('.');
    if (parts.length !== 3) throw new AppError(502, 'google_failed', 'Respons Google tidak valid.');
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch (e: any) {
    if (e instanceof AppError) throw e;
    throw new AppError(502, 'google_failed', 'Tidak bisa terhubung ke Google. Coba lagi sebentar lagi.');
  } finally { clearTimeout(t); }
}
