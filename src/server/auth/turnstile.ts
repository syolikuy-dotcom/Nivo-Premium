import { config } from '../core/config';
import * as log from '../core/logger';
import { AppError } from '../core/errors';

const URL_VERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const enabled = config.turnstile.enabled;

async function verify(token: string | undefined, ip?: string): Promise<boolean> {
  if (typeof token !== 'string' || token.length < 10 || token.length > 2048) return false;
  const body = new URLSearchParams({ secret: config.turnstile.secret, response: token });
  if (ip) body.set('remoteip', String(ip));
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(URL_VERIFY, { method: 'POST', body, signal: ctrl.signal, redirect: 'error' });
    const j = (await res.json()) as { success?: boolean; 'error-codes'?: string[] };
    if (j.success !== true) log.warn('turnstile ditolak', { codes: (j['error-codes'] || []).join(','), ip });
    return j.success === true;
  } catch (e) {
    log.error('turnstile tidak bisa dihubungi', { msg: e.name === 'AbortError' ? 'timeout' : e.message });
    return false;
  } finally { clearTimeout(timer); }
}

async function require_(token: string | undefined, ip?: string): Promise<void> {
  if (!enabled) return;
  if (!(await verify(token, ip))) throw new AppError(400, 'captcha', 'Verifikasi keamanan gagal atau kedaluwarsa. Selesaikan verifikasi lalu coba lagi.');
}
export { enabled, verify };
export const check = require_;
