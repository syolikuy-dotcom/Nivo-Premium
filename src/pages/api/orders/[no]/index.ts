import { userRoute } from '@/server/http/api';
import { lim } from '@/server/http/limits';
import { ok } from '@/server/http/http';
import { AppError } from '@/server/core/errors';
import * as orders from '@/server/shop/orders';
import { fields } from '@/server/http/validate';

export const config = { api: { bodyParser: false } };

export default userRoute({ method: 'GET', limits: [lim.poll] }, async (req, res) => {
  const no = fields.orderNo.parse(req.params.no);
  const o = await orders.getForUser(req.user, no, req.params.force === '1');
  if (!o) throw new AppError(404, 'not_found', 'Pesanan tidak ditemukan.');
  ok(res, o);
});
