import { userRoute } from '@/server/http/api';
import { lim } from '@/server/http/limits';
import { ok } from '@/server/http/http';
import { audit } from '@/server/core/audit';
import * as auth from '@/server/auth/auth';
import * as twofa from '@/server/auth/twofa';
import { notifyAdmins } from '@/server/auth/admin-notice';
import { schemas } from '@/server/http/validate';

export const config = { api: { bodyParser: false } };

export default userRoute({ method: 'POST', limits: [lim.twofa] }, async (req, res) => {
  const d = schemas.twofaConfirm.parse(req.body);
  await twofa.disable(req.user, d.password, d.code);
  await auth.endOtherSessions(req.user.id, req.sessionId);
  await audit(req.user.id, 'twofa_disable', req);
  notifyAdmins(`twofa_off:${req.user.id}`, '2FA admin dinonaktifkan', `Admin @${req.user.username} menonaktifkan 2FA dari IP ${req.ip}.`, 3600e3).catch(() => {});
  ok(res, { disabled: true });
});
