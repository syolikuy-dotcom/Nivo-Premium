'use strict';
Object.assign(process.env, {
  NODE_ENV: 'production', DB_HOST: '127.0.0.1', DB_USER: 'u', DB_PASSWORD: 'p', DB_NAME: 'n',
  SESSION_SECRET: 's'.repeat(40), DATA_KEY: 'ab'.repeat(32), APP_URL: 'https://shop.test',
  GOOGLE_CLIENT_ID: 'cid-123.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'gsecret', LOG_FORMAT: 'json', LOG_COLOR: 'false',
});
for (const k of ['SERVER_PORT', 'PORT']) delete process.env[k];

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const path = require('path');
const lib = (n) => require(path.join(__dirname, '..', 'dist', 'server', n));
const shared = (n) => require(path.join(__dirname, '..', 'dist', 'shared', n));
const google = lib('auth/google'); const flow = lib('auth/google-flow'); const db = lib('core/db');
const { AppError } = lib('core/errors'); const { config } = lib('core/config');
const origLog = console.log; console.log = () => {}; test.after(() => { console.log = origLog; });

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const idToken = (c) => `${b64({ alg: 'RS256' })}.${b64(c)}.sig`;
const goodClaims = (over = {}) => ({ iss: 'https://accounts.google.com', aud: config.google.clientId, sub: '1234567890123', exp: Math.floor(Date.now() / 1000) + 600, nonce: 'N0NCE', email: 'Budi.Santoso@gmail.com', email_verified: true, name: 'Budi Santoso', ...over });

test('google: konfigurasi aktif hanya bila ID dan secret terisi; redirect URI tetap', () => {
  assert.equal(config.google.enabled, true);
  assert.equal(google.redirectUri(), 'https://shop.test/api/auth/google/callback');
});

test('google: state tersegel — roundtrip, tamper, kedaluwarsa, sampah', () => {
  const st = google.newState('login', 0, '/orders?page=2');
  const tok = google.sealState(st);
  const back = google.openState(tok);
  assert.equal(back.s, st.s); assert.equal(back.n, st.n); assert.equal(back.v, st.v); assert.equal(back.m, 'login'); assert.equal(back.nx, '/orders?page=2');
  const [body, sig] = tok.split('.');
  const evil = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url')), m: 'link', u: 1 })).toString('base64url');
  assert.equal(google.openState(`${evil}.${sig}`), null, 'isi diubah → tanda tangan gagal');
  assert.equal(google.openState(`${body}.${'0'.repeat(64)}`), null);
  assert.equal(google.openState(tok, Date.now() + google.STATE_TTL_MS + 1000), null, 'kedaluwarsa');
  for (const junk of [undefined, '', 'abc', '.', 'a.b', 123, 'x'.repeat(2000)]) assert.equal(google.openState(junk), null);
  assert.equal(google.newState('link', 42, '').u, 42);
  assert.equal(google.newState('login', 42, '').u, 0, 'mode login tidak membawa user id');
});

test('google: tujuan setelah login hanya path internal aman (anti open-redirect)', () => {
  assert.equal(google.safeNextPath('/dashboard'), '/dashboard');
  assert.equal(google.safeNextPath('/orders?status=success&page=2'), '/orders?status=success&page=2');
  for (const bad of ['//evil.com', '/\\evil.com', 'https://evil.com', 'javascript:alert(1)', '/a b', '/<x>', 'x'.repeat(400), null, undefined, 5]) assert.equal(google.safeNextPath(bad), '', String(bad));
});

