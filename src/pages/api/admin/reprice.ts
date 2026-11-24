import { adminRoute } from '@/server/http/api';
import { audit } from '@/server/core/audit';
import { ok } from '@/server/http/http';
import * as products from '@/server/shop/products';

export const config = { api: { bodyParser: false } };

export default adminRoute({ method: 'POST' }, async (req, res) => {
  const n = await products.repriceAll();
  await audit(req.user.id, 'reprice', req, { n });
  ok(res, { updated: n });
});
