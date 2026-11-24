import * as db from '../core/db';
import * as settings from '../core/settings';
import * as log from '../core/logger';
import * as mailer from './mailer';
import { once } from '../core/singleton';

const S = once('adminNotice.cooldown', () => ({} as Record<string, number>));

async function recipients(): Promise<string[]> {
  const s = await settings.get();
  if (s.alert_email) return [s.alert_email];
  const rows = await db.query("SELECT email FROM users WHERE role = 'admin' AND status = 'active' ORDER BY id LIMIT 10");
  return rows.map((r: { email: string }) => r.email);
}

export type Delivery = 'sent' | 'logged' | 'failed';
async function deliver(subject: string, body: string, level: 'warn' | 'info' = 'warn'): Promise<Delivery> {
  log[level](`ALERT: ${subject}`, { detail: body.split('\n').filter(Boolean)[0] });
  if (!mailer.smtpEnabled()) return 'logged';
  try {
    const to = await recipients();
    if (!to.length) return 'logged';
    return (await mailer.sendAlert({ to, subject, text: body })) ? 'sent' : 'logged';
  } catch (e) { log.error('kirim email alert gagal', { subject, msg: e.message }); return 'failed'; }
}

async function notifyAdmins(key: string, subject: string, body: string, cooldownMs = 10 * 60e3): Promise<void> {
  const now = Date.now();
  if (now - (S[key] || 0) < cooldownMs) return;
  S[key] = now;
  await deliver(subject, body).catch(() => {});
}

export { recipients, deliver, notifyAdmins };
