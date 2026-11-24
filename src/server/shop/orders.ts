import type { Row } from '../core/db';
import * as QRCode from 'qrcode';
import type { Account, OrderView, OrderListItem, SessionUser } from '../../shared/types';
import { config } from '../core/config';
import * as db from '../core/db';
import * as premku from './premku';
import * as sec from '../auth/security';
import * as bal from './balance';
import * as products from './products';
import * as log from '../core/logger';
import { PremkuError } from './premku';
import { looksLikeAuthError } from './resilience';
import { AppError, isDup } from '../core/errors';
import { withLock } from '../core/locks';
import * as settings from '../core/settings';
import * as notify from './notify';
import { buildAccountsTxt, accountsFilename } from './export';

const MAX_ATTEMPTS = 15;
const SLOW_MS = 5 * 60e3;
const FRESH_MS = 2000;
const RETRY_MS = 5000;
const byId = async (id: number): Promise<Row> => (await db.one('SELECT * FROM orders WHERE id = ?', [id]))!;
const byNo = (no: string) => db.one('SELECT * FROM orders WHERE order_no = ?', [no]);
const INSERT = 'INSERT INTO orders (order_no,user_id,product_id,product_name,qty,unit_price,total,pay_method,status,idem_key,premku_ref,paid_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)';

type Method = 'qris' | 'balance';
interface Want { productId: number; qty: number; method: Method }
function reuse(prior: Row, want: Want): Row {
  if (Number(prior.product_id) !== want.productId || prior.qty !== want.qty || prior.pay_method !== want.method)
    throw new AppError(409, 'idempotency_conflict', 'Permintaan ini sudah dipakai untuk pesanan lain. Muat ulang halaman lalu coba lagi.');
  if (prior.status === 'failed' && !prior.refunded_at && !prior.pay_invoice)
    throw new AppError(502, 'payment_unavailable', 'Pembayaran QRIS sedang tidak tersedia. Coba lagi sebentar lagi atau bayar pakai saldo.');
  return prior;
}

