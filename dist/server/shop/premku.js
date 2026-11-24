"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.__test = exports.lastBalance = exports.available = exports.health = exports.am = exports.cancelPay = exports.payStatus = exports.pay = exports.status = exports.order = exports.stock = exports.products = exports.profile = exports.PremkuError = void 0;
exports.parsePay = parsePay;
exports.normPay = normPay;
exports.normAccounts = normAccounts;
exports.extractAccounts = extractAccounts;
exports.shapeOf = shapeOf;
const config_1 = require("../core/config");
const singleton_1 = require("../core/singleton");
const log = __importStar(require("../core/logger"));
const resilience_1 = require("./resilience");
class PremkuError extends Error {
    kind;
    status;
    retryAfterMs;
    constructor(kind, message, status, retryAfterMs) { super(message); this.name = 'PremkuError'; this.kind = kind; this.status = status; this.retryAfterMs = retryAfterMs; }
}
exports.PremkuError = PremkuError;
const S = (0, singleton_1.once)('premku.state', () => ({
    health: new resilience_1.HealthTracker(),
    gate: new resilience_1.Gate(4, 150),
    co: new resilience_1.Coalescer(),
    stock: new resilience_1.TtlCache(3000),
    balance: null,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
}));
const rememberBalance = (v) => { const n = Number(v); if (Number.isFinite(n) && n >= 0)
    S.balance = { value: n, at: Date.now() }; };
