import { userRoute } from '@/server/http/api';
import { lim } from '@/server/http/limits';
import { ok } from '@/server/http/http';
import * as am from '@/server/shop/am';
import { schemas } from '@/server/http/validate';

export const config = { api: { bodyParser: false } };

export default userRoute({ method: 'POST', limits: [lim.money] }, async (req, res) => {
  const d = schemas.amSingle.parse(req.body);
  const o = await am.buySingle({ user: req.user, email: d.email, idemKey: d.idemKey });
  ok(res, am.toView(o), 201);
});