async function createOrder({ user, productId, qty, method, idemKey }: { user: SessionUser; productId: number; qty: number; method: Method; idemKey: string }): Promise<Row> {
  const want = { productId, qty, method };
  const prior = await db.one('SELECT * FROM orders WHERE user_id = ? AND idem_key = ?', [user.id, idemKey]);
  if (prior) return reuse(prior, want);

  const product = await products.rowById(productId);
  if (!product || !product.premku_id) throw new AppError(404, 'product_not_found', 'Produk tidak ditemukan atau sedang tidak dijual.');
  const sup = premku.health().state;
  if (sup === 'down' || sup === 'auth') throw new AppError(503, 'supplier_down', 'Pengiriman produk sedang gangguan. Pesanan belum dibuat dan saldo kamu tidak terpotong. Coba lagi beberapa menit lagi.');
  let stock = product.stock;
  try { stock = await products.liveStock(product); } catch (e) { log.warn('stok realtime gagal, pakai cache', { msg: e.message }); }
  if (stock < qty) throw new AppError(409, 'out_of_stock', stock > 0 ? `Stok tersisa ${stock}.` : 'Stok habis.');
  const unit = Number(product.price);
  if (!(unit > 0)) throw new AppError(409, 'price_unavailable', 'Harga produk belum tersedia.');
  const total = unit * qty;

  const inflight = await db.one("SELECT COUNT(*) AS n FROM orders WHERE user_id = ? AND status IN ('paid','processing')", [user.id]);
  if (Number(inflight!.n) >= 10) throw new AppError(429, 'too_many_inflight', 'Masih ada beberapa pesananmu yang sedang diproses. Tunggu sampai selesai sebelum memesan lagi.');
  if (method === 'qris') {
    const n = await db.one("SELECT COUNT(*) AS n FROM orders WHERE user_id = ? AND status = 'pending' AND created_at > ?", [user.id, new Date(Date.now() - 3600e3)]);
    if (Number(n!.n) >= 5) throw new AppError(429, 'too_many_pending', 'Masih ada beberapa pesanan menunggu bayar. Selesaikan atau batalkan dulu.');
  }

  let orderNo = null;
  for (let i = 0; i < 4 && !orderNo; i++) {
    const no = sec.newNo('PT');
    try {
      if (method === 'balance') {
        await db.tx(async (t) => {
          // Urutan penting: kunci baris pengguna (FOR UPDATE di bal.apply) SEBELUM INSERT pesanan. INSERT memegang kunci bersama (FK ke users);
          // meminta kunci eksklusif sesudahnya membuat pembelian paralel milik pengguna yang sama saling deadlock.
          await bal.apply(t, { userId: user.id, amount: -total, type: 'purchase', refType: 'order', refId: no, note: `Pembelian ${product.name}`.slice(0, 160) });
          await t.query(INSERT, [no, user.id, product.id, product.name, qty, unit, total, 'balance', 'paid', idemKey, no, new Date()]);
        });
      } else {
        await db.query(INSERT, [no, user.id, product.id, product.name, qty, unit, total, 'qris', 'pending', idemKey, no, null]);
      }
      orderNo = no;
    } catch (e) {
      if (isDup(e, 'uq_orders_idem')) return reuse((await db.one('SELECT * FROM orders WHERE user_id = ? AND idem_key = ?', [user.id, idemKey]))!, want);
      if (e instanceof AppError && e.code === 'insufficient_balance') {
        // Permintaan kembar yang kalah balapan: pesanan dari kunci yang sama sudah dibuat pemenangnya → kembalikan itu, bukan 402.
        const winner = await db.one('SELECT * FROM orders WHERE user_id = ? AND idem_key = ?', [user.id, idemKey]);
        if (winner) return reuse(winner, want);
      }
      if (isDup(e, 'uq_orders_no') || isDup(e, 'uq_orders_ref')) continue;
      throw e;
    }
  }
  if (!orderNo) throw new AppError(500, 'server_error', 'Gagal membuat nomor pesanan. Coba lagi.');
  const order = (await byNo(orderNo))!;
  if (method === 'qris') return ensurePayment(order);
  setImmediate(() => reconcile(order!.id).catch((e) => log.error('fulfill awal gagal', { order: orderNo, msg: e.message })));
  return order;
}

async function _ensurePayment(o: Row) {
  if (o.status !== 'pending' || o.pay_method !== 'qris' || o.pay_invoice) return o;
  const fail = async (why: string) => {
    await db.query("UPDATE orders SET status='failed', fail_reason=? WHERE id=? AND status='pending' AND pay_invoice IS NULL", [`QRIS: ${why}`.slice(0, 250), o.id]);
    throw new AppError(502, 'payment_unavailable', 'Pembayaran QRIS sedang tidak tersedia. Coba lagi sebentar lagi atau bayar pakai saldo.');
  };
  let r;
  try { r = await premku.pay(Number(o.total)); } catch (e) { return fail(e.message); }
  const total = Number(o.total);
  const pr = premku.parsePay(r, total);
  if (!pr.ok) {
    log.warn('respons QRIS order Premku tidak valid', { order: o.order_no, problems: pr.problems.join('; '), shape: pr.shape });
    if (pr.invoice) premku.cancelPay(pr.invoice).catch(() => {});
    return fail(`respons tidak valid: ${pr.problems.join('; ')}`);
  }
  const d = { invoice: pr.invoice, qr_raw: pr.qr }; const due = pr.due; const uniq = pr.kode;
  try {
    await db.query("UPDATE orders SET pay_invoice=?, pay_qr=?, pay_unique=?, amount_due=?, expires_at=? WHERE id=? AND status='pending' AND pay_invoice IS NULL",
      [String(d.invoice).slice(0, 64), (d.qr_raw.startsWith('data:image') ? d.qr_raw.slice(0, 60000) : d.qr_raw.slice(0, 2000)), uniq, due, new Date(Date.now() + config.orderTtlMin * 60e3), o.id]);
  } catch (e) {
    if (isDup(e, 'uq_orders_pay_invoice')) return fail('invoice pembayaran ganda dari supplier');
    throw e;
  }
  return byId(o.id);
}
const ensurePayment = (o: Row) => withLock(`order:${o.id}`, async () => _ensurePayment(await byId(o.id)));

