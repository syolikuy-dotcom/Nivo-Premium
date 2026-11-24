import { userRoute } from '@/server/http/api';
import { lim } from '@/server/http/limits';
import { ok } from '@/server/http/http';
import * as am from '@/server/shop/am';
import { fields } from '@/server/http/validate';

export const config = { api: { bodyParser: false } };

export default userRoute({ method: 'POST', limits: [lim.money] }, async (req, res) => {
  const no = fields.amNo.parse(req.params.no);
  ok(res, am.toView(await am.cancel({ user: req.user, orderNo: no })));
});
