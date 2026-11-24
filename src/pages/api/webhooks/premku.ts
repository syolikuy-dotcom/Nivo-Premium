import { route } from '@/server/http/api';
import { lim } from '@/server/http/limits';
import { webhook } from '@/server/shop/webhook';

export const config = { api: { bodyParser: false } };

export default route({ method: 'POST', session: false, body: 'raw', maxBytes: 64 * 1024, limits: [lim.webhook] }, webhook);
