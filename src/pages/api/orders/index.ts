import { userRoute } from '@/server/http/api';
import { lim } from '@/server/http/limits';
import { ok } from '@/server/http/http';
import * as orders from '@/server/shop/orders';
import { schemas } from '@/server/http/validate';

export const config = { api: { bodyParser: false } };

export default userRoute({ method: 'POST', limits: [lim.money, lim.order] }, async (req, res) => {
  const d = schemas.order.parse(req.body);
  const o = await orders.createOrder({ user: req.user, ...d });
  ok(res, { orderNo: o.order_no, redirect: `/orders/${o.order_no}` }, 201);
});
