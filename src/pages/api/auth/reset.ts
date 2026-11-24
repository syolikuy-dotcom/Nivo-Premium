import { route } from '@/server/http/api';
import * as db from '@/server/core/db';
import * as sec from '@/server/auth/security';
import { lim } from '@/server/http/limits';
import { audit } from '@/server/core/audit';
import { ok } from '@/server/http/http';
import { AppError } from '@/server/core/errors';
import { schemas } from '@/server/http/validate';

export const config = { api: { bodyParser: false } };

export default route({ method: 'POST', limits: [lim.forgot] }, async (req, res) => {
  const d = schemas.reset.parse(req.body);
  const hash = await sec.hashPassword(d.password);
  const done = await db.tx(async (t) => {
    const row = await t.one('SELECT id, user_id FROM password_resets WHERE token_hash = ? AND used_at IS NULL AND expires_at > ? FOR UPDATE', [sec.sha256(d.token), new Date()]);
    if (!row) return false;
    await t.query('UPDATE password_resets SET used_at = ? WHERE id = ?', [new Date(), row.id]);
    await t.query('UPDATE users SET password_hash = ?, failed_logins = 0, locked_until = NULL WHERE id = ?', [hash, row.user_id]);
    await t.query('DELETE FROM sessions WHERE user_id = ?', [row.user_id]);
    return row.user_id;
  });
  if (!done) throw new AppError(400, 'bad_token', 'Tautan reset tidak valid atau sudah kedaluwarsa. Minta tautan baru.');
  await audit(done, 'password_reset', req);
  ok(res, { redirect: '/login' });
});
