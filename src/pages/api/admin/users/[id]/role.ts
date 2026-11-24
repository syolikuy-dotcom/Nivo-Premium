import { adminRoute } from '@/server/http/api';
import * as db from '@/server/core/db';
import { audit } from '@/server/core/audit';
import { ok } from '@/server/http/http';
import { AppError } from '@/server/core/errors';
import { lim } from '@/server/http/limits';
import * as twofa from '@/server/auth/twofa';
import { schemas, fields } from '@/server/http/validate';

export const config = { api: { bodyParser: false } };

export default adminRoute({ method: 'POST', limits: [lim.stepup] }, async (req, res) => {
  const id = fields.id.parse(req.params.id); const d = schemas.adminRole.parse(req.body);
  if (id === req.user.id) throw new AppError(400, 'self', 'Tidak bisa mengubah akun sendiri.');
  await twofa.stepUp(req.user, d.password, d.code);
  await db.query('UPDATE users SET role=? WHERE id=?', [d.role, id]);
  await audit(req.user.id, 'user_role', req, { id, role: d.role });
  ok(res, { saved: true });
});
