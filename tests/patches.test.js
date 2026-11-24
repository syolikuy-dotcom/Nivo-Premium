'use strict';
Object.assign(process.env, {
  NODE_ENV: 'production', DB_HOST: '127.0.0.1', DB_USER: 'u', DB_PASSWORD: 'p', DB_NAME: 'n',
  SESSION_SECRET: 's'.repeat(40), DATA_KEY: 'ab'.repeat(32), APP_URL: 'http://shop.test', LOG_FORMAT: 'json', LOG_COLOR: 'false',
});
for (const k of ['SERVER_PORT', 'PORT']) delete process.env[k];
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const path = require('path');

test('password: pola umum + huruf/leet tambahan ditolak; password kuat lolos', () => {
  const { schemas } = require('../dist/server/http/validate');
  const pw = (v) => schemas.changePassword.safeParse({ current: 'x', password: v, confirm: v }).success;
  for (const bad of ['password1A', 'Password123', 'P@ssw0rd1A', 'Welcome2024x', 'Qwerty123A', 'Abc12345', 'Nivopremium1x']) assert.equal(pw(bad), false, bad);
  for (const good of ['Kuda-Laut-Biru-77', 'Tr0ub4dor&3xY', 'Mangga9Hijau', 'Sapi12Lari']) assert.equal(pw(good), true, good);
});

const netPath = path.join(__dirname, '..', 'dist', 'server', 'http', 'net.js');
function loadNet(cfg) {
  const orig = Module._load;
  Module._load = function (req, parent, ...rest) { return req === '../core/config' ? { config: cfg } : orig.call(this, req, parent, ...rest); };
  delete require.cache[netPath];
  try { return require(netPath); } finally { Module._load = orig; }
}
const sock = (ip, h = {}) => ({ socket: { remoteAddress: ip }, headers: h });
const cfg = (adminIps) => ({ behindCloudflare: false, trustProxy: 1, trustedProxies: [], adminIps });

test('ADMIN_ALLOWED_IPS: IP tunggal, CIDR, IPv6 kanonik, IPv4-mapped; entri rusak dilaporkan; gagal-aman', () => {
  const n = loadNet(cfg(['203.0.113.9', '198.51.100.0/24', '2001:db8::/32', '2001:DB8:0:0:0:0:0:5']));
  assert.equal(n.adminIpOk(sock('203.0.113.9')), true);
  assert.equal(n.adminIpOk(sock('203.0.113.10')), false);
  assert.equal(n.adminIpOk(sock('198.51.100.77')), true, 'CIDR /24');
  assert.equal(n.adminIpOk(sock('198.51.101.1')), false);
  assert.equal(n.adminIpOk(sock('2001:db8:abcd::1')), true, 'CIDR IPv6');
  assert.equal(n.adminIpOk(sock('::ffff:203.0.113.9')), true, 'IPv4-mapped');
  assert.equal(n.adminIpOk(sock('2001:db9::1')), false);
  assert.deepEqual(n.badAdminIpEntries(), []);
  const bad = loadNet(cfg(['bukan-ip', '1.2.3.4/99']));
  assert.deepEqual(bad.badAdminIpEntries(), ['bukan-ip', '1.2.3.4/99']);
  assert.equal(bad.adminIpOk(sock('1.2.3.4')), false, 'semua entri rusak → tertutup, bukan terbuka');
  assert.equal(loadNet(cfg([])).adminIpOk(sock('9.9.9.9')), true, 'kosong = tidak dibatasi');
});

test('shouldRenewKey: 5xx/jaringan mempertahankan kunci (anti tagihan ganda); 4xx & payment_unavailable mengganti', () => {
  const src = require('fs').readFileSync(path.join(__dirname, '..', 'src', 'shared', 'api-client.ts'), 'utf8');
  const body = /export const shouldRenewKey = (.*?)\n};/s.exec(src)[0].replace('export const', 'const').replace(/\(e: unknown\): boolean/, '(e)').replace(/as Partial<ApiError> \| null/, '');
  const fn = new Function(`${body}; return shouldRenewKey;`)();
  assert.equal(fn({ network: true }), false);
  for (const s of [500, 502, 503, 504, 524]) assert.equal(fn({ status: s, code: undefined }), false, `HTTP ${s}`);
  assert.equal(fn({ status: 502, code: 'payment_unavailable' }), true);
  for (const s of [400, 402, 409, 429]) assert.equal(fn({ status: s, code: 'x' }), true, `HTTP ${s}`);
  assert.equal(fn(null), false);
  assert.equal(fn(new Error('boom')), false);
});