async function _markPaid(o: Row) {
  await db.query("UPDATE orders SET status='paid', paid_at=? WHERE id=? AND status='pending'", [new Date(), o.id]);
  return byId(o.id);
}

async function _checkPayment(o: Row, force?: boolean): Promise<Row> {
  const expired = o.expires_at && new Date(o.expires_at) <= new Date();
  const fresh = o.last_check_at && Date.now() - new Date(o.last_check_at).getTime() < FRESH_MS;
  if (!force && fresh && !expired) return o;
  let st;
  try { st = premku.normPay((await premku.payStatus(o.pay_invoice)).data?.status); }
  catch (e) { log.warn('cek pembayaran gagal', { order: o.order_no, msg: e.message }); return o; }
  await db.query('UPDATE orders SET last_check_at=? WHERE id=?', [new Date(), o.id]);
  if (st === 'paid') return _markPaid(o);
  if (st === 'canceled' || st === 'expired') {
    await db.query("UPDATE orders SET status=? WHERE id=? AND status='pending'", [st === 'canceled' ? 'canceled' : 'expired', o.id]);
    return byId(o.id);
  }
  if (expired) {
    try { await premku.cancelPay(o.pay_invoice); }
    catch {
      try { if (premku.normPay((await premku.payStatus(o.pay_invoice)).data?.status) === 'paid') return _markPaid(o); }
      catch { return o; }
    }
    await db.query("UPDATE orders SET status='expired' WHERE id=? AND status='pending'", [o.id]);
    return byId(o.id);
  }
  return o;
}

async function _complete(id: number, invoice: unknown, accounts: Account[]): Promise<boolean> {
  const r = await db.query("UPDATE orders SET status='success', premku_invoice=?, accounts_enc=?, completed_at=?, fail_reason=NULL WHERE id=? AND status IN ('paid','processing')",
    [invoice ? String(invoice).slice(0, 64) : null, sec.encrypt(accounts), new Date(), id]);
  if (r.affectedRows === 1) { notify.queue(id); return true; }
  return false;
}
async function _refund(o: Row, reason: string) {
  await db.tx(async (t) => {
    const r = await t.query("UPDATE orders SET status='failed', fail_reason=?, refunded_at=? WHERE id=? AND status IN ('paid','processing') AND refunded_at IS NULL", [String(reason).slice(0, 250), new Date(), o.id]);
    if (r.affectedRows === 1) await bal.apply(t, { userId: o.user_id, amount: Number(o.total), type: 'refund', refType: 'order', refId: o.order_no, note: `Refund ${o.order_no}` });
  });
  return byId(o.id);
}
async function _fulfill(o: Row) {
  if (!['paid', 'processing'].includes(o.status)) return o;
  if (o.status === 'processing' && o.last_check_at && Date.now() - new Date(o.last_check_at).getTime() < RETRY_MS) return o;
  if (o.attempts >= MAX_ATTEMPTS && o.last_check_at && Date.now() - new Date(o.last_check_at).getTime() < SLOW_MS) return o;
  const p = await db.one('SELECT premku_id FROM products WHERE id = ?', [o.product_id]);
  if (!p || !p.premku_id) return _refund(o, 'Produk tidak terhubung ke supplier');
  if (!premku.available()) { if (o.status === 'paid') await db.query("UPDATE orders SET status='processing' WHERE id=? AND status='paid'", [o.id]); return byId(o.id); }
  await db.query("UPDATE orders SET status='processing', attempts=attempts+1, last_check_at=? WHERE id=? AND status IN ('paid','processing')", [new Date(), o.id]);
  try {
    const r = await premku.order({ product_id: p.premku_id, qty: o.qty, ref_id: o.premku_ref });
    const d = (r.data && typeof r.data === 'object' && !Array.isArray(r.data) ? r.data : {}) as Record<string, any>;
    const gotInvoice = d.invoice || (r as Record<string, any>).invoice;
    if (gotInvoice) await db.query('UPDATE orders SET premku_invoice=? WHERE id=? AND premku_invoice IS NULL', [String(gotInvoice).slice(0, 64), o.id]);
    let accounts = premku.extractAccounts(r);
    const invoice = gotInvoice || o.premku_invoice;
    if (!accounts.length && invoice) {
      try {
        const st = await premku.status(String(invoice));
        accounts = premku.extractAccounts(st);
        if (!accounts.length) log.warn('status Premku tanpa akun', { order: o.order_no, status: String(st.status || '').slice(0, 30), shape: premku.shapeOf(st) });
      } catch (e) { log.warn('cek status Premku gagal', { order: o.order_no, msg: e.message }); }
    }
    if (!accounts.length) {
      log.warn('respons order Premku tanpa akun yang bisa dibaca', { order: o.order_no, status: String(d.status || '').slice(0, 30), shape: premku.shapeOf(r) });
      throw new PremkuError('ambiguous', 'akun kosong');
    }
    if (accounts.length < o.qty) {
      log.warn('jumlah akun kurang dari qty, pesanan ditahan untuk dicek admin', { order: o.order_no, got: accounts.length, qty: o.qty });
      await db.query("UPDATE orders SET fail_reason=? WHERE id=? AND status='processing'", [`Akun diterima ${accounts.length} dari ${o.qty}: perlu dicek admin`, o.id]);
      throw new PremkuError('ambiguous', 'jumlah akun kurang dari qty');
    }
    await _complete(o.id, invoice, accounts);
  } catch (e) {
    if (e instanceof PremkuError && e.kind === 'definitive' && !looksLikeAuthError(e.message)) return _refund(await byId(o.id), e.message);
    log.warn('pengiriman tertunda, akan dicoba lagi', { order: o.order_no, msg: e.message });
    if (o.attempts + 1 >= MAX_ATTEMPTS) await db.query("UPDATE orders SET fail_reason='Perlu dicek admin' WHERE id=?", [o.id]);
  }
  return byId(o.id);
}

