import { adminRoute } from '@/server/http/api';
import { audit } from '@/server/core/audit';
import { ok } from '@/server/http/http';
import * as products from '@/server/shop/products';

export const config = { api: { bodyParser: false } };

export default adminRoute({ method: 'POST' }, async (req, res) => {
  const out = await products.sync();
  await audit(req.user.id, 'sync_products', req, out);
  ok(res, out);
});
