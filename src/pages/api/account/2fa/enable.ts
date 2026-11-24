import { userRoute } from '@/server/http/api';
import { lim } from '@/server/http/limits';
import { ok } from '@/server/http/http';
import { audit } from '@/server/core/audit';
import * as auth from '@/server/auth/auth';
import * as twofa from '@/server/auth/twofa';
import { schemas } from '@/server/http/validate';

export const config = { api: { bodyParser: false } };

export default userRoute({ method: 'POST', limits: [lim.twofa] }, async (req, res) => {
  const d = schemas.twofaEnable.parse(req.body);
  const recoveryCodes = await twofa.enable(req.user, d.code);
  await auth.endOtherSessions(req.user.id, req.sessionId);
  await audit(req.user.id, 'twofa_enable', req);
  ok(res, { recoveryCodes });
});
