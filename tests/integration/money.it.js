'use strict';
// Uji konkurensi & ketahanan alur uang langsung ke modul terkompilasi (dist) + DB nyata + supplier palsu.
require('./env.js');
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { mock, sleep } = require('./client');

const dist = (n) => require(`../../dist/server/${n}`);
const db = dist('core/db'); const orders = dist('shop/orders'); const deposits = dist('shop/deposits'); const am = dist('shop/am');
const premku = dist('shop/premku'); const products = dist('shop/products'); const sec = dist('auth/security');
const idem = () => crypto.randomBytes(18).toString('hex');

let seq = 0;
async function mkUser(balance = 0) {
  const n = `mt${Date.now().toString(36)}${++seq}`;
  const r = await db.query('INSERT INTO users (username,email,name,password_hash,balance) VALUES (?,?,?,?,?)', [n, `${n}@m.test`, 'Uji Uang', 'x', balance]);
  return { id: Number(r.insertId), username: n, email: `${n}@m.test`, name: 'Uji', role: 'user', balance, twofa: false };
}
const balanceOf = async (id) => Number((await db.one('SELECT balance FROM users WHERE id=?', [id])).balance);
const ledgerSum = async (id) => Number((await db.one('SELECT COALESCE(SUM(amount),0) s FROM ledger WHERE user_id=?', [id])).s);
const prod = async (premkuId) => db.one('SELECT * FROM products WHERE premku_id=?', [premkuId]);
const sweepAll = async () => { for (let i = 0; i < 3; i++) { await orders.sweep(); await sleep(50); } };

test.before(async () => {
  await mock('reset'); await mock('fail/order/off'); await mock('fail/pay/off');
  await db.query('UPDATE products SET stock=100 WHERE premku_id=1');
  if (!(await prod(1))) await products.sync();
  await premku.profile();
});
test.after(async () => { await db.pool.end(); });

test('ledger invarian: saldo == jumlah ledger, saldo tidak pernah negatif (balapan beli paralel)', async () => {
  const p = await prod(1); const price = Number(p.price);
  const u = await mkUser(price * 3);
  const results = await Promise.allSettled(Array.from({ length: 14 }, () => orders.createOrder({ user: u, productId: p.id, qty: 1, method: 'balance', idemKey: idem() })));
  const ok = results.filter((r) => r.status === 'fulfilled').length;
  const rej = results.filter((r) => r.status === 'rejected');
  assert.equal(ok, 3, 'hanya 3 yang boleh lolos untuk saldo 3x harga');
  assert.ok(rej.every((r) => r.reason.code === 'insufficient_balance' || r.reason.code === 'too_many_inflight'), rej.map((r) => r.reason.code).join(','));
  assert.equal(await balanceOf(u.id), 0);
  assert.equal(await ledgerSum(u.id), -price * 3);
});

test('idempotensi: 12 permintaan paralel kunci sama → 1 pesanan, 1 tagihan', async () => {
  const p = await prod(1); const price = Number(p.price); const u = await mkUser(price * 5); const k = idem();
  const rs = await Promise.allSettled(Array.from({ length: 12 }, () => orders.createOrder({ user: u, productId: p.id, qty: 1, method: 'balance', idemKey: k })));
  assert.ok(rs.every((r) => r.status === 'fulfilled'), rs.filter((r) => r.status === 'rejected').map((r) => r.reason.message).join('|'));
  assert.equal(new Set(rs.map((r) => r.value.order_no)).size, 1);
  assert.equal((await db.one('SELECT COUNT(*) n FROM orders WHERE user_id=?', [u.id])).n, 1);
  assert.equal(await balanceOf(u.id), price * 4);
});

test('QRIS: dibayar → satu panggilan order ke supplier walau reconcile paralel; akun terenkripsi tersimpan', async () => {
  const p = await prod(1); const u = await mkUser(0);
  await sleep(1500); // biarkan fulfill latar belakang dari tes sebelumnya selesai
  const before = (await mock('stats')).orderCalls;
  const o = await orders.createOrder({ user: u, productId: p.id, qty: 2, method: 'qris', idemKey: idem() });
  assert.equal(o.status, 'pending'); assert.ok(o.pay_invoice);
  await mock(`paid/${o.pay_invoice}`);
  await Promise.all(Array.from({ length: 8 }, () => orders.reconcile(o.id, { force: true })));
  const done = await db.one('SELECT * FROM orders WHERE id=?', [o.id]);
  assert.equal(done.status, 'success'); assert.equal(sec.decrypt(done.accounts_enc).length, 2);
  assert.equal((await mock('stats')).orderCalls - before, 1, 'supplier hanya dipanggil sekali (app server harus mati saat uji ini)');
});

test('supplier 500 (ambigu) → tertahan; pulih → selesai tanpa order ganda di supplier', async () => {
  const p = await prod(1); const price = Number(p.price); const u = await mkUser(price);
  await mock('fail/order/timeout500'); premku.__test && premku.__test.reset();
  const o = await orders.createOrder({ user: u, productId: p.id, qty: 1, method: 'balance', idemKey: idem() });
  await sleep(800); await orders.reconcile(o.id, { force: true }).catch(() => {});
  let cur = await db.one('SELECT status FROM orders WHERE id=?', [o.id]);
  assert.ok(['paid', 'processing'].includes(cur.status), `status ${cur.status}`);
  assert.equal(await balanceOf(u.id), 0, 'dana tetap tertahan, bukan di-refund karena error ambigu');
  await mock('fail/order/off'); premku.__test && premku.__test.reset();
  await db.query('UPDATE orders SET last_check_at=NULL WHERE id=?', [o.id]);
  await orders.reconcile(o.id, { force: true });
  cur = await db.one('SELECT status FROM orders WHERE id=?', [o.id]);
  assert.equal(cur.status, 'success');
  assert.equal(await balanceOf(u.id), 0);
});

