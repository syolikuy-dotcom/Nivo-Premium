import { adminRoute } from '@/server/http/api';
import * as db from '@/server/core/db';
import * as auth from '@/server/auth/auth';
import { audit } from '@/server/core/audit';
import { ok } from '@/server/http/http';
import { AppError } from '@/server/core/errors';
import { schemas, fields } from '@/server/http/validate';

export const config = { api: { bodyParser: false } };

export default adminRoute({ method: 'POST' }, async (req, res) => {
  const id = fields.id.parse(req.params.id); const d = schemas.adminStatus.parse(req.body);
  if (id === req.user.id) throw new AppError(400, 'self', 'Tidak bisa mengubah akun sendiri.');
  await db.query('UPDATE users SET status=? WHERE id=?', [d.status, id]);
  if (d.status === 'disabled') await auth.endAllSessions(id);
  await audit(req.user.id, 'user_status', req, { id, status: d.status });
  ok(res, { saved: true });
});