async function attempt(path, params, timeout) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    let res;
    let text;
    try {
        res = await fetch(`${config_1.config.premku.base}/${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'NivoPremium/1.0' },
            body: JSON.stringify({ api_key: config_1.config.premku.apiKey, ...params }),
            signal: ctrl.signal, redirect: 'error',
        });
        text = await res.text();
    }
    catch (e) {
        const msg = e.name === 'AbortError' ? 'timeout' : 'koneksi gagal';
        S.health.transient(msg);
        throw new PremkuError('ambiguous', msg);
    }
    finally {
        clearTimeout(timer);
    }
    if (res.status === 429) {
        const ra = (0, resilience_1.parseRetryAfter)(res.headers.get('retry-after'));
        S.health.limited(ra);
        throw new PremkuError('ambiguous', 'upstream 429', 429, ra);
    }
    let json = null;
    try {
        json = JSON.parse(text);
    }
    catch { }
    if (res.status === 401 || res.status === 403) {
        const m = `API key / IP ditolak Premku (HTTP ${res.status})`;
        S.health.auth(m);
        throw new PremkuError('definitive', m, res.status);
    }
    if (res.status >= 500 || res.status === 408 || !json || typeof json !== 'object') {
        S.health.transient(`upstream ${res.status}`);
        throw new PremkuError('ambiguous', `upstream ${res.status}`, res.status);
    }
    if (json.success !== true) {
        const msg = String(json.message || 'ditolak').slice(0, 200);
        if ((0, resilience_1.looksLikeAuthError)(msg))
            S.health.auth(msg);
        else
            S.health.alive();
        if ((0, resilience_1.looksLikeInsufficient)(msg))
            S.health.insufficient();
        throw new PremkuError('definitive', msg, res.status);
    }
    S.health.alive();
    return json;
}
async function loop(path, params, o) {
    const timeout = o.timeout ?? 15000;
    const budget = o.budget ?? 20000;
    const retry = o.retry ?? 'none';
    const max = retry === 'none' ? 1 : 3;
    const t0 = Date.now();
    let last = null;
    for (let n = 1; n <= max; n++) {
        if (!S.health.allow())
            throw last || new PremkuError('ambiguous', 'supplier sedang gangguan', 503);
        const wait = S.health.waitMs();
        if (wait > 0) {
            if (Date.now() - t0 + wait > budget)
                throw last || new PremkuError('ambiguous', 'dibatasi supplier (429)', 429);
            await S.sleep(wait);
        }
        try {
            return await S.gate.run(() => attempt(path, params, timeout));
        }
        catch (e) {
            if (e instanceof resilience_1.GateFull)
                throw new PremkuError('ambiguous', 'antrean supplier penuh', 503);
            if (!(e instanceof PremkuError))
                throw e;
            last = e;
            const again = retry === 'safe' ? e.kind === 'ambiguous' : retry === 'rate' ? e.status === 429 : false;
            if (!again || n === max)
                throw e;
            const delay = (0, resilience_1.backoffMs)(n, e.retryAfterMs);
            if (Date.now() - t0 + delay > budget)
                throw e;
            await S.sleep(delay);
        }
    }
    throw last;
}
function call(path, params = {}, o = {}) {
    if (!config_1.config.premku.apiKey)
        return Promise.reject(new PremkuError('definitive', 'PREMKU_API_KEY belum diisi'));
    return o.coalesce ? S.co.run(`${path}:${o.coalesce}`, () => loop(path, params, o)) : loop(path, params, o);
}
const PAID = new Set(['success', 'paid', 'settlement', 'completed', 'sukses', 'berhasil', 'done']);
const CANCELED = new Set(['canceled', 'cancelled', 'cancel', 'dibatalkan']);
const EXPIRED = new Set(['expired', 'failed', 'kedaluwarsa', 'gagal']);
const seenStatus = new Set();
function normPay(v) {
    const s = String(v || '').toLowerCase();
    if (s && s !== 'pending' && !PAID.has(s) && !CANCELED.has(s) && !EXPIRED.has(s) && !seenStatus.has(s) && seenStatus.size < 20) {
        seenStatus.add(s);
        log.warn('status pembayaran Premku tidak dikenal, dianggap pending', { status: s.slice(0, 40) });
    }
    return PAID.has(s) ? 'paid' : CANCELED.has(s) ? 'canceled' : EXPIRED.has(s) ? 'expired' : 'pending';
}
const ACC_LIMIT = 1500;
const META_KEYS = new Set(['invoice', 'invoice_id', 'ref_id', 'refid', 'product', 'product_id', 'product_name', 'qty', 'quantity', 'price', 'total', 'status', 'balance_after', 'balance', 'saldo', 'message', 'msg', 'success', 'created_at', 'updated_at', 'timestamp', 'event', 'id']);
const USER_KEYS = ['username', 'user', 'email', 'login', 'account', 'akun', 'phone', 'nomor', 'no_hp', 'link', 'url'];
const PASS_KEYS = ['password', 'pass', 'pwd', 'passwd', 'secret', 'note', 'notes', 'catatan', 'keterangan', 'info', 'link', 'url', 'token'];
const clip = (v) => String(v ?? '').trim().slice(0, ACC_LIMIT);
const isText = (v) => (typeof v === 'string' && v.trim() !== '') || typeof v === 'number';
function oneAccount(a) {
    if (a == null)
        return null;
    if (typeof a === 'string' || typeof a === 'number') {
        const t = String(a).trim();
        if (!t)
            return null;
        const bar = t.indexOf('|');
        if (bar > 0)
            return { username: clip(t.slice(0, bar)), password: clip(t.slice(bar + 1)) };
        const m = /^([^\s:]+@[^\s:]+|\+?\d{6,}):(.+)$/.exec(t);
        if (m)
            return { username: clip(m[1]), password: clip(m[2]) };
        return { username: clip(t), password: '' };
    }
    if (Array.isArray(a)) {
        const v = a.filter(isText).map(clip);
        if (!v.length)
            return null;
        return { username: v[0], password: v.slice(1).join(' ') };
    }
    if (typeof a !== 'object')
        return null;
    const o = {};
    for (const [k, v] of Object.entries(a))
        o[k.toLowerCase()] = v;
    const pick = (keys, skip) => { for (const k of keys)
        if (k !== skip && isText(o[k]))
            return k; return undefined; };
    const uk = pick(USER_KEYS);
    const pk = pick(PASS_KEYS, uk);
    let username = uk ? clip(o[uk]) : '';
    let password = pk ? clip(o[pk]) : '';
    const extra = Object.entries(o).filter(([k, v]) => k !== uk && k !== pk && !META_KEYS.has(k) && isText(v)).map(([, v]) => clip(v));
    if (!username && !password) {
        const v = Object.entries(o).filter(([k, x]) => !META_KEYS.has(k) && isText(x)).map(([, x]) => clip(x));
        if (!v.length)
            return null;
        return { username: v[0], password: v.slice(1).join(' ') };
    }
    if (extra.length)
        password = [password, ...extra].filter(Boolean).join(' - ').slice(0, ACC_LIMIT);
    return { username, password };
}
function normAccounts(list) {
    let arr = [];
    if (Array.isArray(list))
        arr = list;
    else if (typeof list === 'string' && list.trim())
        arr = list.split(/\r?\n/);
    else if (list && typeof list === 'object')
        arr = [list];
    return arr.slice(0, 1000).map(oneAccount).filter((a) => !!a && !!(a.username || a.password));
}
const STRONG_KEYS = new Set(['username', 'user', 'email', 'login', 'account', 'akun', 'phone', 'nomor', 'no_hp', 'password', 'pass', 'pwd', 'passwd', 'secret', 'token']);
const ACC_KEY_RE = /acc|akun|cred|login/i;
const WRAP_KEYS = new Set(['data', 'result', 'results', 'items', 'list', 'detail', 'details', 'products', 'order', 'orders', 'delivery']);
const FIRST_KEYS = ['accounts', 'account', 'akun', 'credentials', 'account_data', 'data_akun'];
const parseMaybeJson = (v) => {
    if (typeof v !== 'string')
        return v;
    const t = v.trim();
    if (t.length < 2 || !/^[[{]/.test(t))
        return v;
    try {
        return JSON.parse(t);
    }
    catch {
        return v;
    }
};
const isTextKey = (o, test) => Object.entries(o).some(([k, v]) => test(k.toLowerCase()) && isText(v));
const looksAccount = (o, top) => isTextKey(o, (k) => STRONG_KEYS.has(k)) || (!top && isTextKey(o, (k) => k === 'link' || k === 'url'));
function collect(v0, depth, top) {
    const v = parseMaybeJson(v0);
    if (v == null || depth > 4)
        return [];
    if (typeof v === 'string')
        return top ? [] : normAccounts(v);
    if (Array.isArray(v)) {
        const out = [];
        for (const el of v.slice(0, 1000)) {
            const e = parseMaybeJson(el);
            if (e && typeof e === 'object' && !Array.isArray(e) && !looksAccount(e, false))
                out.push(...collect(e, depth + 1, false));
            else {
                const a = oneAccount(e);
                if (a && (a.username || a.password))
                    out.push(a);
            }
        }
        return out;
    }
    if (typeof v !== 'object')
        return [];
    const o = v;
    if (looksAccount(o, top)) {
        const a = oneAccount(o);
        return a && (a.username || a.password) ? [a] : [];
    }
    const keys = Object.keys(o);
    const ordered = [...FIRST_KEYS.filter((k) => keys.includes(k)), ...keys.filter((k) => !FIRST_KEYS.includes(k))];
    for (const k of ordered) {
        const lk = k.toLowerCase();
        if (!FIRST_KEYS.includes(k) && !ACC_KEY_RE.test(lk) && !WRAP_KEYS.has(lk))
            continue;
        const got = collect(o[k], depth + 1, top && !FIRST_KEYS.includes(k) && !ACC_KEY_RE.test(lk));
        if (got.length)
            return got;
    }
    return [];
}
function extractAccounts(r) {
    if (!r || typeof r !== 'object')
        return [];
    const raw = r;
    const roots = [];
    for (const k of ['data', 'result']) {
        const x = parseMaybeJson(raw[k]);
        if (x && typeof x === 'object') {
            roots.push(x);
            break;
        }
    }
    roots.push(raw);
    for (const root of roots) {
        const got = collect(root, 0, true);
        if (got.length)
            return got;
    }
    return [];
}
function shapeOf(v, depth = 0) {
    if (v == null || typeof v !== 'object')
        return typeof v === 'string' ? `<string ${v.length}>` : v === null ? null : typeof v;
    if (depth > 3)
        return '…';
    if (Array.isArray(v))
        return v.length ? [`${v.length}x`, shapeOf(v[0], depth + 1)] : [];
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shapeOf(x, depth + 1)]));
}
function parsePay(r, amount) {
    const x = (r && (r.data || r.result)) || r || {};
    const toInt = (v) => { const n = Math.floor(Number(String(v ?? '').replace(/[^\d]/g, ''))); return Number.isFinite(n) ? n : 0; };
    const invoice = x.invoice || x.invoice_id || x.id || x.order_id;
    const raw = [x.qr_raw, x.qr_string, x.qris, x.qr_content].find((v) => typeof v === 'string' && v.trim() && !v.startsWith('data:image'));
    let img = [x.qr_image, x.qr].find((v) => typeof v === 'string' && v.trim());
    if (img && !img.startsWith('data:image'))
        img = /^[A-Za-z0-9+/=\s]{200,}$/.test(img) ? `data:image/png;base64,${img.replace(/\s+/g, '')}` : undefined;
    if (img && !/^data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(img))
        img = undefined;
    const qr = raw || img;
    const kode = toInt(x.kode_unik ?? x.unique_code);
    let due = toInt(x.total_bayar ?? x.total ?? x.amount_total);
    if (!due && kode)
        due = amount + kode;
    const maxDue = amount + Math.max(5000, Math.ceil(amount * 0.05));
    const problems = [];
    if (!invoice)
        problems.push('invoice kosong');
    if (!qr)
        problems.push('qr_raw/qr_image kosong');
    if (!(due >= amount && due <= maxDue))
        problems.push(`total_bayar=${x.total_bayar} di luar rentang untuk amount=${amount}`);
    const shape = Object.fromEntries(Object.entries(x).map(([k, v]) => [k, typeof v === 'string' && v.length > 40 ? `<string ${v.length}>` : v]));
    return { ok: !problems.length, invoice: invoice && String(invoice), qr, kode, due, problems, shape };
}
const READ = { retry: 'safe', timeout: 12000, budget: 15000 };
const profile = async () => { const r = await call('profile', {}, { ...READ, coalesce: 'x' }); rememberBalance(r.data && r.data.saldo); return r; };
exports.profile = profile;
const products = () => call('products', {}, { ...READ, coalesce: 'x', timeout: 20000, budget: 25000 });
exports.products = products;
const stock = async (product_id) => {
    const hit = S.stock.get(String(product_id));
    if (hit !== undefined)
        return { success: true, stock: hit };
    const r = await call('stock', { product_id }, { ...READ, coalesce: String(product_id), budget: 8000 });
    const n = Math.max(0, Math.floor(Number(r.stock) || 0));
    S.stock.set(String(product_id), n);
    return r;
};
exports.stock = stock;
const order = async ({ product_id, qty, ref_id }) => {
    const r = await call('order', { product_id, qty, ref_id }, { retry: 'safe', timeout: 20000, budget: 30000 });
    S.stock.delete(String(product_id));
    rememberBalance(r.data && r.data.balance_after);
    return r;
};
exports.order = order;
const status = (invoice) => call('status', { invoice }, { ...READ, coalesce: invoice, budget: 10000 });
exports.status = status;
const pay = (amount) => call('pay', { amount }, { retry: 'rate', budget: 12000 });
exports.pay = pay;
const payStatus = (invoice) => call('pay_status', { invoice }, { ...READ, coalesce: invoice, budget: 10000 });
exports.payStatus = payStatus;
const cancelPay = (invoice) => call('cancel_pay', { invoice }, { retry: 'rate', budget: 10000 });
exports.cancelPay = cancelPay;
const am = (action, params = {}) => call('am', { action, ...params }, { timeout: 25000, budget: 40000, retry: action === 'buy_bulk' ? 'safe' : 'rate' });
exports.am = am;
const health = () => {
    const h = S.health.snapshot();
    return { ...h, state: config_1.config.premku.apiKey ? h.state : 'unconfigured', configured: Boolean(config_1.config.premku.apiKey), queued: S.gate.pending };
};
exports.health = health;
const available = () => !S.health.snapshot().breakerOpen;
exports.available = available;
const lastBalance = () => S.balance;
exports.lastBalance = lastBalance;
exports.__test = {
    reset() { S.health = new resilience_1.HealthTracker(); S.gate = new resilience_1.Gate(4, 0); S.co = new resilience_1.Coalescer(); S.stock = new resilience_1.TtlCache(3000); S.balance = null; },
    setSleep(fn) { S.sleep = fn; },
    tracker: () => S.health,
};
