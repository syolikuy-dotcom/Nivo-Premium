import { userRoute } from '@/server/http/api';
import { lim } from '@/server/http/limits';
import { ok } from '@/server/http/http';
import * as deposits from '@/server/shop/deposits';
import { schemas } from '@/server/http/validate';

export const config = { api: { bodyParser: false } };

export default userRoute({ method: 'POST', limits: [lim.money] }, async (req, res) => {
  const d = schemas.deposit.parse(req.body);
  const dep = await deposits.create({ user: req.user, amount: d.amount, idemKey: d.idemKey });
  ok(res, { depositNo: dep.deposit_no, redirect: `/deposit/${dep.deposit_no}` }, 201);
});
