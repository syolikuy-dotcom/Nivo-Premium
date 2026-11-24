import { userRoute } from '@/server/http/api';
import { lim } from '@/server/http/limits';
import { ok } from '@/server/http/http';
import * as deposits from '@/server/shop/deposits';
import { fields } from '@/server/http/validate';

export const config = { api: { bodyParser: false } };

export default userRoute({ method: 'POST', limits: [lim.money] }, async (req, res) => {
  const no = fields.depositNo.parse(req.params.no);
  ok(res, await deposits.view(await deposits.cancel(req.user, no)));
});
