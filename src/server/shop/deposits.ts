import type { Row } from '../core/db';
import * as QRCode from 'qrcode';
import type { DepositListItem, DepositView, SessionUser } from '../../shared/types';
import { config } from '../core/config';
import * as db from '../core/db';
import * as premku from './premku';
import * as sec from '../auth/security';
import * as bal from './balance';
import * as settings from '../core/settings';
import * as log from '../core/logger';
import { rupiah } from '../../shared/format';
import { AppError, isDup } from '../core/errors';
import { withLock } from '../core/locks';

const byId = async (id: number): Promise<Row> => (await db.one('SELECT * FROM deposits WHERE id = ?', [id]))!;
const byNo = (no: string) => db.one('SELECT * FROM deposits WHERE deposit_no = ?', [no]);

async function create({ user, amount, idemKey }: { user: SessionUser; amount: number; idemKey: string }): Promise<Row> {
  const s = await settings.get();
  if (!Number.isInteger(amount) || amount < s.min_deposit || amount > s.max_deposit)
    throw new AppError(400, 'invalid_amount', `Nominal deposit harus antara ${rupiah(s.min_deposit)} dan ${rupiah(s.max_deposit)}.`);
  const reuse = (p: Row) => {
    if (Number(p.amount) !== amount) throw new AppError(409, 'idempotency_conflict', 'Permintaan ini sudah dipakai untuk deposit lain. Muat ulang halaman.');
    if (p.status === 'failed') throw new AppError(502, 'payment_unavailable', 'QRIS sedang tidak tersedia. Coba lagi sebentar lagi.');
    return p;
  };
  const prior = await db.one('SELECT * FROM deposits WHERE user_id = ? AND idem_key = ?', [user.id, idemKey]);
  if (prior) return reuse(prior);
  const n = await db.one("SELECT COUNT(*) AS n FROM deposits WHERE user_id = ? AND status = 'pending' AND created_at > ?", [user.id, new Date(Date.now() - 3600e3)]);
  if (Number(n!.n) >= 3) throw new AppError(429, 'too_many_pending', 'Masih ada deposit menunggu bayar. Selesaikan atau batalkan dulu.');
  let no = null;
  for (let i = 0; i < 4 && !no; i++) {
    const c = sec.newNo('DP');
    try { await db.query("INSERT INTO deposits (deposit_no, user_id, amount, status, idem_key) VALUES (?,?,?,'pending',?)", [c, user.id, amount, idemKey]); no = c; }
    catch (e) {
      if (isDup(e, 'uq_deposits_idem')) return reuse((await db.one('SELECT * FROM deposits WHERE user_id = ? AND idem_key = ?', [user.id, idemKey]))!);
      if (isDup(e, 'uq_deposits_no')) continue;
      throw e;
    }
  }
  if (!no) throw new AppError(500, 'server_error', 'Gagal membuat nomor deposit. Coba lagi.');
  const d = await byNo(no);
  return withLock(`deposit:${d!.id}`, async () => _ensurePayment(await byId(d!.id)));
}

async function _ensurePayment(d: Row) {
  if (d.status !== 'pending' || d.pay_invoice) return d;
  const fail = async (why: string) => {
    await db.query("UPDATE deposits SET status='failed' WHERE id=? AND status='pending' AND pay_invoice IS NULL", [d.id]);
    log.warn('QRIS deposit gagal', { deposit: d.deposit_no, why });
    throw new AppError(502, 'payment_unavailable', 'QRIS sedang tidak tersedia. Coba lagi sebentar lagi.');
  };
  let r;
  try { r = await premku.pay(Number(d.amount)); } catch (e) { return fail(e.message); }
  const amount = Number(d.amount);
  const pr = premku.parsePay(r, amount);
  if (!pr.ok) {
    log.warn('respons deposit Premku tidak valid', { problems: pr.problems.join('; '), shape: pr.shape });
    if (pr.invoice) premku.cancelPay(pr.invoice).catch(() => {});
    return fail(`respons tidak valid: ${pr.problems.join('; ')}`);
  }
  const { invoice, qr, kode, due } = pr;
  try {
    await db.query("UPDATE deposits SET pay_invoice=?, qr=?, unique_code=?, amount_due=?, expires_at=? WHERE id=? AND status='pending' AND pay_invoice IS NULL",
      [String(invoice).slice(0, 64), qr.startsWith('data:image') ? qr.slice(0, 60000) : qr.slice(0, 2000), kode, due, new Date(Date.now() + config.orderTtlMin * 60e3), d.id]);
  } catch (e) {
    if (isDup(e, 'uq_deposits_pay_invoice')) return fail('invoice pembayaran ganda dari supplier');
    throw e;
  }
  return byId(d.id);
}

