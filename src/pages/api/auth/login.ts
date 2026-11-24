import { route } from '@/server/http/api';
import * as db from '@/server/core/db';
import * as sec from '@/server/auth/security';
import { lim } from '@/server/http/limits';
import { ok, ip } from '@/server/http/http';
import { AppError } from '@/server/core/errors';
import * as turnstile from '@/server/auth/turnstile';
import * as loginFlow from '@/server/auth/login-flow';
import { schemas } from '@/server/http/validate';

export const config = { api: { bodyParser: false } };

const BAD = 'Username/email atau password salah.';

export default route({ method: 'POST', limits: [lim.login] }, async (req, res) => {
  const d = schemas.login.parse(req.body);
  await turnstile.check(d.captcha, ip(req));
  const u = await db.one('SELECT * FROM users WHERE username = ? OR email = ? LIMIT 1', [d.identifier, d.identifier.toLowerCase()]);
  const LOCKED = new AppError(429, 'locked', `Akun dikunci sementara karena terlalu banyak percobaan. Coba lagi dalam ${loginFlow.LOCK_MIN} menit.`);
  const slot = u ? await loginFlow.reserveAttempt(req, u.id) : null;
  if (u && slot === null) { await sec.dummyVerify(d.password); throw LOCKED; }
  const good = u ? await sec.verifyPassword(d.password, u.password_hash) : await sec.dummyVerify(d.password);
  if (!u || !good) {
    if (u && (await loginFlow.recordFailure(req, u, 'login_failed', slot as number))) throw LOCKED;
    throw new AppError(401, 'bad_credentials', BAD);
  }
  if (u.status !== 'active') throw new AppError(403, 'disabled', 'Akun ini dinonaktifkan. Hubungi admin.');
  if (sec.needsRehash(u.password_hash)) await db.query('UPDATE users SET password_hash = ? WHERE id = ?', [await sec.hashPassword(d.password), u.id]).catch(() => {});
  if (u.totp_enabled) { await loginFlow.refundAttempt(u.id, slot); return ok(res, { twofa: true, challenge: sec.challengeCreate(u.id) }); }
  ok(res, await loginFlow.complete(req, res, u));
});
