import { userRoute } from '@/server/http/api';
import * as db from '@/server/core/db';
import { lim } from '@/server/http/limits';
import { ok } from '@/server/http/http';
import { schemas } from '@/server/http/validate';

export const config = { api: { bodyParser: false } };

export default userRoute({ method: 'POST', limits: [lim.write] }, async (req, res) => {
  const { name } = schemas.profile.parse(req.body);
  await db.query('UPDATE users SET name = ? WHERE id = ?', [name, req.user.id]);
  ok(res, { name });
});
