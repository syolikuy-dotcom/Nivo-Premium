import { adminRoute } from '@/server/http/api';
import { audit } from '@/server/core/audit';
import { ok } from '@/server/http/http';
import * as monitor from '@/server/shop/monitor';

export const config = { api: { bodyParser: false } };

export default adminRoute({ method: ['GET', 'POST'] }, async (req, res) => {
  const refresh = req.method === 'POST';
  const v = await monitor.snapshot({ refresh });
  if (refresh) await audit(req.user.id, 'health_refresh', req);
  ok(res, v);
});
