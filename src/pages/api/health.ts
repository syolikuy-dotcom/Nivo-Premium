import { route } from '@/server/http/api';
import { lim } from '@/server/http/limits';
import { sendJson } from '@/server/http/http';
import * as monitor from '@/server/shop/monitor';

export const config = { api: { bodyParser: false } };

export default route({ method: ['GET', 'HEAD'], session: false, body: 'none', limits: [lim.health] }, async (_req, res) => {
  const r = await monitor.liveness();
  sendJson(res, r.ok ? 200 : 503, { ok: r.ok });
});
