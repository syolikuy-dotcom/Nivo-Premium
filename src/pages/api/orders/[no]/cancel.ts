import { userRoute } from '@/server/http/api';
import { lim } from '@/server/http/limits';
import { ok } from '@/server/http/http';
import * as orders from '@/server/shop/orders';
import { fields } from '@/server/http/validate';

export const config = { api: { bodyParser: false } };

export default userRoute({ method: 'POST', limits: [lim.money] }, async (req, res) => {
  const no = fields.orderNo.parse(req.params.no);
  ok(res, await orders.view(await orders.cancelOrder(req.user, no)));
});
