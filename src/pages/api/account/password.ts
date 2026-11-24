import { userRoute } from '@/server/http/api';
import * as db from '@/server/core/db';
import * as sec from '@/server/auth/security';
import * as auth from '@/server/auth/auth';
import { lim } from '@/server/http/limits';
import { audit } from '@/server/core/audit';
import { ok } from '@/server/http/http';
import { AppError } from '@/server/core/errors';
import { schemas } from '@/server/http/validate';

export const config = { api: { bodyParser: false } };

export default userRoute({ method: 'POST', limits: [lim.write] }, async (req, res) => {
  const d = schemas.changePassword.parse(req.body);
  const u = await db.one('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
  if (!(await sec.verifyPassword(d.current, u!.password_hash))) throw new AppError(400, 'bad_password', 'Password lama salah.');
  await db.query('UPDATE users SET password_hash = ? WHERE id = ?', [await sec.hashPassword(d.password), req.user.id]);
  await auth.endOtherSessions(req.user.id, req.sessionId);
  await audit(req.user.id, 'password_change', req);
  ok(res, { message: 'Password berhasil diganti.' });
});
