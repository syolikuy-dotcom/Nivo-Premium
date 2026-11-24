'use strict';
Object.assign(process.env, {
  NODE_ENV: 'production', DB_HOST: '127.0.0.1', DB_USER: 'u', DB_PASSWORD: 'p', DB_NAME: 'n',
  SESSION_SECRET: 's'.repeat(40), DATA_KEY: 'ab'.repeat(32), APP_URL: 'http://shop.test',
  ADMIN_ALLOWED_IPS: '203.0.113.9', LOG_FORMAT: 'json', LOG_COLOR: 'false', TRUST_PROXY: '1',
});
for (const k of ['SERVER_PORT', 'PORT']) delete process.env[k];

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const path = require('path');
const { once: onceEv } = require('events');

const lib = (n) => require(path.join(__dirname, '..', 'dist', 'server', n));
const edge = lib('http/edge'); const { route } = lib('http/api'); const { limiter } = lib('http/ratelimit');
const sec = lib('auth/security'); const { AppError } = lib('core/errors'); const { ok } = lib('http/http');

const origLog = console.log; console.log = () => {};
test.after(() => { console.log = origLog; });

const serve = async (listener) => {
  const s = http.createServer(listener); s.listen(0, '127.0.0.1'); await onceEv(s, 'listening');
  const close = s.close.bind(s); s.close = () => { s.closeAllConnections(); return close(); };
  return { s, port: s.address().port };
};
const call = (port, { method = 'GET', url = '/', headers = {}, body } = {}) => new Promise((resolve, reject) => {
  const r = http.request({ host: '127.0.0.1', port, method, path: url, headers: { connection: 'close', ...headers } }, (res) => {
    const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => { const text = Buffer.concat(c).toString(); let json = null; try { json = JSON.parse(text); } catch {  } resolve({ status: res.statusCode, headers: res.headers, text, json }); });
  });
  r.on('error', reject); if (body !== undefined) r.write(body); r.end();
});

test('canonPath: decode, rapikan, tolak encoding rusak', () => {
  const { canonPath } = edge;
  assert.equal(canonPath('/admin'), '/admin');
  assert.equal(canonPath('/%61dmin'), '/admin');
  assert.equal(canonPath('//admin/'), '/admin/');
  assert.equal(canonPath('/x/../admin?a=1'), '/admin');
  assert.equal(canonPath('/%E0%A4%A'), null);
});

