import type { IncomingMessage, ServerResponse } from 'http';
import * as db from '../core/db';
import type { Row } from '../core/db';
import * as auth from './auth';
import * as log from '../core/logger';
import { audit } from '../core/audit';
import { notifyAdmins } from './admin-notice';
import { dateTime } from '../../shared/format';

export const MAX_FAILS = 5;
export const LOCK_MIN = 15;

async function knownIp(userId: number, ip: string): Promise<boolean> {
  if (!ip) return false;
  const r = await db.one("SELECT id FROM audit_log WHERE user_id = ? AND action = 'login' AND ip = ? AND created_at > ? LIMIT 1", [userId, ip.slice(0, 45), new Date(Date.now() - 60 * 864e5)]);
  return Boolean(r);
}

export async function reserveAttempt(req: IncomingMessage, userId: number): Promise<number | null> {
  const r = await db.tx(async (t) => {
    const row = await t.one('SELECT failed_logins, locked_until FROM users WHERE id = ? FOR UPDATE', [userId]);
    if (!row) return null;
    const locked = (row.locked_until && new Date(row.locked_until) > new Date()) || Number(row.failed_logins) >= MAX_FAILS;
    if (locked) return null;
    await t.query('UPDATE users SET failed_logins = failed_logins + 1 WHERE id = ?', [userId]);
    return Number(row.failed_logins) + 1;
  });
  if (r !== null) return r;
  return (await knownIp(userId, String(req.ip || ''))) ? 0 : null;
}

export async function refundAttempt(userId: number, n: number | null): Promise<void> {
  if (!n) return;
  await db.query('UPDATE users SET failed_logins = GREATEST(failed_logins - 1, 0) WHERE id = ?', [userId]);
}

export async function recordFailure(req: IncomingMessage, u: Row, action: 'login_failed' | 'twofa_failed', n: number): Promise<boolean> {
  const lock = n >= MAX_FAILS;
  if (lock) await db.query('UPDATE users SET failed_logins = 0, locked_until = ? WHERE id = ?', [new Date(Date.now() + LOCK_MIN * 60e3), u.id]);
  await audit(u.id, lock ? 'login_locked' : action, req);
  log.warn(lock ? 'akun dikunci: terlalu banyak login gagal' : (action === 'twofa_failed' ? 'kode 2FA salah' : 'login gagal'), { user_id: u.id, ip: req.ip, percobaan: n });
  if (u.role === 'admin' && (lock || action === 'twofa_failed')) {
    notifyAdmins(`admin_fail:${u.id}`, lock ? 'Akun admin dikunci (percobaan login gagal)' : 'Kode 2FA admin salah',
      [`Akun admin @${u.username} ${lock ? `dikunci ${LOCK_MIN} menit setelah ${MAX_FAILS} percobaan gagal berturut-turut.` : 'memasukkan kode 2FA yang salah.'}`, '', `IP      : ${req.ip}`, `Waktu   : ${dateTime(Date.now())} WIB`, '', 'Jika ini bukan kamu, segera ganti password dan periksa log audit.'].join('\n'), 30 * 60e3).catch(() => {});
  }
  return lock;
}

export async function complete(req: IncomingMessage, res: ServerResponse, u: Row, opts: { twofa?: boolean } = {}): Promise<{ redirect: string }> {
  const ip = String(req.ip || '').slice(0, 45);
  let newIp = false;
  if (u.role === 'admin') {
    const [any, seen] = await Promise.all([
      db.one("SELECT id FROM audit_log WHERE user_id = ? AND action = 'login' LIMIT 1", [u.id]),
      db.one("SELECT id FROM audit_log WHERE user_id = ? AND action = 'login' AND ip = ? AND created_at > ? LIMIT 1", [u.id, ip, new Date(Date.now() - 60 * 864e5)]),
    ]);
    newIp = Boolean(any) && !seen;
  }
  await db.query('UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = ? WHERE id = ?', [new Date(), u.id]);
  await auth.startSession(req, res, u.id, u.role);
  await audit(u.id, 'login', req, opts.twofa ? { twofa: true } : undefined);
  if (newIp) {
    notifyAdmins(`admin_newip:${u.id}:${ip}`, 'Login admin dari IP baru',
      [`Akun admin @${u.username} masuk dari IP yang belum pernah dipakai dalam 60 hari terakhir.`, '', `IP      : ${ip}`, `Waktu   : ${dateTime(Date.now())} WIB`, `2FA     : ${opts.twofa ? 'ya' : 'tidak'}`, '', 'Jika ini bukan kamu, segera ganti password, aktifkan 2FA, dan isi ADMIN_ALLOWED_IPS.'].join('\n'), 6 * 3600e3).catch(() => {});
  }
  return { redirect: u.role === 'admin' ? '/admin' : '/dashboard' };
}
