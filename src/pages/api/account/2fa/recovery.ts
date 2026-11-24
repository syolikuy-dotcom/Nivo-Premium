import { userRoute } from '@/server/http/api';
import { lim } from '@/server/http/limits';
import { ok } from '@/server/http/http';
import { audit } from '@/server/core/audit';
import * as twofa from '@/server/auth/twofa';
import { schemas } from '@/server/http/validate';

export const config = { api: { bodyParser: false } };

export default userRoute({ method: 'POST', limits: [lim.twofa] }, async (req, res) => {
  const d = schemas.twofaConfirm.parse(req.body);
  const recoveryCodes = await twofa.regenerateRecovery(req.user, d.password, d.code);
  await audit(req.user.id, 'twofa_recovery', req);
  ok(res, { recoveryCodes });
});
