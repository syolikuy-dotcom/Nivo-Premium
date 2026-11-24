import { userRoute } from '@/server/http/api';
import { lim } from '@/server/http/limits';
import { ok } from '@/server/http/http';
import { AppError } from '@/server/core/errors';
import * as deposits from '@/server/shop/deposits';
import { fields } from '@/server/http/validate';

export const config = { api: { bodyParser: false } };

export default userRoute({ method: 'GET', limits: [lim.poll] }, async (req, res) => {
  const no = fields.depositNo.parse(req.params.no);
  const d = await deposits.getForUser(req.user, no, req.params.force === '1');
  if (!d) throw new AppError(404, 'not_found', 'Deposit tidak ditemukan.');
  ok(res, d);
});