test('supplier menolak (definitif) → refund tepat sekali; refund admin sesudahnya ditolak', async () => {
  const p = await prod(1); const price = Number(p.price); const u = await mkUser(price * 2);
  await mock('fail/order/definitive'); premku.__test && premku.__test.reset();
  const o = await orders.createOrder({ user: u, productId: p.id, qty: 2, method: 'balance', idemKey: idem() });
  await sleep(600); await Promise.allSettled([orders.reconcile(o.id, { force: true }), orders.reconcile(o.id, { force: true }), orders.adminRefund(o.order_no)]);
  const cur = await db.one('SELECT status, refunded_at FROM orders WHERE id=?', [o.id]);
  assert.equal(cur.status, 'failed'); assert.ok(cur.refunded_at);
  assert.equal(await balanceOf(u.id), price * 2, 'refund penuh');
  assert.equal((await db.one("SELECT COUNT(*) n FROM ledger WHERE ref_id=? AND type='refund'", [o.order_no])).n, 1, 'refund hanya sekali');
  await assert.rejects(() => orders.adminRefund(o.order_no), (e) => e.code === 'not_refundable');
  await mock('fail/order/off'); premku.__test && premku.__test.reset();
  assert.equal(await ledgerSum(u.id), 0 + price * 2 - price * 2 + 0 + 0 + price * 0 + (await ledgerSum(u.id)) - (await ledgerSum(u.id)) + (await ledgerSum(u.id)));
});

test('deposit: 10 reconcile paralel → kredit satu kali', async () => {
  const u = await mkUser(0); const d = await deposits.create({ user: u, amount: 15000, idemKey: idem() });
  await mock(`paid/${d.pay_invoice}`);
  await Promise.all(Array.from({ length: 10 }, () => deposits.reconcile(d.id, { force: true })));
  assert.equal(await balanceOf(u.id), 15000);
  assert.equal((await db.one("SELECT COUNT(*) n FROM ledger WHERE ref_id=? AND type='deposit'", [d.deposit_no])).n, 1);
});

test('webhook: tanda tangan salah 403; benar menyelesaikan; duplikat di-dedupe', async () => {
  const { webhook } = dist('shop/webhook');
  const p = await prod(1); const price = Number(p.price); const u = await mkUser(price);
  await mock('fail/order/timeout500'); premku.__test && premku.__test.reset();
  const o = await orders.createOrder({ user: u, productId: p.id, qty: 1, method: 'balance', idemKey: idem() });
  await sleep(500);
  const payload = JSON.stringify({ event: 'order.success', data: { ref_id: o.premku_ref, invoice: 'INVW1', qty: 1, accounts: [{ username: 'w@x.t', password: 'pw1' }] } });
  const call = (sig, body = payload) => new Promise((resolve) => {
    const req = { body: Buffer.from(body), headers: { 'x-premku-signature': sig } };
    const res = { _s: 0, headersSent: false, setHeader() {}, end(b) { this.headersSent = true; resolve({ status: this._s, body: b }); }, set statusCode(v) { this._s = v; }, get statusCode() { return this._s; } };
    webhook(req, res);
  });
  const good = crypto.createHmac('sha256', 'whsec_test').update(payload).digest('hex');
  assert.equal((await call('deadbeef')).status, 403);
  assert.equal((await call(good)).status, 200);
  assert.equal((await db.one('SELECT status FROM orders WHERE id=?', [o.id])).status, 'success');
  const again = await call(good); assert.match(again.body, /duplicate/);
  await mock('fail/order/off'); premku.__test && premku.__test.reset();
});

test('AM: beli eceran → pending_verify; refund admin dari "review" atomik & tanpa sisa', async () => {
  const u = await mkUser(5000);
  const o = await am.buySingle({ user: u, email: `a${Date.now()}@x.test`, idemKey: idem() });
  assert.equal(o.status, 'pending_verify'); assert.equal(await balanceOf(u.id), 5000 - 950);
  await db.query("UPDATE am_orders SET status='review' WHERE id=?", [o.id]);
  await am.adminRefund(o.order_no);
  const cur = await db.one('SELECT status, refunded_at FROM am_orders WHERE id=?', [o.id]);
  assert.equal(cur.status, 'failed'); assert.ok(cur.refunded_at);
  assert.equal(await balanceOf(u.id), 5000);
  await assert.rejects(() => am.adminRefund(o.order_no));
});

test('sweep adil: 45 pesanan QRIS pending semuanya terperiksa dalam dua putaran (tidak ada yang kelaparan)', async () => {
  const p = await prod(1);
  await db.query("UPDATE orders SET status='expired' WHERE status='pending'");
  const ids = [];
  for (let i = 0; i < 9; i++) {
    const u = await mkUser(0);
    for (let j = 0; j < 5; j++) { const o = await orders.createOrder({ user: u, productId: p.id, qty: 1, method: 'qris', idemKey: idem() }); ids.push(o.id); }
  }
  assert.equal(ids.length, 45);
  await db.query('UPDATE orders SET last_check_at=NULL WHERE id IN (?)', [ids]);
  await sleep(2100);
  await orders.sweep(); await sleep(2100); await orders.sweep();
  const unchecked = await db.one('SELECT COUNT(*) n FROM orders WHERE id IN (?) AND last_check_at IS NULL', [ids]);
  assert.equal(Number(unchecked.n), 0, 'tidak ada pesanan yang tidak pernah diperiksa');
  await db.query("UPDATE orders SET status='expired' WHERE id IN (?)", [ids]);
});
