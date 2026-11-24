'use strict';
Object.assign(process.env, {
  SESSION_SECRET: 's'.repeat(40), DATA_KEY: 'ab'.repeat(32),
  DB_HOST: 'db.test', DB_USER: 'u', DB_PASSWORD: 'p', DB_NAME: 'n',
  PREMKU_BASE: 'https://p.test/api', PREMKU_API_KEY: 'K', PREMKU_API_SECRET: 'S',
});
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const lib = (n) => path.join(__dirname, '..', 'dist', 'server', n);
const cfgPath = lib('core/config.js');
const fakeConfig = { premku: { base: 'https://p.test/api', apiKey: 'K', apiSecret: 'S' }, sessionSecret: 's'.repeat(40), dataKey: 'ab'.repeat(32) };
if (!require.cache[cfgPath]) { try { require(cfgPath); } catch { require.cache[cfgPath] = { id: cfgPath, filename: cfgPath, loaded: true, exports: { config: fakeConfig } }; } }

test('TOTP: vektor RFC 6238 (SHA1) dan base32', () => {
  const t = require(lib('auth/totp'));
  const secret = t.base32Encode(Buffer.from('12345678901234567890'));
  assert.equal(secret, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  assert.deepEqual(t.base32Decode(secret), Buffer.from('12345678901234567890'));
  assert.equal(t.hotp(secret, 1, 8), '94287082');
  assert.equal(t.hotp(secret, 37037036, 8), '07081804');
  assert.equal(t.hotp(secret, 0), '755224');
});
test('TOTP: jendela ±1, sekali pakai (anti replay), format', () => {
  const t = require(lib('auth/totp'));
  const s = t.generateSecret(); assert.match(s, /^[A-Z2-7]{32}$/);
  const now = 1_700_000_000_000; const code = t.totp(s, now); const step = t.stepOf(now);
  assert.equal(t.verify(s, code, { nowMs: now }), step);
  assert.equal(t.verify(s, code, { nowMs: now + 30_000 }), step, 'kode langkah sebelumnya masih diterima (toleransi jam)');
  assert.equal(t.verify(s, code, { nowMs: now + 90_000 }), null, 'terlalu lama');
  assert.equal(t.verify(s, code, { nowMs: now, lastStep: step }), null, 'langkah sudah dipakai ditolak');
  assert.equal(t.verify(s, 'abcdef', { nowMs: now }), null); assert.equal(t.verify(s, '12345', { nowMs: now }), null);
  assert.match(t.otpauthUri({ secret: s, account: 'a@b.c', issuer: 'Nivo Premium' }), /^otpauth:\/\/totp\/Nivo%20Premium:a%40b\.c\?secret=.+&issuer=Nivo%20Premium/);
});
test('kode pemulihan: format & normalisasi', () => {
  const t = require(lib('auth/totp')); const c = t.generateRecoveryCodes();
  assert.equal(c.length, 10); assert.equal(new Set(c).size, 10);
  for (const x of c) { assert.match(x, /^[a-z2-9]{5}-[a-z2-9]{5}$/); assert.ok(t.looksLikeRecovery(x)); assert.ok(t.looksLikeRecovery(x.toUpperCase().replace('-', ' '))); assert.ok(!t.looksLikeTotp(x)); }
  assert.ok(t.looksLikeTotp('123 456'));
});
test('tantangan login 2FA: sah, kedaluwarsa, dipalsukan', () => {
  const sec = require(lib('auth/security'));
  const ch = sec.challengeCreate(42, 1000);
  assert.equal(sec.challengeVerify(ch, 1000 + 60_000), 42);
  assert.equal(sec.challengeVerify(ch, 1000 + 6 * 60_000), null);
  const [u, e, n, g] = ch.split('.');
  assert.equal(sec.challengeVerify(`43.${e}.${n}.${g}`, 2000), null);
  assert.equal(sec.challengeVerify(`${u}.${Number(e) + 999999}.${n}.${g}`, 2000), null);
  assert.equal(sec.challengeVerify('x.y', 2000), null); assert.equal(sec.challengeVerify(undefined), null);
});

test('buildAccountsTxt: format, CRLF, password tidak diubah, tanpa injeksi baris', () => {
  const { buildAccountsTxt, accountsFilename } = require(lib('shop/export'));
  const txt = buildAccountsTxt({ siteName: 'Nivo', orderNo: 'PT261027ABCDEF', product: 'Viu\nPremium', qty: 2, completedAt: '2026-10-27T03:00:00Z', accounts: [{ username: 'a@x.id', password: ' p ass\r\nX' }, { username: 'b@x.id', password: 'Zz9' }] });
  assert.ok(txt.endsWith('\r\n')); assert.ok(!/[^\r]\n/.test(txt), 'semua baris CRLF');
  assert.match(txt, /No\. pesanan : PT261027ABCDEF/); assert.match(txt, /Produk      : Viu Premium/); assert.match(txt, /Selesai     : 27 Okt 2026, 10\.00 WIB/);
  assert.match(txt, /Akun 1\r\n  Username : a@x\.id\r\n  Password :  p ass X\r\n/); assert.match(txt, /Akun 2\r\n  Username : b@x\.id\r\n  Password : Zz9\r\n/);
  assert.equal(accountsFilename('PT261027ABCDEF'), 'PT261027ABCDEF.txt');
});

test('HealthTracker: ok → degraded → down (breaker, 1 probe) → pulih; auth', () => {
  const { HealthTracker, DOWN_AFTER, BREAKER_MS } = require(lib('shop/resilience'));
  let now = 1_000_000; const h = new HealthTracker(() => now);
  assert.equal(h.state(), 'ok'); h.transient('timeout'); assert.equal(h.state(), 'degraded'); assert.ok(h.allow());
  for (let i = 1; i < DOWN_AFTER; i++) h.transient('timeout');
  assert.equal(h.state(), 'down'); assert.equal(h.allow(), false); assert.equal(h.snapshot().breakerOpen, true);
  now += BREAKER_MS; assert.equal(h.allow(), true, 'satu panggilan uji'); assert.equal(h.allow(), false, 'hanya satu per jendela');
  h.alive(); assert.equal(h.state(), 'ok'); assert.ok(h.allow());
  h.auth('API key salah'); assert.equal(h.state(), 'auth'); h.alive(); assert.equal(h.state(), 'ok');
  h.limited(2000); assert.equal(h.state(), 'degraded'); assert.ok(h.waitMs() > 0 && h.waitMs() <= 2000);
});
test('backoff & Retry-After', () => {
  const { backoffMs, parseRetryAfter } = require(lib('shop/resilience'));
  const mid = () => 0.5;
  assert.equal(backoffMs(1, 0, mid), 500); assert.equal(backoffMs(2, 0, mid), 1000); assert.equal(backoffMs(9, 0, mid), 4000);
  assert.equal(backoffMs(1, 3000, mid), 3000); assert.equal(backoffMs(1, 99999, mid), 6000);
  assert.equal(parseRetryAfter('3'), 3000); assert.equal(parseRetryAfter('abc'), 0); assert.equal(parseRetryAfter(null), 0);
  assert.equal(parseRetryAfter(new Date(10_000).toUTCString(), 4_000), 6000);
});
test('Gate: batas paralel & Coalescer & TtlCache', async () => {
  const { Gate, Coalescer, TtlCache, GateFull } = require(lib('shop/resilience'));
  const g = new Gate(2, 0); let cur = 0; let peak = 0;
  await Promise.all(Array.from({ length: 8 }, () => g.run(async () => { cur++; peak = Math.max(peak, cur); await new Promise((r) => setTimeout(r, 5)); cur--; })));
  assert.equal(peak, 2);
  const small = new Gate(1, 0, 1); const p1 = small.run(() => new Promise((r) => setTimeout(r, 20))); const p2 = small.run(async () => 1);
  await assert.rejects(() => small.run(async () => 1), GateFull); await Promise.all([p1, p2]);
  const c = new Coalescer(); let n = 0; const f = async () => { n++; await new Promise((r) => setTimeout(r, 5)); return n; };
  const [a, b] = await Promise.all([c.run('k', f), c.run('k', f)]); assert.equal(a, b); assert.equal(n, 1);
  const t = new TtlCache(100); t.set('x', 1, 0); assert.equal(t.get('x', 50), 1); assert.equal(t.get('x', 150), undefined);
});

const loadPremku = () => {
  const p = require(lib('shop/premku')); p.__test.reset(); p.__test.setSleep(async () => {}); return p;
};
const reply = (status, body, headers = {}) => ({ status, headers: { get: (k) => headers[k.toLowerCase()] ?? null }, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
const withFetch = async (script, fn) => {
  const orig = global.fetch; const calls = []; let i = 0;
  global.fetch = async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); const r = script[Math.min(i++, script.length - 1)]; if (r instanceof Error) throw r; return r; };
  try { return await fn(calls); } finally { global.fetch = orig; }
};
test('premku: 429 lalu 503 lalu sukses → order diulang otomatis dengan ref_id SAMA; saldo dicatat', async () => {
  const p = loadPremku();
  await withFetch([reply(429, {}, { 'retry-after': '1' }), reply(503, 'down'), reply(200, { success: true, data: { invoice: 'I', accounts: [{ username: 'u', password: 'p' }], balance_after: 4200 } })], async (calls) => {
    const r = await p.order({ product_id: 8, qty: 1, ref_id: 'PT1' });
    assert.equal(r.data.invoice, 'I'); assert.equal(calls.length, 3);
    assert.ok(calls.every((c) => c.body.ref_id === 'PT1' && c.body.api_key === 'K' && c.url === 'https://p.test/api/order'));
    assert.equal(p.lastBalance().value, 4200); assert.equal(p.health().state, 'ok');
  });
});
test('premku: pay (tanpa ref_id) HANYA diulang pada 429; timeout/5xx tidak diulang (tak pasti)', async () => {
  const p = loadPremku();
  await withFetch([reply(429, {}), reply(200, { success: true, data: { invoice: 'X' } })], async (calls) => { await p.pay(10000); assert.equal(calls.length, 2); });
  p.__test.reset(); p.__test.setSleep(async () => {});
  await withFetch([reply(502, 'bad')], async (calls) => { await assert.rejects(() => p.pay(10000), (e) => e.kind === 'ambiguous' && e.status === 502); assert.equal(calls.length, 1); });
});
test('premku: penolakan bisnis = definitive tanpa retry; 401/403 = definitive + status auth; saldo kurang tercatat', async () => {
  const p = loadPremku();
  await withFetch([reply(400, { success: false, message: 'Stok habis.' })], async (calls) => { await assert.rejects(() => p.order({ product_id: 1, qty: 1, ref_id: 'A' }), (e) => e.kind === 'definitive' && /Stok/.test(e.message)); assert.equal(calls.length, 1); assert.equal(p.health().state, 'ok'); });
  await withFetch([reply(400, { success: false, message: 'Saldo tidak mencukupi.' })], async () => { await assert.rejects(() => p.order({ product_id: 1, qty: 1, ref_id: 'B' }), (e) => e.kind === 'definitive'); assert.ok(p.health().lastInsufficientAt); });
  await withFetch([reply(403, '<html>forbidden</html>')], async (calls) => { await assert.rejects(() => p.profile(), (e) => e.kind === 'definitive'); assert.equal(calls.length, 1); assert.equal(p.health().state, 'auth'); });
  await withFetch([reply(200, { success: true, data: { saldo: 99 } })], async () => { await p.profile(); assert.equal(p.health().state, 'ok'); });
});
test('premku: supplier down → breaker gagal-cepat tanpa memanggil jaringan; stok di-cache; baca identik digabung', async () => {
  const p = loadPremku();
  await withFetch([new Error('ECONNRESET')], async (calls) => {
    for (let i = 0; i < 3; i++) await assert.rejects(() => p.status('INV'), (e) => e.kind === 'ambiguous');
    assert.equal(p.health().state, 'down'); assert.equal(p.available(), false);
    const before = calls.length;
    await assert.rejects(() => p.status('INV'), (e) => e.kind === 'ambiguous' && /gangguan/.test(e.message));
    assert.equal(calls.length, before, 'breaker terbuka: tidak ada panggilan jaringan');
  });
  const q = loadPremku();
  await withFetch([reply(200, { success: true, stock: 7 })], async (calls) => {
    assert.equal((await q.stock(5)).stock, 7); assert.equal((await q.stock(5)).stock, 7); assert.equal(calls.length, 1, 'cache stok');
    q.__test.reset(); q.__test.setSleep(async () => {});
    await Promise.all([q.products(), q.products(), q.products()]); assert.equal(calls.length, 2, 'products digabung jadi satu panggilan');
  });
});

test('extractAccounts: bentuk respons Premku (dokumen resmi + variasi) terbaca, metadata tidak dianggap akun', () => {
  const { extractAccounts } = require(lib('shop/premku'));
  const A = [{ username: 'a@x.id', password: 'p1' }];
  assert.deepEqual(extractAccounts({ success: true, data: { invoice: 'I', status: 'success', accounts: A } }), A, 'order: data.accounts');
  assert.deepEqual(extractAccounts({ success: true, invoice: 'I', status: 'success', accounts: A }), A, 'status: datar tanpa data');
  assert.deepEqual(extractAccounts({ success: true, data: { accounts: JSON.stringify(A) } }), A, 'accounts berupa string JSON');
  assert.deepEqual(extractAccounts({ success: true, data: { accounts_text: 'a@x.id|p1' } }), A, 'teks user|pass');
  assert.deepEqual(extractAccounts({ success: true, data: { detail: { accounts: [{ email: 'a@x.id', password: 'p1' }] } } }), A, 'bersarang di detail');
  assert.deepEqual(extractAccounts({ success: true, data: { account_data: A } }), A, 'nama kunci lain');
  assert.deepEqual(extractAccounts({ success: true, data: [{ email: 'e@am.id', link: 'https://generator.email/x' }] }).map((x) => x.username), ['e@am.id'], 'bentuk AM (email + link)');
  for (const junk of [
    { success: true, data: { invoice: 'I', status: 'processing', note: 'Order diproses', accounts: [] } },
    { success: true, data: { invoice: 'I', status: 'pending', keterangan: 'Menunggu stok', accounts: [] } },
    { success: true, data: { invoice: 'I', status: 'pending', info: 'cek WA', link: 'https://wa.me/1' } },
    { success: true, invoice: 'I', status: 'success', product: 'Viu' },
  ]) assert.deepEqual(extractAccounts(junk), [], 'pesan/status/link biasa BUKAN akun: ' + JSON.stringify(junk));
});