async function _credit(d: Row) {
  await db.tx(async (t) => {
    const r = await t.query("UPDATE deposits SET status='paid', credited_at=? WHERE id=? AND status='pending'", [new Date(), d.id]);
    if (r.affectedRows === 1) await bal.apply(t, { userId: d.user_id, amount: Number(d.amount), type: 'deposit', refType: 'deposit', refId: d.deposit_no, note: 'Deposit saldo' });
  });
  return byId(d.id);
}
async function _check(d: Row, force?: boolean): Promise<Row> {
  const expired = d.expires_at && new Date(d.expires_at) <= new Date();
  if (!force && !expired && d.last_check_at && Date.now() - new Date(d.last_check_at).getTime() < 2000) return d;
  let st;
  try { st = premku.normPay((await premku.payStatus(d.pay_invoice)).data?.status); } catch (e) { log.warn('cek deposit gagal', { deposit: d.deposit_no, msg: e.message }); return d; }
  await db.query('UPDATE deposits SET last_check_at=? WHERE id=?', [new Date(), d.id]);
  if (st === 'paid') return _credit(d);
  if (st === 'canceled' || st === 'expired') { await db.query("UPDATE deposits SET status=? WHERE id=? AND status='pending'", [st === 'canceled' ? 'canceled' : 'expired', d.id]); return byId(d.id); }
  if (expired) {
    try { await premku.cancelPay(d.pay_invoice); }
    catch { try { if (premku.normPay((await premku.payStatus(d.pay_invoice)).data?.status) === 'paid') return _credit(d); } catch { return d; } }
    await db.query("UPDATE deposits SET status='expired' WHERE id=? AND status='pending'", [d.id]);
    return byId(d.id);
  }
  return d;
}
const reconcile = (id: number, { force = false } = {}) => withLock(`deposit:${id}`, async () => {
  let d = await byId(id);
  if (!d || d.status !== 'pending') return d;
  if (!d.pay_invoice) {
    if (Date.now() - new Date(d.created_at).getTime() > 60e3) { await db.query("UPDATE deposits SET status='failed' WHERE id=? AND status='pending' AND pay_invoice IS NULL", [id]); d = await byId(id); }
    return d;
  }
  return _check(d, force);
});

async function cancel(user: SessionUser, no: string): Promise<Row> {
  const f = await db.one('SELECT id FROM deposits WHERE deposit_no = ? AND user_id = ?', [no, user.id]);
  if (!f) throw new AppError(404, 'not_found', 'Deposit tidak ditemukan.');
  return withLock(`deposit:${f.id}`, async () => {
    let d = await byId(f.id);
    if (d!.status !== 'pending') throw new AppError(409, 'not_cancelable', 'Deposit ini sudah tidak bisa dibatalkan.');
    if (d!.pay_invoice) {
      d = await _check(d, true);
      if (d!.status !== 'pending') return d;
      try { await premku.cancelPay(d!.pay_invoice); }
      catch (e) {
        if (e.kind !== 'definitive') throw new AppError(502, 'try_again', 'Gagal membatalkan. Coba lagi sebentar lagi.');
        try { if (premku.normPay((await premku.payStatus(d!.pay_invoice)).data?.status) === 'paid') return _credit(d); }
        catch { throw new AppError(502, 'try_again', 'Gagal membatalkan. Coba lagi sebentar lagi.'); }
      }
    }
    await db.query("UPDATE deposits SET status='canceled' WHERE id=? AND status='pending'", [d!.id]);
    return byId(d!.id);
  });
}

async function view(d: Row): Promise<DepositView> {
  return {
    depositNo: d.deposit_no, amount: Number(d.amount), amountDue: Number(d.amount_due), uniqueCode: d.unique_code, status: d.status,
    createdAt: d.created_at, expiresAt: d.expires_at,
    qr: d.status === 'pending' && d.qr ? (d.qr.startsWith('data:image') ? d.qr : await QRCode.toDataURL(d.qr, { errorCorrectionLevel: 'M', margin: 1, width: 320 })) : null,
  };
}
async function getForUser(user: SessionUser, no: string, force = false): Promise<DepositView | null> {
  const f = await db.one('SELECT id FROM deposits WHERE deposit_no = ? AND user_id = ?', [no, user.id]);
  return f ? view(await reconcile(f.id, { force })) : null;
}
const listForUser = async (userId: number, limit = 20): Promise<DepositListItem[]> => (await db.query(
  'SELECT deposit_no, amount, status, created_at FROM deposits WHERE user_id = ? ORDER BY id DESC LIMIT ?', [userId, limit]))
  .map((r: Row) => ({ depositNo: r.deposit_no, amount: Number(r.amount), status: r.status, createdAt: r.created_at }));
async function sweep() {
  for (const r of await db.query("SELECT id FROM deposits WHERE status='pending' ORDER BY last_check_at, id LIMIT 40"))
    await reconcile(r.id).catch((e) => log.error('sweep deposit gagal', { id: r.id, msg: e.message }));
}
export { create, reconcile, cancel, getForUser, listForUser, view, sweep };
