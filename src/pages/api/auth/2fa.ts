import { route } from '@/server/http/api';
import * as db from '@/server/core/db';
import * as sec from '@/server/auth/security';
import * as twofa from '@/server/auth/twofa';
import * as loginFlow from '@/server/auth/login-flow';
import { lim } from '@/server/http/limits';
import { ok } from '@/server/http/http';
import { AppError } from '@/server/core/errors';
import { schemas } from '@/server/http/validate';

export const config = { api: { bodyParser: false } };

const EXPIRED = 'Verifikasi kedaluwarsa. Masuk ulang dengan password.';

export default route({ method: 'POST', limits: [lim.login2fa] }, async (req, res) => {
  const d = schemas.login2fa.parse(req.body);
  const uid = sec.challengeVerify(d.challenge);
  if (!uid) throw new AppError(401, 'challenge_expired', EXPIRED);
  const u = await db.one('SELECT * FROM users WHERE id = ?', [uid]);
  if (!u || u.status !== 'active' || !u.totp_enabled) throw new AppError(401, 'challenge_expired', EXPIRED);
  const LOCKED = `Akun dikunci sementara karena terlalu banyak percobaan. Coba lagi dalam ${loginFlow.LOCK_MIN} menit.`;
  const slot = await loginFlow.reserveAttempt(req, u.id);
  if (slot === null) throw new AppError(429, 'locked', LOCKED);
  if (!(await twofa.checkCode(u.id, d.code))) {
    const locked = await loginFlow.recordFailure(req, u, 'twofa_failed', slot);
    throw new AppError(locked ? 429 : 401, locked ? 'locked' : 'bad_code', locked ? LOCKED : 'Kode salah atau kedaluwarsa. Coba lagi, atau pakai kode pemulihan.');
  }
  ok(res, await loginFlow.complete(req, res, u, { twofa: true }));
});
