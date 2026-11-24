import { config } from '../core/config';
import { once } from '../core/singleton';
import * as log from '../core/logger';
import {
  HealthTracker, Gate, GateFull, Coalescer, TtlCache, backoffMs, parseRetryAfter, looksLikeAuthError, looksLikeInsufficient,
} from './resilience';
import type { HealthSnapshot } from './resilience';

export type PremkuJson = Record<string, any>;
export type Kind = 'definitive' | 'ambiguous';

export class PremkuError extends Error {
  kind: Kind; status?: number; retryAfterMs?: number;
  constructor(kind: Kind, message: string, status?: number, retryAfterMs?: number) { super(message); this.name = 'PremkuError'; this.kind = kind; this.status = status; this.retryAfterMs = retryAfterMs; }
}

type Retry = 'safe' | 'rate' | 'none';
interface CallOpts { timeout?: number; retry?: Retry;  budget?: number;  coalesce?: string }

const S = once('premku.state', () => ({
  health: new HealthTracker(),
  gate: new Gate(4, 150),
  co: new Coalescer(),
  stock: new TtlCache<number>(3000),
  balance: null as { value: number; at: number } | null,
  sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
}));

const rememberBalance = (v: unknown): void => { const n = Number(v); if (Number.isFinite(n) && n >= 0) S.balance = { value: n, at: Date.now() }; };

