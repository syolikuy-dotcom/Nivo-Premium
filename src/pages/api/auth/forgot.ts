import { route } from '@/server/http/api';
import * as db from '@/server/core/db';
import * as sec from '@/server/auth/security';
import { lim } from '@/server/http/limits';
import { ok, ip } from '@/server/http/http';
import * as log from '@/server/core/logger';
import { config as appConfig } from '@/server/core/config';
import * as turnstile from '@/server/auth/turnstile';
import * as mailer from '@/server/auth/mailer';
import * as settings from '@/server/core/settings';
import { schemas } from '@/server/http/validate';

export const config = { api: { bodyParser: false } };

export default route({ method: 'POST', limits: [lim.forgot] }, async (req, res) => {
  const { email, captcha } = schemas.forgot.parse(req.body);
  await turnstile.check(captcha, ip(req));
  const generic = { message: 'Jika email terdaftar, tautan reset password sudah dikirim. Berlaku 15 menit.' };
  ok(res, generic);
  setImmediate(async () => {
    try {
      const u = await db.one("SELECT id, name, email FROM users WHERE email = ? AND status = 'active'", [email]);
      if (!u) return;
      const recent = await db.one('SELECT COUNT(*) AS n FROM password_resets WHERE user_id = ? AND created_at > ?', [u.id, new Date(Date.now() - 3600e3)]);
      if (Number(recent!.n) >= 3) return;
      await db.query('UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL', [new Date(), u.id]);
      const token = sec.randomToken(32);
      await db.query('INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (?,?,?)', [u.id, sec.sha256(token), new Date(Date.now() + 15 * 60e3)]);
      const s = await settings.get();
      await mailer.sendResetEmail({ to: u.email, name: u.name, link: `${appConfig.appUrl}/reset-password?token=${token}`, siteName: s.site_name });
    } catch (e) { log.error('kirim email reset gagal', { msg: e.message }); }
  });
});