function reconcile(id: number, { force = false } = {}) {
  return withLock(`order:${id}`, async () => {
    let o = await byId(id);
    if (!o) return null;
    if (o.status === 'pending' && o.pay_method === 'qris') {
      if (!o.pay_invoice) {
        if (Date.now() - new Date(o.created_at).getTime() > 60e3) { await db.query("UPDATE orders SET status='failed', fail_reason='QRIS tidak sempat dibuat' WHERE id=? AND status='pending' AND pay_invoice IS NULL", [o.id]); o = await byId(id); }
        return o;
      }
      o = await _checkPayment(o, force);
    }
    if (o!.status === 'paid' || o!.status === 'processing') o = await _fulfill(o);
    return o;
  });
}

async function cancelOrder(user: SessionUser, orderNo: string): Promise<Row> {
  const f = await db.one('SELECT id FROM orders WHERE order_no = ? AND user_id = ?', [orderNo, user.id]);
  if (!f) throw new AppError(404, 'not_found', 'Pesanan tidak ditemukan.');
  return withLock(`order:${f.id}`, async () => {
    let o = await byId(f.id);
    if (o!.status !== 'pending') throw new AppError(409, 'not_cancelable', 'Pesanan ini sudah tidak bisa dibatalkan.');
    if (o!.pay_invoice) {
      o = await _checkPayment(o, true);
      if (o!.status !== 'pending') return o!.status === 'paid' ? _fulfill(o) : o;
      try { await premku.cancelPay(o!.pay_invoice); }
      catch (e) {
        if (e.kind !== 'definitive') throw new AppError(502, 'try_again', 'Gagal membatalkan. Coba lagi sebentar lagi.');
        try { if (premku.normPay((await premku.payStatus(o!.pay_invoice)).data?.status) === 'paid') return _fulfill(await _markPaid(o)); }
        catch { throw new AppError(502, 'try_again', 'Gagal membatalkan. Coba lagi sebentar lagi.'); }
      }
    }
    await db.query("UPDATE orders SET status='canceled' WHERE id=? AND status='pending'", [o!.id]);
    return byId(o!.id);
  });
}

