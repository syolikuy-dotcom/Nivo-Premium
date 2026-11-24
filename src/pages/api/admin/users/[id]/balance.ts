import { adminRoute } from '@/server/http/api';
import * as db from '@/server/core/db';
import { audit } from '@/server/core/audit';
import { ok } from '@/server/http/http';
import { AppError } from '@/server/core/errors';
import { lim } from '@/server/http/limits';
import { withLock } from '@/server/core/locks';
import { notifyAdmins } from '@/server/auth/admin-notice';
import { rupiah } from '@/shared/format';
import crypto from 'crypto';
import * as bal from '@/server/shop/balance';
import * as twofa from '@/server/auth/twofa';
import { schemas, fields } from '@/server/http/validate';

export const config = { api: { bodyParser: false } };

const DAILY_CAP = 50_000_000;
const ALERT_FROM = 1_000_000;

export default adminRoute({ method: 'POST', limits: [lim.stepup] }, async (req, res) => {
  const id = fields.id.parse(req.params.id);
  const d = schemas.adminBalance.parse(req.body);
  if (id === req.user.id) throw new AppError(400, 'self', 'Tidak bisa menyesuaikan saldo akun sendiri. Minta admin lain.');
  await twofa.stepUp(req.user, d.password, d.code);
  const out = await withLock('admin-adjust', async () => {
    const used = await db.one("SELECT COALESCE(SUM(ABS(amount)), 0) AS s FROM ledger WHERE type = 'adjust' AND created_at > ?", [new Date(Date.now() - 864e5)]);
    if (Number(used!.s) + Math.abs(d.amount) > DAILY_CAP) throw new AppError(429, 'adjust_cap', `Batas penyesuaian saldo harian (${rupiah(DAILY_CAP)}) tercapai. Coba lagi besok atau hubungi pemilik server.`);
    return db.tx((t) => bal.apply(t, { userId: id, amount: d.amount, type: 'adjust', refType: 'adjust', refId: crypto.randomBytes(8).toString('hex'), note: `Admin: ${d.note || 'penyesuaian'}` }));
  });
  await audit(req.user.id, 'balance_adjust', req, { id, amount: d.amount, note: d.note });
  if (Math.abs(d.amount) >= ALERT_FROM) {
    notifyAdmins(`admin_adjust:${req.user.id}:${id}`, 'Penyesuaian saldo oleh admin', [`Admin @${req.user.username} menyesuaikan saldo pengguna #${id} sebesar ${d.amount > 0 ? '+' : '-'}${rupiah(Math.abs(d.amount))}.`, `Catatan : ${d.note || '-'}`, `IP      : ${req.ip}`, '', 'Jika ini bukan kamu, segera ganti password dan periksa log audit.'].join('\n'), 60e3).catch(() => {});
  }
  ok(res, { balance: out.balance });
});