async function attempt(path: string, params: Record<string, unknown>, timeout: number): Promise<PremkuJson> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  let res: Response; let text: string;
  try {
    res = await fetch(`${config.premku.base}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'NivoPremium/1.0' },
      body: JSON.stringify({ api_key: config.premku.apiKey, ...params }),
      signal: ctrl.signal, redirect: 'error',
    });
    text = await res.text();
  } catch (e) {
    const msg = e.name === 'AbortError' ? 'timeout' : 'koneksi gagal';
    S.health.transient(msg);
    throw new PremkuError('ambiguous', msg);
  } finally { clearTimeout(timer); }

  if (res.status === 429) {
    const ra = parseRetryAfter(res.headers.get('retry-after'));
    S.health.limited(ra);
    throw new PremkuError('ambiguous', 'upstream 429', 429, ra);
  }
  let json: PremkuJson | null = null;
  try { json = JSON.parse(text); } catch { /* abaikan: best-effort */ }
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
    if (looksLikeAuthError(msg)) S.health.auth(msg); else S.health.alive();
    if (looksLikeInsufficient(msg)) S.health.insufficient();
    throw new PremkuError('definitive', msg, res.status);
  }
  S.health.alive();
  return json;
}

async function loop(path: string, params: Record<string, unknown>, o: CallOpts): Promise<PremkuJson> {
  const timeout = o.timeout ?? 15000; const budget = o.budget ?? 20000; const retry = o.retry ?? 'none';
  const max = retry === 'none' ? 1 : 3; const t0 = Date.now();
  let last: PremkuError | null = null;
  for (let n = 1; n <= max; n++) {
    if (!S.health.allow()) throw last || new PremkuError('ambiguous', 'supplier sedang gangguan', 503);
    const wait = S.health.waitMs();
    if (wait > 0) {
      if (Date.now() - t0 + wait > budget) throw last || new PremkuError('ambiguous', 'dibatasi supplier (429)', 429);
      await S.sleep(wait);
    }
    try {
      return await S.gate.run(() => attempt(path, params, timeout));
    } catch (e) {
      if (e instanceof GateFull) throw new PremkuError('ambiguous', 'antrean supplier penuh', 503);
      if (!(e instanceof PremkuError)) throw e;
      last = e;
      const again = retry === 'safe' ? e.kind === 'ambiguous' : retry === 'rate' ? e.status === 429 : false;
      if (!again || n === max) throw e;
      const delay = backoffMs(n, e.retryAfterMs);
      if (Date.now() - t0 + delay > budget) throw e;
      await S.sleep(delay);
    }
  }
  throw last as PremkuError;
}

function call(path: string, params: Record<string, unknown> = {}, o: CallOpts = {}): Promise<PremkuJson> {
  if (!config.premku.apiKey) return Promise.reject(new PremkuError('definitive', 'PREMKU_API_KEY belum diisi'));
  return o.coalesce ? S.co.run(`${path}:${o.coalesce}`, () => loop(path, params, o)) : loop(path, params, o);
}

const PAID = new Set(['success', 'paid', 'settlement', 'completed', 'sukses', 'berhasil', 'done']);
const CANCELED = new Set(['canceled', 'cancelled', 'cancel', 'dibatalkan']);
const EXPIRED = new Set(['expired', 'failed', 'kedaluwarsa', 'gagal']);
const seenStatus = new Set<string>();
function normPay(v: unknown): 'paid' | 'canceled' | 'expired' | 'pending' {
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
const clip = (v: unknown): string => String(v ?? '').trim().slice(0, ACC_LIMIT);
const isText = (v: unknown): boolean => (typeof v === 'string' && v.trim() !== '') || typeof v === 'number';

function oneAccount(a: unknown): { username: string; password: string } | null {
  if (a == null) return null;
  if (typeof a === 'string' || typeof a === 'number') {
    const t = String(a).trim(); if (!t) return null;
    const bar = t.indexOf('|');
    if (bar > 0) return { username: clip(t.slice(0, bar)), password: clip(t.slice(bar + 1)) };
    const m = /^([^\s:]+@[^\s:]+|\+?\d{6,}):(.+)$/.exec(t);
    if (m) return { username: clip(m[1]), password: clip(m[2]) };
    return { username: clip(t), password: '' };
  }
  if (Array.isArray(a)) {
    const v = a.filter(isText).map(clip); if (!v.length) return null;
    return { username: v[0], password: v.slice(1).join(' ') };
  }
  if (typeof a !== 'object') return null;
  const o: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(a as Record<string, unknown>)) o[k.toLowerCase()] = v;
  const pick = (keys: string[], skip?: string): string | undefined => { for (const k of keys) if (k !== skip && isText(o[k])) return k; return undefined; };
  const uk = pick(USER_KEYS); const pk = pick(PASS_KEYS, uk);
  let username = uk ? clip(o[uk]) : ''; let password = pk ? clip(o[pk]) : '';
  const extra = Object.entries(o).filter(([k, v]) => k !== uk && k !== pk && !META_KEYS.has(k) && isText(v)).map(([, v]) => clip(v));
  if (!username && !password) {
    const v = Object.entries(o).filter(([k, x]) => !META_KEYS.has(k) && isText(x)).map(([, x]) => clip(x));
    if (!v.length) return null;
    return { username: v[0], password: v.slice(1).join(' ') };
  }
  if (extra.length) password = [password, ...extra].filter(Boolean).join(' - ').slice(0, ACC_LIMIT);
  return { username, password };
}
function normAccounts(list: unknown): { username: string; password: string }[] {
  let arr: unknown[] = [];
  if (Array.isArray(list)) arr = list;
  else if (typeof list === 'string' && list.trim()) arr = list.split(/\r?\n/);
  else if (list && typeof list === 'object') arr = [list];
  return arr.slice(0, 1000).map(oneAccount).filter((a): a is { username: string; password: string } => !!a && !!(a.username || a.password));
}

type Acc = { username: string; password: string };
const STRONG_KEYS = new Set(['username', 'user', 'email', 'login', 'account', 'akun', 'phone', 'nomor', 'no_hp', 'password', 'pass', 'pwd', 'passwd', 'secret', 'token']);
const ACC_KEY_RE = /acc|akun|cred|login/i;
const WRAP_KEYS = new Set(['data', 'result', 'results', 'items', 'list', 'detail', 'details', 'products', 'order', 'orders', 'delivery']);
const FIRST_KEYS = ['accounts', 'account', 'akun', 'credentials', 'account_data', 'data_akun'];
const parseMaybeJson = (v: unknown): unknown => {
  if (typeof v !== 'string') return v;
  const t = v.trim();
  if (t.length < 2 || !/^[[{]/.test(t)) return v;
  try { return JSON.parse(t); } catch { return v; }
};
const isTextKey = (o: Record<string, unknown>, test: (k: string) => boolean): boolean => Object.entries(o).some(([k, v]) => test(k.toLowerCase()) && isText(v));
const looksAccount = (o: Record<string, unknown>, top: boolean): boolean => isTextKey(o, (k) => STRONG_KEYS.has(k)) || (!top && isTextKey(o, (k) => k === 'link' || k === 'url'));

function collect(v0: unknown, depth: number, top: boolean): Acc[] {
  const v = parseMaybeJson(v0);
  if (v == null || depth > 4) return [];
  if (typeof v === 'string') return top ? [] : normAccounts(v);
  if (Array.isArray(v)) {
    const out: Acc[] = [];
    for (const el of v.slice(0, 1000)) {
      const e = parseMaybeJson(el);
      if (e && typeof e === 'object' && !Array.isArray(e) && !looksAccount(e as Record<string, unknown>, false)) out.push(...collect(e, depth + 1, false));
      else { const a = oneAccount(e); if (a && (a.username || a.password)) out.push(a); }
    }
    return out;
  }
  if (typeof v !== 'object') return [];
  const o = v as Record<string, unknown>;
  if (looksAccount(o, top)) { const a = oneAccount(o); return a && (a.username || a.password) ? [a] : []; }
  const keys = Object.keys(o);
  const ordered = [...FIRST_KEYS.filter((k) => keys.includes(k)), ...keys.filter((k) => !FIRST_KEYS.includes(k))];
  for (const k of ordered) {
    const lk = k.toLowerCase();
    if (!FIRST_KEYS.includes(k) && !ACC_KEY_RE.test(lk) && !WRAP_KEYS.has(lk)) continue;
    const got = collect(o[k], depth + 1, top && !FIRST_KEYS.includes(k) && !ACC_KEY_RE.test(lk));
    if (got.length) return got;
  }
  return [];
}
function extractAccounts(r: PremkuJson | null | undefined): Acc[] {
  if (!r || typeof r !== 'object') return [];
  const raw = r as Record<string, unknown>;
  const roots: unknown[] = [];
  for (const k of ['data', 'result']) { const x = parseMaybeJson(raw[k]); if (x && typeof x === 'object') { roots.push(x); break; } }
  roots.push(raw);
  for (const root of roots) { const got = collect(root, 0, true); if (got.length) return got; }
  return [];
}
function shapeOf(v: unknown, depth = 0): unknown {
  if (v == null || typeof v !== 'object') return typeof v === 'string' ? `<string ${v.length}>` : v === null ? null : typeof v;
  if (depth > 3) return '…';
  if (Array.isArray(v)) return v.length ? [`${v.length}x`, shapeOf(v[0], depth + 1)] : [];
  return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, shapeOf(x, depth + 1)]));
}

function parsePay(r: PremkuJson | null | undefined, amount: number) {
  const x = (r && (r.data || r.result)) || r || {};
  const toInt = (v: unknown): number => { const n = Math.floor(Number(String(v ?? '').replace(/[^\d]/g, ''))); return Number.isFinite(n) ? n : 0; };
  const invoice = x.invoice || x.invoice_id || x.id || x.order_id;
  const raw = [x.qr_raw, x.qr_string, x.qris, x.qr_content].find((v) => typeof v === 'string' && v.trim() && !v.startsWith('data:image'));
  let img = [x.qr_image, x.qr].find((v) => typeof v === 'string' && v.trim());
  if (img && !img.startsWith('data:image')) img = /^[A-Za-z0-9+/=\s]{200,}$/.test(img) ? `data:image/png;base64,${img.replace(/\s+/g, '')}` : undefined;
  if (img && !/^data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(img)) img = undefined;
  const qr = raw || img;
  const kode = toInt(x.kode_unik ?? x.unique_code);
  let due = toInt(x.total_bayar ?? x.total ?? x.amount_total);
  if (!due && kode) due = amount + kode;
  const maxDue = amount + Math.max(5000, Math.ceil(amount * 0.05));
  const problems = [];
  if (!invoice) problems.push('invoice kosong');
  if (!qr) problems.push('qr_raw/qr_image kosong');
  if (!(due >= amount && due <= maxDue)) problems.push(`total_bayar=${x.total_bayar} di luar rentang untuk amount=${amount}`);
  const shape = Object.fromEntries(Object.entries(x).map(([k, v]) => [k, typeof v === 'string' && v.length > 40 ? `<string ${v.length}>` : v]));
  return { ok: !problems.length, invoice: invoice && String(invoice), qr, kode, due, problems, shape };
}

export { parsePay, normPay, normAccounts, extractAccounts, shapeOf };

const READ: CallOpts = { retry: 'safe', timeout: 12000, budget: 15000 };
export const profile = async (): Promise<PremkuJson> => { const r = await call('profile', {}, { ...READ, coalesce: 'x' }); rememberBalance(r.data && r.data.saldo); return r; };
export const products = () => call('products', {}, { ...READ, coalesce: 'x', timeout: 20000, budget: 25000 });
export const stock = async (product_id: number): Promise<PremkuJson> => {
  const hit = S.stock.get(String(product_id));
  if (hit !== undefined) return { success: true, stock: hit };
  const r = await call('stock', { product_id }, { ...READ, coalesce: String(product_id), budget: 8000 });
  const n = Math.max(0, Math.floor(Number(r.stock) || 0)); S.stock.set(String(product_id), n);
  return r;
};
export const order = async ({ product_id, qty, ref_id }: { product_id: number; qty: number; ref_id: string }): Promise<PremkuJson> => {
  const r = await call('order', { product_id, qty, ref_id }, { retry: 'safe', timeout: 20000, budget: 30000 });
  S.stock.delete(String(product_id)); rememberBalance(r.data && r.data.balance_after);
  return r;
};
export const status = (invoice: string) => call('status', { invoice }, { ...READ, coalesce: invoice, budget: 10000 });
export const pay = (amount: number) => call('pay', { amount }, { retry: 'rate', budget: 12000 });
export const payStatus = (invoice: string) => call('pay_status', { invoice }, { ...READ, coalesce: invoice, budget: 10000 });
export const cancelPay = (invoice: string) => call('cancel_pay', { invoice }, { retry: 'rate', budget: 10000 });
export const am = (action: string, params: Record<string, unknown> = {}) =>
  call('am', { action, ...params }, { timeout: 25000, budget: 40000, retry: action === 'buy_bulk' ? 'safe' : 'rate' });

export const health = (): HealthSnapshot & { configured: boolean; queued: number } => {
  const h = S.health.snapshot();
  return { ...h, state: config.premku.apiKey ? h.state : 'unconfigured', configured: Boolean(config.premku.apiKey), queued: S.gate.pending };
};
export const available = (): boolean => !S.health.snapshot().breakerOpen;
export const lastBalance = (): { value: number; at: number } | null => S.balance;

export const __test = {
  reset() { S.health = new HealthTracker(); S.gate = new Gate(4, 0); S.co = new Coalescer(); S.stock = new TtlCache<number>(3000); S.balance = null; },
  setSleep(fn: (ms: number) => Promise<void>) { S.sleep = fn; },
  tracker: () => S.health,
};