async function applyWebhookSuccess({ refId, invoice, qty, accounts }: { refId: string; invoice: unknown; qty: number; accounts: Account[] }): Promise<'unknown' | 'noop' | 'mismatch' | 'completed' | 'conflict'> {
  const f = await db.one('SELECT id FROM orders WHERE premku_ref = ?', [String(refId).slice(0, 40)]);
  if (!f) return 'unknown';
  return withLock(`order:${f.id}`, async () => {
    const o = await byId(f.id);
    if (o!.status === 'success') return 'noop';
    if (accounts.length < o!.qty || o!.qty !== qty || !accounts.length) return 'mismatch';
    if (o!.status === 'paid' || o!.status === 'processing') return (await _complete(o!.id, invoice, accounts)) ? 'completed' : 'noop';
    return 'conflict';
  });
}

async function view(o: Row): Promise<OrderView> {
  const out: OrderView = {
    orderNo: o.order_no, product: o.product_name, qty: o.qty, unitPrice: Number(o.unit_price), total: Number(o.total), method: o.pay_method, status: o.status,
    createdAt: o.created_at, expiresAt: o.expires_at, amountDue: Number(o.amount_due), uniqueCode: o.pay_unique, paidAt: o.paid_at, completedAt: o.completed_at,
    refunded: Boolean(o.refunded_at), qr: null, accounts: null, note: null,
  };
  if (o.status === 'pending' && o.pay_qr) out.qr = o.pay_qr.startsWith('data:image') ? o.pay_qr : await QRCode.toDataURL(o.pay_qr, { errorCorrectionLevel: 'M', margin: 1, width: 320 });
  if (o.status === 'success') out.accounts = sec.decrypt(o.accounts_enc) || [];
  if (o.status === 'processing' || o.status === 'paid') out.note = 'Pembayaran diterima. Produk sedang disiapkan, halaman ini akan diperbarui otomatis.';
  if (o.status === 'failed') out.note = o.refunded_at ? 'Pesanan gagal diproses. Dananya sudah dikembalikan ke saldo kamu.' : 'Pesanan gagal dibuat. Tidak ada dana yang terpotong.';
  if ((o.status === 'processing' || o.status === 'paid') && premku.health().state !== 'ok') out.note = 'Pembayaran diterima. Pengiriman tertunda karena gangguan di supplier; pesananmu dicoba ulang otomatis dan dana kamu aman.';
  if (o.status === 'processing' && o.attempts >= MAX_ATTEMPTS) out.note = 'Pesanan sedang dicek admin. Dana kamu aman dan tidak akan hilang.';
  return out;
}
async function getForUser(user: SessionUser, orderNo: string, force = false): Promise<OrderView | null> {
  const f = await db.one('SELECT id, status FROM orders WHERE order_no = ? AND user_id = ?', [orderNo, user.id]);
  if (!f) return null;
  const o = ['pending', 'paid', 'processing'].includes(f.status) ? await reconcile(f.id, { force: force && f.status === 'pending' }) : await byId(f.id);
  return view(o!);
}
const listForUser = async (userId: number, limit = 50): Promise<OrderListItem[]> => (await db.query(
  'SELECT order_no, product_name, qty, total, status, created_at FROM orders WHERE user_id = ? ORDER BY id DESC LIMIT ?', [userId, limit]))
  .map((r: Row) => ({ orderNo: r.order_no, product: r.product_name, qty: r.qty, total: Number(r.total), status: r.status, createdAt: r.created_at }));

