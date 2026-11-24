import { route } from '@/server/http/api';
import { lim } from '@/server/http/limits';
import * as flow from '@/server/auth/google-flow';

export const config = { api: { bodyParser: false } };

export default route({ method: 'GET', csrf: false, limits: [lim.oauth] }, async (req, res) => {
  const to = flow.begin(req, res, new URL(req.url || '/', 'http://x').searchParams);
  res.statusCode = 302; res.setHeader('Location', to); res.setHeader('Cache-Control', 'no-store'); res.end();
});
