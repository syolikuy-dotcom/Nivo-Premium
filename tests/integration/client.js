'use strict';
// Klien HTTP kecil dengan cookie jar + CSRF, untuk uji integrasi.
const BASE = process.env.IT_BASE || 'http://127.0.0.1:3100';
class Client {
  constructor(ip) { this.jar = new Map(); this.ip = ip || null; }
  _cookieHeader() { return [...this.jar].map(([k, v]) => `${k}=${v}`).join('; '); }
  _store(res) {
    const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
    for (const line of list) {
      const [pair, ...attrs] = line.split(';'); const i = pair.indexOf('=');
      const k = pair.slice(0, i).trim(); const v = pair.slice(i + 1).trim();
      const gone = attrs.some((a) => /^\s*max-age=0/i.test(a)) || v === '';
      if (gone) this.jar.delete(k); else this.jar.set(k, v);
    }
  }
  get csrf() { return this.jar.get('nivo_csrf') || ''; }
  async req(method, path, { json, raw, headers = {}, redirect = 'manual', csrf = true } = {}) {
    const h = { ...headers };
    const ck = this._cookieHeader(); if (ck) h.cookie = ck;
    if (this.ip) h['x-forwarded-for'] = this.ip;
    let body;
    if (json !== undefined) { h['content-type'] = 'application/json'; body = JSON.stringify(json); }
    if (raw !== undefined) body = raw;
    if (method !== 'GET' && csrf && this.csrf) h['x-csrf-token'] = this.csrf;
    const res = await fetch(BASE + path, { method, headers: h, body, redirect });
    this._store(res);
    const text = await res.text();
    let data = null; try { data = JSON.parse(text); } catch { /* html */ }
    return { status: res.status, headers: res.headers, text, json: data, data: data && data.data, err: data && data.error };
  }
  get(p, o) { return this.req('GET', p, o); }
  post(p, json, o) { return this.req('POST', p, { json: json === undefined ? {} : json, ...o }); }
  async boot() { await this.get('/api/recent'); return this; } // memberi cookie CSRF
}
const idem = () => require('crypto').randomBytes(18).toString('hex');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, { tries = 40, every = 300 } = {}) { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(every); } return null; }
const mock = (p) => fetch(`http://127.0.0.1:4010/api/ctl/${p}`, { method: 'POST' }).then((r) => r.json());
module.exports = { Client, idem, sleep, until, mock, BASE };