const STATUS_SET = new Set(['pending', 'paid', 'processing', 'success', 'failed', 'canceled', 'expired']);
async function listPage(userId: number, { status = '', q = '', page = 1, limit = 15 }: { status?: string; q?: string; page?: number; limit?: number } = {}) {
  const where = ['user_id = ?']; const args: unknown[] = [userId];
  if (STATUS_SET.has(status)) { where.push('status = ?'); args.push(status); }
  const term = q.trim().slice(0, 60);
  if (term) { const like = `%${sec.escapeLike(term)}%`; where.push('(order_no LIKE ? OR product_name LIKE ?)'); args.push(like, like); }
  const w = where.join(' AND ');
  const per = Math.min(50, Math.max(1, limit | 0));
  const [cnt, grp] = await Promise.all([
    db.one(`SELECT COUNT(*) AS n FROM orders WHERE ${w}`, args),
    db.query('SELECT status, COUNT(*) AS n FROM orders WHERE user_id = ? GROUP BY status', [userId]),
  ]);
  const total = Number(cnt!.n); const pages = Math.max(1, Math.ceil(total / per)); const pg = Math.min(Math.max(1, page | 0), pages);
  const rows = await db.query(`SELECT order_no, product_name, qty, total, status, created_at FROM orders WHERE ${w} ORDER BY id DESC LIMIT ? OFFSET ?`, [...args, per, (pg - 1) * per]);
  const counts: Record<string, number> = { all: 0 };
  for (const r of grp) { counts[r.status] = Number(r.n); counts.all += Number(r.n); }
  const items: OrderListItem[] = rows.map((r: Row) => ({ orderNo: r.order_no, product: r.product_name, qty: r.qty, total: Number(r.total), status: r.status, createdAt: r.created_at }));
  return { items, total, pages, page: pg, counts };
}

async function exportTxt(user: SessionUser, orderNo: string): Promise<{ filename: string; text: string }> {
  const o = await db.one('SELECT order_no, product_name, qty, status, accounts_enc, completed_at FROM orders WHERE order_no = ? AND user_id = ?', [orderNo, user.id]);
  if (!o) throw new AppError(404, 'not_found', 'Pesanan tidak ditemukan.');
  if (o.status !== 'success') throw new AppError(409, 'not_ready', 'Akun baru bisa diunduh setelah pesanan selesai.');
  const accounts = sec.decrypt(o.accounts_enc) as Account[] | null;
  if (!accounts || !accounts.length) throw new AppError(409, 'no_accounts', 'Data akun tidak tersedia. Hubungi admin.');
  const s = await settings.get();
  return { filename: accountsFilename(o.order_no), text: buildAccountsTxt({ siteName: s.site_name, orderNo: o.order_no, product: o.product_name, qty: o.qty, completedAt: o.completed_at, accounts }) };
}

async function sweep() {
  for (const r of await db.query("SELECT id FROM orders WHERE status='pending' AND pay_method='qris' ORDER BY last_check_at, id LIMIT 40"))
    await reconcile(r.id).catch((e) => log.error('sweep pending gagal', { id: r.id, msg: e.message }));
  for (const r of await db.query("SELECT id FROM orders WHERE status IN ('paid','processing') AND (last_check_at IS NULL OR last_check_at < IF(attempts < ?, ?, ?)) ORDER BY id LIMIT 40", [MAX_ATTEMPTS, new Date(Date.now() - 20e3), new Date(Date.now() - SLOW_MS)]))
    await reconcile(r.id).catch((e) => log.error('sweep proses gagal', { id: r.id, msg: e.message }));
}
async function adminRetry(orderNo: string): Promise<Row> {
  const o = await byNo(orderNo);
  if (!o || !['paid', 'processing'].includes(o.status)) throw new AppError(409, 'not_retryable', 'Pesanan tidak bisa dicoba ulang.');
  await db.query('UPDATE orders SET attempts=0, last_check_at=NULL, fail_reason=NULL WHERE id=?', [o.id]);
  return (await reconcile(o.id, { force: true }))!;
}
async function adminRefund(orderNo: string) {
  const o = await byNo(orderNo);
  if (!o || !['paid', 'processing'].includes(o.status)) throw new AppError(409, 'not_refundable', 'Pesanan tidak bisa di-refund.');
  return withLock(`order:${o.id}`, async () => _refund(await byId(o.id), 'Refund manual oleh admin'));
}

export { createOrder, reconcile, cancelOrder, applyWebhookSuccess, getForUser, listForUser, listPage, exportTxt, view, sweep, adminRetry, adminRefund, byNo, MAX_ATTEMPTS };