test('edge: header keamanan, CSP bernonce, gerbang admin, metode, header halaman', async () => {
  let seen = null;
  const { s, port } = await serve(edge.createListener((req, res) => { seen = { nonce: req.headers['x-nonce'], ip: req.ip, url: req.url }; res.end('next'); }));
  try {
    let r = await call(port, { url: '/' });
    assert.equal(r.status, 200);
    const nonce = seen.nonce; assert.ok(nonce && nonce.length >= 20);
    assert.match(r.headers['content-security-policy'], new RegExp(`script-src 'self' 'nonce-${nonce.replace(/[+/=]/g, '\\$&')}'`));
    assert.match(r.headers['content-security-policy'], /frame-ancestors 'none'/);
    assert.match(r.headers['content-security-policy'], /object-src 'none'/);
    assert.ok(!/unsafe-eval/.test(r.headers['content-security-policy']), 'produksi tanpa unsafe-eval');
    assert.ok(!/upgrade-insecure/.test(r.headers['content-security-policy']), 'http biasa: tanpa upgrade-insecure-requests');
    assert.equal(r.headers['x-frame-options'], 'DENY'); assert.equal(r.headers['x-content-type-options'], 'nosniff');
    assert.equal(r.headers['cross-origin-opener-policy'], 'same-origin'); assert.equal(r.headers['referrer-policy'], 'strict-origin-when-cross-origin');
    assert.equal(r.headers['strict-transport-security'], undefined);
    assert.equal(r.headers['x-powered-by'], undefined);
    assert.equal(r.headers['cache-control'], 'private, no-store');

    r = await call(port, { url: '/', headers: { 'x-forwarded-proto': 'https' } });
    assert.match(r.headers['strict-transport-security'], /max-age=31536000/); assert.match(r.headers['content-security-policy'], /upgrade-insecure-requests/);

    const a = seen.nonce; await call(port, { url: '/', headers: { 'x-nonce': 'palsu' } }); assert.notEqual(seen.nonce, 'palsu'); assert.notEqual(seen.nonce, a);

    r = await call(port, { url: '/dashboard' }); assert.equal(r.headers['x-robots-tag'], 'noindex, nofollow');
    r = await call(port, { url: '/products' }); assert.equal(r.headers['x-robots-tag'], undefined);
    for (const u of ['/icon.webp', '/_next/static/chunks/a.js', '/media/abcdef', '/sitemap.xml', '/robots.txt', '/api/recent']) { r = await call(port, { url: u }); assert.equal(r.headers['cache-control'], undefined, u); }

    r = await call(port, { url: '/_next/image?url=/x&w=64&q=75' }); assert.equal(r.status, 404); assert.equal(r.text, 'Not Found');
    r = await call(port, { method: 'POST', url: '/login' }); assert.equal(r.status, 405); assert.equal(r.headers.allow, 'GET, HEAD');
    r = await call(port, { method: 'POST', url: '/media/abc' }); assert.equal(r.status, 405);
    seen = null; r = await call(port, { method: 'POST', url: '/api/auth/login', body: '{}' }); assert.equal(r.status, 200); assert.ok(seen, 'POST /api diteruskan ke Next');
    r = await call(port, { url: '/%E0%A4%A' }); assert.equal(r.status, 400);

    for (const u of ['/admin', '/admin/products', '/%61dmin', '//admin', '/x/../admin', '/ADMIN', '/%41dmin/users']) { seen = null; r = await call(port, { url: u }); assert.equal(r.status, 404, u); assert.equal(seen, null, `${u} tidak boleh sampai ke Next`); }
    seen = null; r = await call(port, { method: 'POST', url: '/api/admin/sync' }); assert.equal(r.status, 404); assert.equal(r.json.error.code, 'not_found'); assert.equal(seen, null);
    seen = null; r = await call(port, { url: '/admin', headers: { 'x-forwarded-for': '203.0.113.9' } }); assert.equal(r.status, 200); assert.ok(seen);
    seen = null; r = await call(port, { url: '/admin', headers: { 'x-forwarded-for': '198.51.100.7' } }); assert.equal(r.status, 404);
    seen = null; r = await call(port, { url: '/administrator' }); assert.equal(r.status, 200, '/administrator bukan /admin');
  } finally { s.close(); }
});

test('edge: error dari handler Next jadi 500 generik tanpa bocor', async () => {
  const { s, port } = await serve(edge.createListener(() => { throw new Error('rahasia internal'); }));
  try { const r = await call(port, { url: '/' }); assert.equal(r.status, 500); assert.ok(!/rahasia/.test(r.text)); } finally { s.close(); }
});

const csrfPair = () => { const t = sec.csrfCreate(); return { cookie: `nivo_csrf=${t}`, header: t }; };
const mkApi = async (routes) => serve((req, res) => { const p = req.url.split('?')[0]; const h = routes[p]; req.query = Object.fromEntries(new URL(req.url, 'http://x').searchParams); if (!h) { res.statusCode = 404; return res.end(); } return h(req, res); });

