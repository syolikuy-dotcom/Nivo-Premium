import { adminRoute } from '@/server/http/api';
import { audit } from '@/server/core/audit';
import { ok } from '@/server/http/http';
import * as am from '@/server/shop/am';
import { fields } from '@/server/http/validate';

export const config = { api: { bodyParser: false } };

export default adminRoute({ method: 'POST' }, async (req, res) => {
  const o = await am.adminRefund(fields.amNo.parse(req.params.no));
  await audit(req.user.id, 'am_refund', req, { no: o.order_no });
  ok(res, { status: o.status });
});
