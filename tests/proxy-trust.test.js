'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const path = require('path');

const target = path.join(__dirname, '..', 'dist', 'server', 'http', 'net.js');
const origLoad = Module._load;
function load(cfg) {
  Module._load = function (req, parent, ...rest) { return req === '../core/config' ? { config: cfg } : origLoad.call(this, req, parent, ...rest); };
  delete require.cache[target];
  try { return require(target); } finally { Module._load = origLoad; }
}
const req = (ip, headers = {}) => ({ socket: { remoteAddress: ip }, headers });
const base = { behindCloudflare: false, trustProxy: 1, trustedProxies: [], adminIps: [] };

test('loopback dan IP Cloudflare dipercaya; rentang privat lain TIDAK', () => {
  const n = load(base);
  assert.equal(n.clientIp(req('127.0.0.1', { 'x-forwarded-for': '1.2.3.4' })), '1.2.3.4');
  assert.equal(n.clientIp(req('::1', { 'x-forwarded-for': '1.2.3.4' })), '1.2.3.4');
  assert.equal(n.clientIp(req('173.245.48.1', { 'x-forwarded-for': '1.2.3.4' })), '1.2.3.4');
  for (const peer of ['10.0.0.9', '172.18.0.5', '192.168.1.5', '169.254.1.1', 'fd00::1']) {
    assert.equal(n.clientIp(req(peer, { 'x-forwarded-for': '1.2.3.4' })), peer, `${peer} tidak boleh memalsukan IP`);
  }
  assert.equal(n.isSecure(req('10.0.0.9', { 'x-forwarded-proto': 'https' })), false);
});

test('TRUSTED_PROXY_IPS: IP, CIDR, "private"; entri rusak dilaporkan', () => {
  const n = load({ ...base, behindCloudflare: true, trustedProxies: ['172.18.0.1', '10.5.0.0/16', 'bogus', '1.2.3.4/99'] });
  assert.equal(n.clientIp(req('172.18.0.1', { 'cf-connecting-ip': '9.9.9.9' })), '9.9.9.9');
  assert.equal(n.clientIp(req('::ffff:172.18.0.1', { 'cf-connecting-ip': '9.9.9.9' })), '9.9.9.9');
  assert.equal(n.clientIp(req('10.5.7.7', { 'cf-connecting-ip': '9.9.9.9' })), '9.9.9.9');
  assert.equal(n.clientIp(req('172.18.0.2', { 'cf-connecting-ip': '9.9.9.9' })), '172.18.0.2');
  assert.deepEqual(n.badTrustedProxyEntries(), ['bogus', '1.2.3.4/99']);
  const old = load({ ...base, trustedProxies: ['private'] });
  assert.equal(old.clientIp(req('192.168.1.5', { 'x-forwarded-for': '1.2.3.4' })), '1.2.3.4');
});
