import { userRoute } from '@/server/http/api';
import { lim } from '@/server/http/limits';
import { ok } from '@/server/http/http';
import * as twofa from '@/server/auth/twofa';
import * as settings from '@/server/core/settings';

export const config = { api: { bodyParser: false } };

export default userRoute({ method: 'POST', limits: [lim.twofa] }, async (req, res) => {
  ok(res, await twofa.beginSetup(req.user, (await settings.get()).site_name));
});