test('google: URL otorisasi memuat PKCE S256, nonce, state, scope dan redirect_uri benar', () => {
  const st = google.newState('login', 0, '');
  const u = new URL(google.authUrl(st));
  assert.equal(u.origin + u.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  const q = u.searchParams;
  assert.equal(q.get('client_id'), config.google.clientId); assert.equal(q.get('response_type'), 'code');
  assert.equal(q.get('redirect_uri'), 'https://shop.test/api/auth/google/callback');
  assert.equal(q.get('scope'), 'openid email profile'); assert.equal(q.get('state'), st.s); assert.equal(q.get('nonce'), st.n);
  assert.equal(q.get('code_challenge_method'), 'S256');
  assert.equal(q.get('code_challenge'), crypto.createHash('sha256').update(st.v).digest('base64url'));
  assert.ok(!u.search.includes('gsecret') && !u.search.includes(st.v), 'secret & verifier tidak bocor ke URL');
});

test('google: checkClaims menerima token valid dan menolak aud/iss/nonce/exp/sub/email yang salah', () => {
  const p = google.checkClaims(goodClaims(), 'N0NCE');
  assert.deepEqual(p, { sub: '1234567890123', email: 'budi.santoso@gmail.com', name: 'Budi Santoso' });
  assert.equal(google.checkClaims(goodClaims({ iss: 'accounts.google.com', email_verified: 'true' }), 'N0NCE').sub, '1234567890123');
  const bad = (over, nonce = 'N0NCE') => assert.throws(() => google.checkClaims(goodClaims(over), nonce), AppError, JSON.stringify(over));
  bad({ aud: 'orang-lain' }); bad({ aud: ['x', 'y'] }); bad({ iss: 'https://evil.example' }); bad({ exp: Math.floor(Date.now() / 1000) - 3600 });
  bad({ nonce: 'lain' }); bad({ nonce: undefined }); bad({ sub: 'abc' }); bad({ sub: undefined }); bad({ email: undefined }); bad({ email: 'bukan-email' });
  bad({}, 'salah');
  assert.throws(() => google.checkClaims(goodClaims({ email_verified: false }), 'N0NCE'), (e) => e.code === 'google_unverified');
  assert.throws(() => google.checkClaims(goodClaims({ email_verified: undefined }), 'N0NCE'), (e) => e.code === 'google_unverified');
  assert.equal(google.checkClaims(goodClaims({ aud: ['x', config.google.clientId] }), 'N0NCE').sub, '1234567890123');
  assert.throws(() => google.checkClaims(null, 'N0NCE'), AppError);
});

test('google: nama dibersihkan, username dibuat valid, unik, dan bukan kata terlarang', async () => {
  assert.equal(google.cleanName('  Budi   <b>Santoso</b> \u0007 ', 'x@gmail.com'), 'Budi bSantoso/b');
  assert.equal(google.cleanName('', 'siti.aminah@gmail.com'), 'siti aminah');
  assert.equal(google.cleanName('A', '@@'), 'Pengguna');
  const free = async () => false;
  const valid = /^[A-Za-z0-9_]{3,20}$/;
  assert.equal(await google.pickUsername('budi.santoso@gmail.com', free), 'budi_santoso');
  assert.match(await google.pickUsername('a@gmail.com', free), valid);
  assert.match(await google.pickUsername('very.long.name.that.keeps.going@gmail.com', free), valid);
  assert.match(await google.pickUsername('日本語@gmail.com', free), valid);
  const taken = new Set(['budi_santoso']);
  const u2 = await google.pickUsername('budi.santoso@gmail.com', async (u) => taken.has(u));
  assert.notEqual(u2, 'budi_santoso'); assert.match(u2, valid);
  const admin = await google.pickUsername('admin@gmail.com', free);
  assert.notEqual(admin.toLowerCase(), 'admin'); assert.match(admin, valid);
  assert.match(await google.pickUsername('x@gmail.com', async () => true), valid, 'semua terpakai → tetap valid (acak)');
});

test('google: exchangeCode — sukses, ditolak Google, jaringan gagal, token rusak', async () => {
  let sent;
  const okFetch = async (url, init) => { sent = { url, init }; return { ok: true, json: async () => ({ id_token: idToken(goodClaims()) }) }; };
  const claims = await google.exchangeCode('CODE', 'VERIF', okFetch);
  assert.equal(claims.sub, '1234567890123');
  assert.equal(sent.url, 'https://oauth2.googleapis.com/token');
  const body = new URLSearchParams(sent.init.body);
  assert.equal(body.get('grant_type'), 'authorization_code'); assert.equal(body.get('code'), 'CODE'); assert.equal(body.get('code_verifier'), 'VERIF');
  assert.equal(body.get('client_secret'), 'gsecret'); assert.equal(body.get('redirect_uri'), 'https://shop.test/api/auth/google/callback');
  await assert.rejects(google.exchangeCode('C', 'V', async () => ({ ok: false, json: async () => ({ error: 'invalid_grant' }) })), (e) => e instanceof AppError && e.code === 'google_failed');
  await assert.rejects(google.exchangeCode('C', 'V', async () => { throw new Error('ECONNRESET'); }), (e) => e instanceof AppError && e.code === 'google_failed');
  await assert.rejects(google.exchangeCode('C', 'V', async () => ({ ok: true, json: async () => ({ id_token: 'bukan.jwt' }) })), AppError);
  await assert.rejects(google.exchangeCode('C', 'V', async () => ({ ok: true, json: async () => ({}) })), AppError);
});

test('google: pesan UI & tautan mulai', () => {
  const g = shared('google');
  assert.equal(g.googleUrl(), '/api/auth/google/start');
  assert.equal(g.googleUrl('link'), '/api/auth/google/start?mode=link');
  assert.equal(g.googleUrl('login', '/orders?page=2'), '/api/auth/google/start?next=%2Forders%3Fpage%3D2');
  for (const c of ['exists', 'disabled', 'admin', 'cancelled', 'failed', 'expired', 'unverified', 'off']) assert.ok(g.googleLoginMessage(c).length > 10, c);
  assert.equal(g.googleLoginMessage('<script>'), '');
  assert.equal(g.googleAccountMessage('linked').ok, true); assert.equal(g.googleAccountMessage('taken').ok, false); assert.equal(g.googleAccountMessage('zzz'), null);
});

// ---------- alur lengkap dengan DB tiruan ----------
function fakeDb() {
  const users = []; const sessions = []; const audits = []; let nextId = 100;
  const orig = { one: db.one, query: db.query };
  db.one = async (sql, p = []) => {
    if (/FROM users WHERE google_sub = \?/.test(sql)) return users.find((u) => u.google_sub === p[0]) || null;
    if (/FROM users WHERE email = \?/.test(sql)) return users.find((u) => u.email === p[0]) || null;
    if (/FROM users WHERE username = \?/.test(sql)) return users.find((u) => u.username === p[0]) || null;
    if (/FROM audit_log/.test(sql)) return null;
    throw new Error('one tak terduga: ' + sql);
  };
  db.query = async (sql, p = []) => {
    if (/^INSERT INTO users/.test(sql)) {
      const [username, email, name, hash, sub] = p;
      if (users.some((u) => u.email === email)) { const e = new Error('dup'); e.code = 'ER_DUP_ENTRY'; e.sqlMessage = "Duplicate entry for key 'users.uq_users_email'"; throw e; }
      if (users.some((u) => u.username === username)) { const e = new Error('dup'); e.code = 'ER_DUP_ENTRY'; e.sqlMessage = "Duplicate entry for key 'users.uq_users_username'"; throw e; }
      const u = { id: nextId++, username, email, name, password_hash: hash, google_sub: sub, role: 'user', status: 'active' }; users.push(u); return { insertId: u.id, affectedRows: 1 };
    }
    if (/^INSERT INTO sessions/.test(sql)) { sessions.push(p[0]); return { affectedRows: 1 }; }
    if (/^INSERT INTO audit_log/.test(sql)) { audits.push(p[1]); return { affectedRows: 1 }; }
    if (/^UPDATE users SET google_sub/.test(sql)) { const u = users.find((x) => x.id === p[1] && !x.google_sub); if (!u) return { affectedRows: 0 }; u.google_sub = p[0]; return { affectedRows: 1 }; }
    return { affectedRows: 1 };
  };
  return { users, sessions, audits, restore() { db.one = orig.one; db.query = orig.query; } };
}
const mkReq = (cookieHeader = '', user = null) => ({ ip: '203.0.113.7', headers: { cookie: cookieHeader, 'user-agent': 'test', 'x-forwarded-proto': 'https' }, socket: { encrypted: true }, user });
const mkRes = () => { const h = {}; return { getHeader: (k) => h[k], setHeader: (k, v) => { h[k] = v; }, h }; };
const cookiesOf = (res) => [].concat(res.h['Set-Cookie'] || []);
const stateCookieFor = (res) => { const c = cookiesOf(res).find((x) => x.startsWith('__Host-nivo_gst=')); return c ? c.split(';')[0] : ''; };
const qs = (o) => new URLSearchParams(o);

async function startAndGetState(mode = 'login', user = null, next = '') {
  const res = mkRes();
  const to = flow.begin(mkReq('', user), res, qs({ ...(mode === 'link' ? { mode: 'link' } : {}), ...(next ? { next } : {}) }));
  const cookie = stateCookieFor(res); const st = google.openState(decodeURIComponent(cookie.split('=').slice(1).join('=')));
  return { to, cookie, st, res };
}
const withExchange = async (claimsOf, fn) => { const o = google.exchangeCode; google.exchangeCode = async () => claimsOf(); try { return await fn(); } finally { google.exchangeCode = o; } };

test('flow: begin — cookie state aman & redirect ke Google; sudah login → dashboard; link tanpa sesi → login', async () => {
  const { to, cookie, res } = await startAndGetState();
  assert.ok(to.startsWith('https://accounts.google.com/o/oauth2/v2/auth?'));
  const line = cookiesOf(res).find((x) => x.startsWith('__Host-nivo_gst='));
  assert.match(line, /HttpOnly/); assert.match(line, /Secure/); assert.match(line, /SameSite=Lax/); assert.match(line, /Path=\//); assert.match(line, /Max-Age=600/);
  assert.ok(cookie.length > 20);
  assert.equal(flow.begin(mkReq('', { id: 5 }), mkRes(), qs({})), '/dashboard');
  assert.equal(flow.begin(mkReq(''), mkRes(), qs({ mode: 'link' })), '/login?next=%2Faccount');
});

test('flow: pengguna baru daftar via Google → akun dibuat, sesi dimulai, password acak, state dihapus', async () => {
  const f = fakeDb();
  try {
    const { cookie, st } = await startAndGetState('login', null, '/orders');
    const res = mkRes();
    const to = await withExchange(() => goodClaims({ nonce: st.n }), () => flow.finish(mkReq(cookie), res, qs({ code: 'abc', state: st.s })));
    assert.equal(to, '/orders');
    assert.equal(f.users.length, 1);
    const u = f.users[0];
    assert.equal(u.email, 'budi.santoso@gmail.com'); assert.equal(u.google_sub, '1234567890123'); assert.equal(u.username, 'budi_santoso'); assert.equal(u.name, 'Budi Santoso');
    assert.ok(u.password_hash && u.password_hash.length > 20, 'ada hash password acak (tidak kosong)');
    assert.equal(f.sessions.length, 1);
    assert.ok(f.audits.includes('register_google'));
    const cs = cookiesOf(res);
    assert.ok(cs.some((x) => x.startsWith('__Host-nivo_sid=')), 'cookie sesi dipasang');
    assert.ok(cs.some((x) => x.startsWith('__Host-nivo_gst=;') && /Max-Age=0/.test(x)), 'cookie state dihapus');
  } finally { f.restore(); }
});

test('flow: pengguna Google yang sudah terhubung → masuk (login), bukan daftar ulang', async () => {
  const f = fakeDb();
  try {
    f.users.push({ id: 7, username: 'budi', email: 'budi.santoso@gmail.com', name: 'Budi', google_sub: '1234567890123', role: 'user', status: 'active' });
    const { cookie, st } = await startAndGetState();
    const to = await withExchange(() => goodClaims({ nonce: st.n }), () => flow.finish(mkReq(cookie), mkRes(), qs({ code: 'abc', state: st.s })));
    assert.equal(to, '/dashboard'); assert.equal(f.users.length, 1); assert.equal(f.sessions.length, 1);
    assert.ok(f.audits.includes('login_google') && f.audits.includes('login'));
  } finally { f.restore(); }
});

test('flow: email sudah dipakai akun password → TIDAK otomatis ditautkan (cegah pra-pembajakan akun)', async () => {
  const f = fakeDb();
  try {
    f.users.push({ id: 9, username: 'korban', email: 'budi.santoso@gmail.com', name: 'X', google_sub: null, role: 'user', status: 'active' });
    const { cookie, st } = await startAndGetState();
    const res = mkRes();
    const to = await withExchange(() => goodClaims({ nonce: st.n }), () => flow.finish(mkReq(cookie), res, qs({ code: 'abc', state: st.s })));
    assert.equal(to, '/login?ge=exists');
    assert.equal(f.users[0].google_sub, null, 'google_sub tidak ditulis ke akun lama');
    assert.equal(f.sessions.length, 0, 'tidak ada sesi dibuat');
    assert.ok(!cookiesOf(res).some((x) => x.startsWith('__Host-nivo_sid=')));
  } finally { f.restore(); }
});

test('flow: admin & akun nonaktif tidak bisa masuk lewat Google', async () => {
  for (const [row, expect] of [[{ role: 'admin', status: 'active' }, '/login?ge=admin'], [{ role: 'user', status: 'disabled' }, '/login?ge=disabled']]) {
    const f = fakeDb();
    try {
      f.users.push({ id: 3, username: 'x', email: 'budi.santoso@gmail.com', name: 'X', google_sub: '1234567890123', ...row });
      const { cookie, st } = await startAndGetState();
      const to = await withExchange(() => goodClaims({ nonce: st.n }), () => flow.finish(mkReq(cookie), mkRes(), qs({ code: 'abc', state: st.s })));
      assert.equal(to, expect); assert.equal(f.sessions.length, 0);
    } finally { f.restore(); }
  }
});

test('flow: username bentrok saat daftar → otomatis dapat username lain', async () => {
  const f = fakeDb();
  try {
    f.users.push({ id: 1, username: 'budi_santoso', email: 'lain@gmail.com', name: 'L', google_sub: null, role: 'user', status: 'active' });
    const { cookie, st } = await startAndGetState();
    const to = await withExchange(() => goodClaims({ nonce: st.n }), () => flow.finish(mkReq(cookie), mkRes(), qs({ code: 'abc', state: st.s })));
    assert.equal(to, '/dashboard');
    const mine = f.users.find((u) => u.google_sub === '1234567890123');
    assert.ok(mine && mine.username !== 'budi_santoso' && /^[A-Za-z0-9_]{3,20}$/.test(mine.username));
  } finally { f.restore(); }
});

test('flow: state/CSRF — tanpa cookie, state salah, error dari Google, kode kosong, token palsu semuanya ditolak tanpa login', async () => {
  const f = fakeDb();
  try {
    const { cookie, st } = await startAndGetState();
    const run = (req, q, claims = () => goodClaims({ nonce: st.n })) => withExchange(claims, () => flow.finish(req, mkRes(), qs(q)));
    assert.equal(await run(mkReq(''), { code: 'a', state: st.s }), '/login?ge=expired', 'tanpa cookie state');
    assert.equal(await run(mkReq('__Host-nivo_gst=sampah'), { code: 'a', state: st.s }), '/login?ge=expired');
    assert.equal(await run(mkReq(cookie), { code: 'a', state: 'state-penyerang' }), '/login?ge=failed', 'state tidak cocok (CSRF login)');
    assert.equal(await run(mkReq(cookie), { state: st.s }), '/login?ge=failed', 'tanpa code');
    assert.equal(await run(mkReq(cookie), { error: 'access_denied', state: st.s }), '/login?ge=cancelled');
    assert.equal(await run(mkReq(cookie), { code: 'a', state: st.s }, () => goodClaims({ nonce: 'nonce-lain' })), '/login?ge=failed', 'nonce tidak cocok (replay)');
    assert.equal(await run(mkReq(cookie), { code: 'a', state: st.s }, () => goodClaims({ nonce: st.n, email_verified: false })), '/login?ge=unverified');
    assert.equal(await run(mkReq(cookie), { code: 'a', state: st.s }, () => { throw new Error('boom'); }), '/login?ge=failed');
    assert.equal(f.users.length, 0); assert.equal(f.sessions.length, 0);
  } finally { f.restore(); }
});

test('flow: menghubungkan Google dari halaman Akun — sukses, sudah dipakai akun lain, sesi harus milik pemilik state', async () => {
  const f = fakeDb();
  try {
    f.users.push({ id: 11, username: 'ani', email: 'ani@mail.com', name: 'Ani', google_sub: null, role: 'user', status: 'active' });
    f.users.push({ id: 12, username: 'budi', email: 'b@mail.com', name: 'Budi', google_sub: '999999999', role: 'user', status: 'active' });
    const me = { id: 11 };
    let s = await startAndGetState('link', me);
    assert.equal(s.st.m, 'link'); assert.equal(s.st.u, 11);
    let to = await withExchange(() => goodClaims({ nonce: s.st.n, email: 'beda@gmail.com' }), () => flow.finish(mkReq(s.cookie, me), mkRes(), qs({ code: 'a', state: s.st.s })));
    assert.equal(to, '/account?google=linked'); assert.equal(f.users[0].google_sub, '1234567890123'); assert.ok(f.audits.includes('google_link'));
    s = await startAndGetState('link', { id: 12 });
    to = await withExchange(() => goodClaims({ nonce: s.st.n, sub: '1234567890123' }), () => flow.finish(mkReq(s.cookie, { id: 12 }), mkRes(), qs({ code: 'a', state: s.st.s })));
    assert.equal(to, '/account?google=taken', 'akun Google itu milik user lain');
    s = await startAndGetState('link', me);
    to = await withExchange(() => goodClaims({ nonce: s.st.n }), () => flow.finish(mkReq(s.cookie, { id: 99 }), mkRes(), qs({ code: 'a', state: s.st.s })));
    assert.equal(to, '/login?next=%2Faccount', 'sesi berbeda dari pemilik state ditolak');
    to = await withExchange(() => goodClaims({ nonce: s.st.n }), () => flow.finish(mkReq(s.cookie, null), mkRes(), qs({ code: 'a', state: s.st.s })));
    assert.equal(to, '/login?next=%2Faccount', 'tanpa sesi ditolak');
    s = await startAndGetState('link', me);
    to = await flow.finish(mkReq(s.cookie, me), mkRes(), qs({ error: 'access_denied', state: s.st.s }));
    assert.equal(to, '/account?google=cancelled');
  } finally { f.restore(); }
});

test('flow: pengguna yang sudah login tidak diproses ulang sebagai login Google', async () => {
  const f = fakeDb();
  try {
    const { cookie, st } = await startAndGetState();
    const to = await withExchange(() => goodClaims({ nonce: st.n }), () => flow.finish(mkReq(cookie, { id: 5 }), mkRes(), qs({ code: 'a', state: st.s })));
    assert.equal(to, '/dashboard'); assert.equal(f.users.length, 0);
  } finally { f.restore(); }
});
