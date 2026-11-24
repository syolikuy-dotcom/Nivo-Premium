import { route } from '@/server/http/api';
import * as auth from '@/server/auth/auth';
import { ok } from '@/server/http/http';

export const config = { api: { bodyParser: false } };

export default route({ method: 'POST' }, async (req, res) => {
  await auth.endSession(req, res);
  ok(res, { redirect: '/' });
});