test('api: metode, CSRF, cookie CSRF baru, JSON ketat, batas ukuran', async () => {
  let got;
  const { s, port } = await mkApi({
    '/echo': route({ method: 'POST' }, (req, res) => { got = req.body; ok(res, { body: req.body }, 201); }),
    '/get': route({ method: 'GET' }, (req, res) => ok(res, { hi: 1 })),
  });
  try {
    let r = await call(port, { method: 'GET', url: '/echo' });
    assert.equal(r.status, 405); assert.equal(r.headers.allow, 'POST'); assert.equal(r.json.ok, false); assert.equal(r.json.error.code, 'method_not_allowed');

    r = await call(port, { url: '/get' });
    assert.equal(r.status, 200); assert.deepEqual(r.json, { ok: true, data: { hi: 1 } }); assert.equal(r.headers['cache-control'], 'no-store');
    const sc = [].concat(r.headers['set-cookie']).join('|');
    assert.match(sc, /nivo_csrf=/); assert.match(sc, /HttpOnly/); assert.match(sc, /SameSite=Lax/); assert.ok(!/Secure/.test(sc));
    r = await call(port, { url: '/get', headers: { 'x-forwarded-proto': 'https' } });
    assert.match([].concat(r.headers['set-cookie']).join('|'), /__Host-nivo_csrf=.*Secure/);

    r = await call(port, { method: 'POST', url: '/echo', headers: { 'content-type': 'application/json' }, body: '{"a":1}' });
    assert.equal(r.status, 403); assert.equal(r.json.error.code, 'csrf');
    const c = csrfPair();
    r = await call(port, { method: 'POST', url: '/echo', headers: { 'content-type': 'application/json', cookie: c.cookie, 'x-csrf-token': c.header, origin: 'http://evil.test' }, body: '{}' });
    assert.equal(r.status, 403);
    r = await call(port, { method: 'POST', url: '/echo', headers: { 'content-type': 'application/json', cookie: c.cookie, 'x-csrf-token': c.header, 'sec-fetch-site': 'cross-site' }, body: '{}' });
    assert.equal(r.status, 403);

    const H = { 'content-type': 'application/json', cookie: c.cookie, 'x-csrf-token': c.header, origin: 'http://127.0.0.1' };
    const hostOk = { ...H, origin: `http://127.0.0.1:${port}` };
    r = await call(port, { method: 'POST', url: '/echo', headers: hostOk, body: '{"a":1,"b":[2]}' });
    assert.equal(r.status, 201); assert.deepEqual(got, { a: 1, b: [2] });
    r = await call(port, { method: 'POST', url: '/echo', headers: hostOk, body: '{rusak' }); assert.equal(r.status, 400); assert.equal(r.json.error.code, 'bad_json');
    r = await call(port, { method: 'POST', url: '/echo', headers: hostOk, body: '"teks"' }); assert.equal(r.status, 400);
    r = await call(port, { method: 'POST', url: '/echo', headers: hostOk, body: 'null' }); assert.equal(r.status, 400);
    r = await call(port, { method: 'POST', url: '/echo', headers: hostOk, body: JSON.stringify({ x: 'a'.repeat(25 * 1024) }) }); assert.equal(r.status, 413); assert.equal(r.json.error.code, 'too_large');
    r = await call(port, { method: 'POST', url: '/echo', headers: { ...hostOk, 'content-type': 'text/plain' }, body: '{"a":1}' }); assert.equal(r.status, 201); assert.deepEqual(got, {}, 'bukan JSON → body kosong, zod yang menolak');
    r = await call(port, { method: 'POST', url: '/echo', headers: hostOk }); assert.equal(r.status, 201); assert.deepEqual(got, {});
  } finally { s.close(); }
});

test('api: guard login, error terstruktur, tidak membocorkan error internal', async () => {
  const { s, port } = await mkApi({
    '/private': route({ method: 'GET', auth: 'user' }, (req, res) => ok(res)),
    '/admin': route({ method: 'GET', auth: 'admin' }, (req, res) => ok(res)),
    '/conflict': route({ method: 'GET' }, () => { throw new AppError(409, 'taken', 'Sudah dipakai.'); }),
    '/boom': route({ method: 'GET' }, () => { throw new Error('SELECT * FROM users password=hunter2'); }),
  });
  try {
    let r = await call(port, { url: '/private' }); assert.equal(r.status, 401); assert.equal(r.json.error.code, 'unauthorized');
    r = await call(port, { url: '/admin', headers: { 'x-forwarded-for': '203.0.113.9' } }); assert.equal(r.status, 401);
    r = await call(port, { url: '/admin' }); assert.equal(r.status, 404, 'IP tidak diizinkan → pura-pura tidak ada');
    r = await call(port, { url: '/conflict' }); assert.deepEqual(r.json, { ok: false, error: { code: 'taken', message: 'Sudah dipakai.' } }); assert.equal(r.status, 409);
    const err = console.error; console.error = () => {};
    try { r = await call(port, { url: '/boom' }); } finally { console.error = err; }
    assert.equal(r.status, 500); assert.equal(r.json.error.code, 'server_error'); assert.ok(!/hunter2|SELECT/.test(r.text));
  } finally { s.close(); }
});

test('api: error zod → 400 invalid_input (butuh zod asli)', async (t) => {
  const { z } = require('zod'); if (typeof z.object !== 'function') return t.skip('zod asli tidak tersedia');
  const schema = z.object({ a: z.string() }).strict();
  const { s, port } = await mkApi({ '/z': route({ method: 'GET' }, () => { schema.parse({}); }) });
  try { const r = await call(port, { url: '/z' }); assert.equal(r.status, 400); assert.equal(r.json.error.code, 'invalid_input'); } finally { s.close(); }
});

