'use strict';
require('./env.js');
const test = require('node:test');
const assert = require('node:assert/strict');
const { Client, idem, until, mock, sleep } = require('./client');

const rnd = Math.random().toString(36).slice(2, 8);
const uname = `u${rnd}`; const email = `${uname}@mail.test`; const PW = 'Kuat12345Zz';
let user; let admin;

test('halaman publik: 200, CSP bernonce, header keamanan, tanpa X-Powered-By', async () => {
  const c = new Client('10.1.1.1');
  for (const p of ['/', '/products', '/login', '/register', '/forgot-password']) {
    const r = await c.get(p);
    assert.equal(r.status, 200, p);
    const csp = r.headers.get('content-security-policy');
    const nonce = /nonce-([A-Za-z0-9+/=]+)/.exec(csp)[1];
    assert.ok(r.text.includes(`nonce="${nonce}"`), `${p}: skrip memakai nonce`);
    assert.ok(!/unsafe-eval|unsafe-inline'?[^;]*script/.test(csp.split(';').find((d) => d.trim().startsWith('script-src'))), 'script-src ketat');
    assert.equal(r.headers.get('x-frame-options'), 'DENY');
    assert.equal(r.headers.get('x-powered-by'), null);
    assert.match(r.headers.get('cache-control') || '', /no-store/);
  }
});

test('path sensitif & metode aneh ditolak', async () => {
  const c = new Client('10.1.1.2');
  for (const p of ['/.env', '/.git/config', '/src/server/core/config.ts', '/dist/server/core/config.js', '/node_modules/next/package.json', '/scripts/create-admin.js', '/tests/layer.test.js', '/%2e%2e/.env', '/package.json%00']) {
    const r = await c.get(p);
    assert.ok([404, 400].includes(r.status), `${p} -> ${r.status}`);
  }
  assert.equal((await c.req('POST', '/products', { json: {}, csrf: false })).status, 405);
  assert.equal((await c.get('/admin')).status, 404, 'admin tersembunyi bagi tamu');
  const dash = await c.get('/dashboard'); assert.equal(dash.status, 307); assert.match(dash.headers.get('location'), /^\/login\?next=/);
  assert.equal((await c.get('/robots.txt')).status, 200);
  const sm = await c.get('/sitemap.xml'); assert.equal(sm.status, 200); assert.match(sm.text, /<urlset/);
  assert.equal((await c.get('/api/nope')).status, 404);
});

test('CSRF: POST tanpa token ditolak; Origin asing ditolak', async () => {
  const c = await new Client('10.1.1.3').boot();
  const a = await c.post('/api/auth/login', { identifier: 'x', password: 'y' }, { csrf: false });
  assert.equal(a.status, 403); assert.equal(a.err.code, 'csrf');
  const b = await c.req('POST', '/api/auth/login', { json: { identifier: 'xyz', password: 'y' }, headers: { origin: 'https://evil.example' } });
  assert.equal(b.status, 403);
});

test('register: validasi, sukses, duplikat', async () => {
  const c = await new Client('10.1.2.1').boot(); user = c;
  const bad = await c.post('/api/auth/register', { name: 'Budi', username: uname, email, password: 'password1A', confirm: 'password1A' });
  assert.equal(bad.status, 400, 'password umum ditolak');
  const mism = await c.post('/api/auth/register', { name: 'Budi', username: uname, email, password: PW, confirm: 'beda' });
  assert.equal(mism.status, 400);
  const extra = await c.post('/api/auth/register', { name: 'Budi', username: uname, email, password: PW, confirm: PW, role: 'admin' });
  assert.equal(extra.status, 400, 'field asing (mass-assignment) ditolak');
  const ok = await c.post('/api/auth/register', { name: 'Budi Santoso', username: uname, email, password: PW, confirm: PW });
  assert.equal(ok.status, 201, JSON.stringify(ok.json));
  assert.ok(c.jar.get('nivo_sid'), 'cookie sesi diset');
  const dash = await c.get('/dashboard'); assert.equal(dash.status, 200);
  const dup = await new Client('10.1.2.2').boot().then((x) => x.post('/api/auth/register', { name: 'Budi', username: uname, email: `o${email}`, password: PW, confirm: PW }));
  assert.equal(dup.status, 409);
});

test('akun biasa tidak bisa menyentuh area admin', async () => {
  for (const p of ['/api/admin/health', '/api/admin/sync']) {
    const r = await (p.endsWith('health') ? user.get(p) : user.post(p));
    assert.equal(r.status, 403, p);
  }
  assert.equal((await user.get('/admin')).status, 404);
});

test('logout menghapus sesi & sesi lama tidak berlaku', async () => {
  const c = await new Client('10.1.2.3').boot();
  const e = `x${rnd}@mail.test`;
  await c.post('/api/auth/register', { name: 'Sesi Uji', username: `s${rnd}`, email: e, password: PW, confirm: PW });
  const sid = c.jar.get('nivo_sid'); assert.ok(sid);
  assert.equal((await c.post('/api/auth/logout')).status, 200);
  const replay = new Client('10.1.2.3'); replay.jar.set('nivo_sid', sid); replay.jar.set('nivo_csrf', c.csrf);
  assert.equal((await replay.get('/dashboard')).status, 307, 'token sesi lama sudah mati');
});

test('login: salah → 401 generik, kunci akun di percobaan ke-5, benar tetap ditolak saat terkunci', async () => {
  const email2 = `l${rnd}@mail.test`; const un = `l${rnd}`;
  const reg = await new Client('10.1.3.1').boot(); await reg.post('/api/auth/register', { name: 'Lock Uji', username: un, email: email2, password: PW, confirm: PW });
  const c = await new Client('10.1.3.9').boot(); // IP berbeda dari IP yang dikenal
  const nobody = await c.post('/api/auth/login', { identifier: 'tidakada', password: 'Salah12345' });
  assert.equal(nobody.status, 401); assert.equal(nobody.err.message, 'Username/email atau password salah.');
  for (let i = 1; i <= 5; i++) {
    const r = await c.post('/api/auth/login', { identifier: un, password: 'Salah12345' });
    assert.equal(r.status, i < 5 ? 401 : 429, `percobaan ${i}`); // 5 gagal → kunci langsung dilaporkan
  }
  const good = await c.post('/api/auth/login', { identifier: un, password: PW });
  assert.equal(good.status, 429, 'password benar pun ditolak saat terkunci');
});

test('login admin + akses panel + sinkron produk', async () => {
  const c = await new Client('10.1.4.1').boot(); admin = c;
  const r = await c.post('/api/auth/login', { identifier: 'admin', password: 'AdminPass123x' });
  assert.equal(r.status, 200, JSON.stringify(r.json)); assert.equal(r.data.redirect, '/admin');
  assert.equal((await c.get('/admin')).status, 200);
  for (const p of ['/admin/products', '/admin/users', '/admin/orders', '/admin/settings']) assert.equal((await c.get(p)).status, 200, p);
  const s = await c.post('/api/admin/sync'); assert.equal(s.status, 200, JSON.stringify(s.json)); assert.equal(s.data.count, 2);
  const h = await c.get('/api/admin/health'); assert.equal(h.status, 200); assert.equal(h.data.supplier.state, 'ok');
});

test('katalog menampilkan produk hasil sinkron + harga markup', async () => {
  const r = await new Client('10.1.5.1').get('/products');
  assert.equal(r.status, 200); assert.match(r.text, /Alight Motion Premium/);
  const p = await new Client('10.1.5.1').get('/products/alight-motion-premium'); assert.equal(p.status, 200);
  assert.equal((await new Client('10.1.5.1').get('/products/tidak-ada')).status, 404);
});

test('deposit QRIS → dibayar → saldo bertambah tepat sekali', async () => {
  const k = idem();
  const bad = await user.post('/api/deposits', { amount: 500, idemKey: k }); assert.equal(bad.status, 400, 'di bawah minimum');
  const d1 = await user.post('/api/deposits', { amount: 20000, idemKey: k });
  assert.equal(d1.status, 201, JSON.stringify(d1.json));
  const d2 = await user.post('/api/deposits', { amount: 20000, idemKey: k });
  assert.equal(d2.data.depositNo, d1.data.depositNo, 'idempoten: kunci sama → deposit sama');
  const conflict = await user.post('/api/deposits', { amount: 30000, idemKey: k }); assert.equal(conflict.status, 409);
  const no = d1.data.depositNo;
  const v = await user.get(`/api/deposits/${no}`); assert.equal(v.data.status, 'pending'); assert.ok(v.data.qr);
  const inv = JSON.parse((await (await fetch('http://127.0.0.1:4010/api/ctl/stats', { method: 'POST' })).text())); assert.ok(inv);
  // cari invoice di DB lewat mock: ambil invoice terakhir
  const mariadb = require('child_process').execFileSync('mariadb', ['-N', '-e', `SELECT pay_invoice FROM nivo_test.deposits WHERE deposit_no='${no}'`]).toString().trim();
  await mock(`paid/${mariadb}`);
  const [a, b, c] = await Promise.all([1, 2, 3].map(() => user.get(`/api/deposits/${no}?force=1`)));
  for (const x of [a, b, c]) assert.equal(x.data.status, 'paid');
  const bal = require('child_process').execFileSync('mariadb', ['-N', '-e', `SELECT balance FROM nivo_test.users WHERE username='${uname}'`]).toString().trim();
  assert.equal(bal, '20000', 'saldo +20000 tepat sekali walau dicek paralel');
  const led = require('child_process').execFileSync('mariadb', ['-N', '-e', `SELECT COUNT(*) FROM nivo_test.ledger WHERE ref_id='${no}'`]).toString().trim();
  assert.equal(led, '1');
});

test('pesan pakai saldo → terkirim → akun & unduhan .txt; kunci idempoten tidak menagih dua kali', async () => {
  const prod = (await user.get('/api/recent')); void prod;
  const pid = require('child_process').execFileSync('mariadb', ['-N', '-e', "SELECT id FROM nivo_test.products WHERE premku_id=1"]).toString().trim();
  const k = idem();
  const o1 = await user.post('/api/orders', { productId: Number(pid), qty: 2, method: 'balance', idemKey: k });
  assert.equal(o1.status, 201, JSON.stringify(o1.json));
  const o2 = await user.post('/api/orders', { productId: Number(pid), qty: 2, method: 'balance', idemKey: k });
  assert.equal(o2.data.orderNo, o1.data.orderNo, 'kunci sama → pesanan sama');
  const no = o1.data.orderNo;
  const done = await until(async () => { const r = await user.get(`/api/orders/${no}`); return r.data && r.data.status === 'success' ? r.data : null; });
  assert.ok(done, 'pesanan selesai'); assert.equal(done.accounts.length, 2);
  const dl = await user.get(`/api/orders/${no}/download`); assert.equal(dl.status, 200); assert.match(dl.headers.get('content-disposition'), new RegExp(`${no}\\.txt`)); assert.match(dl.text, /Username/);
  const bal = require('child_process').execFileSync('mariadb', ['-N', '-e', `SELECT balance FROM nivo_test.users WHERE username='${uname}'`]).toString().trim();
  const price = Number(done.unitPrice);
  assert.equal(Number(bal), 20000 - price * 2, 'ditagih tepat sekali');
  const stats = await (await fetch('http://127.0.0.1:4010/api/ctl/stats', { method: 'POST' })).json();
  assert.equal(stats.orders >= 1, true);
  // pesanan orang lain tidak bisa dibuka
  const other = await new Client('10.1.6.1').boot(); await other.post('/api/auth/register', { name: 'Orang Lain', username: `o${rnd}`, email: `o${rnd}@mail.test`, password: PW, confirm: PW });
  assert.equal((await other.get(`/api/orders/${no}`)).status, 404, 'IDOR: milik orang lain = 404');
  assert.equal((await other.get(`/api/orders/${no}/download`)).status, 404);
});

test('saldo tidak cukup → 402 dan tidak ada pesanan nyangkut', async () => {
  const pid = require('child_process').execFileSync('mariadb', ['-N', '-e', "SELECT id FROM nivo_test.products WHERE premku_id=1"]).toString().trim();
  const r = await user.post('/api/orders', { productId: Number(pid), qty: 30, method: 'balance', idemKey: idem() });
  assert.equal(r.status, 402, JSON.stringify(r.json));
  const n = require('child_process').execFileSync('mariadb', ['-N', '-e', `SELECT COUNT(*) FROM nivo_test.orders o JOIN nivo_test.users u ON u.id=o.user_id WHERE u.username='${uname}' AND o.qty=30 AND o.product_id=${pid}`]).toString().trim();
  assert.equal(n, '0', 'transaksi di-rollback penuh');
});

test('rate limit: 429 + Retry-After pada login berulang dari satu IP', async () => {
  const c = await new Client('10.1.9.9').boot(); let last;
  for (let i = 0; i < 18; i++) last = await c.post('/api/auth/login', { identifier: `nouser${i}`, password: 'Salah12345' });
  assert.equal(last.status, 429); assert.ok(last.headers.get('retry-after'));
});

test('health: 200 + format tidak membocorkan detail', async () => {
  const r = await new Client('10.1.8.1').get('/api/health'); assert.equal(r.status, 200); assert.deepEqual(r.json, { ok: true });
});
