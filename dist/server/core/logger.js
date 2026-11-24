"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.error = exports.warn = exports.info = void 0;
exports.access = access;
const config_1 = require("./config");
const redact_1 = require("./redact");
const C = config_1.config.log.color ? { r: '\x1b[0m', d: '\x1b[2m', red: '\x1b[31m', grn: '\x1b[32m', yel: '\x1b[33m', blu: '\x1b[34m', mag: '\x1b[35m', cyn: '\x1b[36m', b: '\x1b[1m' }
    : { r: '', d: '', red: '', grn: '', yel: '', blu: '', mag: '', cyn: '', b: '' };
const clean = (v, n = 300) => String(v).replace(/\s*\r?\n\s*/g, ' | ').replace(/[^\x20-\x7e\u00a0-\uffff]/g, '?').slice(0, n);
const stamp = () => new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Jakarta' });
const kv = (m) => Object.entries((0, redact_1.redact)(m || {})).filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${C.d}${k}=${C.r}${clean(typeof v === 'object' ? JSON.stringify(v) : v)}`).join(' ');
function out(lvl, color, fn, msg, meta) {
    if (config_1.config.log.json)
        return fn(JSON.stringify({ t: new Date().toISOString(), lvl, msg, ...(0, redact_1.redact)(meta || {}) }));
    return fn(`${C.d}${stamp()}${C.r}  ${color}${lvl.toUpperCase().padEnd(5)}${C.r}  ${clean(msg, 400)}${meta ? `  ${kv(meta)}` : ''}`);
}
const METHOD_COLOR = { GET: 'grn', POST: 'cyn', PUT: 'yel', PATCH: 'yel', DELETE: 'red' };
const statusColor = (s) => (s >= 500 ? C.red : s >= 400 ? C.yel : s >= 300 ? C.cyn : C.grn);
function access({ method, path, status, ms, ip, user }) {
    if (config_1.config.log.json)
        return console.log(JSON.stringify({ t: new Date().toISOString(), lvl: 'access', method, path, status, ms, ip, user }));
    const m = `${C[METHOD_COLOR[method || ''] || 'blu']}${clean(method || '', 7).padEnd(7)}${C.r}`;
    const st = `${statusColor(status)}${C.b}${status}${C.r}`;
    return console.log(`${C.d}${stamp()}${C.r}  ${m}${st}  ${clean(path, 140)}  ${C.d}${ms}ms${C.r}  ${C.blu}${clean(ip, 45)}${C.r}${user ? `  ${C.mag}@${clean(user, 20)}${C.r}` : ''}`);
}
const info = (m, x) => out('info', C.grn, console.log, m, x);
exports.info = info;
const warn = (m, x) => out('warn', C.yel, console.warn, m, x);
exports.warn = warn;
const error = (m, x) => out('error', C.red, console.error, m, x);
exports.error = error;
