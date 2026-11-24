'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { redact, MASK } = require('../dist/server/core/redact');

test('redact: kunci sensitif disamarkan, kunci biasa tetap, termasuk di objek/array bersarang', () => {
  const r = redact({ akun: 'budi', password: 'p', apiKey: 'k', PREMKU_API_SECRET: 's', nested: { token: 't', ok: 1, list: [{ cookie: 'c', n: 2 }] }, SESSION_SECRET: 'x', DATA_KEY: 'd' });
  assert.deepEqual(r, { akun: 'budi', password: MASK, apiKey: MASK, PREMKU_API_SECRET: MASK, nested: { token: MASK, ok: 1, list: [{ cookie: MASK, n: 2 }] }, SESSION_SECRET: MASK, DATA_KEY: MASK });
});
test('redact: aman untuk referensi melingkar & nilai primitif', () => {
  const a = { x: 1 }; a.self = a;
  assert.doesNotThrow(() => redact(a));
  assert.equal(redact('abc'), 'abc'); assert.equal(redact(null), null);
});
test('edge: dotfile & folder internal diblokir, rute normal & .well-known lolos', () => {
  Object.assign(process.env, { NODE_ENV: 'production', DB_HOST: '127.0.0.1', DB_USER: 'u', DB_PASSWORD: 'p', DB_NAME: 'n', SESSION_SECRET: 's'.repeat(40), DATA_KEY: 'ab'.repeat(32), APP_URL: 'http://shop.test', LOG_FORMAT: 'json', LOG_COLOR: 'false' });
  for (const k of ['SERVER_PORT', 'PORT']) delete process.env[k];
  const { isSensitivePath, canonPath } = require('../dist/server/http/edge');
  for (const bad of ['/.env', '/.env.production', '/.git/config', '/.next/BUILD_ID', '/a/.env', '/dist/server/core/config.js', '/src/server/core/config.ts', '/node_modules/x', '/%2eenv', '//.env', '/x/../.env'])
    assert.equal(isSensitivePath(canonPath(bad)), true, bad);
  for (const good of ['/', '/products', '/orders/NV123', '/_next/static/chunks/a.js', '/.well-known/security.txt', '/media/12', '/icon.webp', '/api/recent', '/robots.txt'])
    assert.equal(isSensitivePath(canonPath(good)), false, good);
});