test('api: body mentah (webhook/upload) – tanpa sesi, batas ukuran, filter tipe', async () => {
  let got;
  const { s, port } = await mkApi({
    '/hook': route({ method: 'POST', session: false, body: 'raw', maxBytes: 1024 }, (req, res) => { got = req.body; ok(res, { n: req.body.length }); }),
    '/up': route({ method: 'POST', session: false, body: 'raw', types: ['image/png'], maxBytes: 1024 }, (req, res) => { got = req.body; ok(res, { buf: Buffer.isBuffer(req.body) }); }),
  });
  try {
    let r = await call(port, { method: 'POST', url: '/hook', headers: { 'content-type': 'application/json' }, body: '{"event":"x"}' });
    assert.equal(r.status, 200); assert.ok(Buffer.isBuffer(got)); assert.equal(got.toString(), '{"event":"x"}');
    r = await call(port, { method: 'POST', url: '/hook', body: 'x'.repeat(2000) }); assert.equal(r.status, 413);
    r = await call(port, { method: 'POST', url: '/up', headers: { 'content-type': 'image/png' }, body: Buffer.from([0x89, 0x50]) }); assert.equal(r.json.data.buf, true);
    r = await call(port, { method: 'POST', url: '/up', headers: { 'content-type': 'image/svg+xml' }, body: '<svg/>' }); assert.equal(r.json.data.buf, false); assert.deepEqual(got, {});
  } finally { s.close(); }
});

test('rate limit: 429 JSON + Retry-After; skipOk hanya menghitung yang gagal; kunci per pengguna', async () => {
  const strict = limiter('t.strict', 60e3, 3, 'Pelan-pelan.');
  const login = limiter('t.login', 60e3, 2, 'Terlalu banyak gagal.', { skipOk: true });
  const { s, port } = await mkApi({
    '/strict': route({ method: 'GET', limits: [strict] }, (req, res) => ok(res)),
    '/login': route({ method: 'GET', limits: [login] }, (req, res) => { if (req.query.fail) throw new AppError(401, 'bad', 'salah'); ok(res); }),
  });
  try {
    for (let i = 0; i < 3; i++) assert.equal((await call(port, { url: '/strict' })).status, 200);
    let r = await call(port, { url: '/strict' });
    assert.equal(r.status, 429); assert.deepEqual(r.json, { ok: false, error: { code: 'rate_limited', message: 'Pelan-pelan.' } });
    assert.ok(Number(r.headers['retry-after']) >= 1); assert.match(r.headers.ratelimit, /limit=3, remaining=0/); assert.match(r.headers['ratelimit-policy'], /^3;w=60$/);
    assert.equal((await call(port, { url: '/strict', headers: { 'x-forwarded-for': '198.51.100.20' } })).status, 200);

    for (let i = 0; i < 10; i++) assert.equal((await call(port, { url: '/login' })).status, 200, 'sukses tidak dihitung');
    assert.equal((await call(port, { url: '/login?fail=1' })).status, 401);
    assert.equal((await call(port, { url: '/login?fail=1' })).status, 401);
    assert.equal((await call(port, { url: '/login?fail=1' })).status, 429, 'gagal ke-3 dalam jendela diblokir');
    assert.equal((await call(port, { url: '/login' })).status, 429, 'IP yang sama tetap diblokir');
  } finally { s.close(); }
});

test('rate limit: jendela habis → hitungan mulai lagi', async () => {
  const l = limiter('t.window', 60, 1, 'x');
  const mk = () => ({ ip: '9.9.9.9', setHeader() {}, once() {} });
  await l(mk(), mk());
  await assert.rejects(() => l(mk(), mk()), (e) => e.status === 429);
  await new Promise((r) => setTimeout(r, 90));
  await l(mk(), mk());
});

test('singleton: mutex uang tetap satu walau core/locks terduplikasi (seperti hasil bundling Next)', async () => {
  const p = require.resolve('../dist/server/core/locks.js');
  const a = require(p); delete require.cache[p]; const b = require(p);
  assert.notEqual(a.withLock, b.withLock, 'dua instance modul (simulasi bundel ganda)');
  const order = [];
  const task = (lockFn, name, ms) => lockFn('user:1', async () => { order.push(`${name}-start`); await new Promise((r) => setTimeout(r, ms)); order.push(`${name}-end`); });
  await Promise.all([task(a.withLock, 'A', 40), task(b.withLock, 'B', 10), task(a.withLock, 'C', 5)]);
  assert.deepEqual(order, ['A-start', 'A-end', 'B-start', 'B-end', 'C-start', 'C-end'], 'tidak boleh tumpang tindih lintas instance');
  const l = lib('core/singleton'); assert.equal(l.once('x.y', () => ({})), l.once('x.y', () => ({})));
});
