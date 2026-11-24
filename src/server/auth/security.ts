import * as crypto from 'crypto';
import { config } from '../core/config';

const randomToken = (bytes = 32): string => crypto.randomBytes(bytes).toString('base64url');
const sha256 = (s: unknown): string => crypto.createHash('sha256').update(String(s)).digest('hex');
const subKey = (label: string) => crypto.createHash('sha256').update(`${config.sessionSecret}:${label}`).digest();
const hmacHex = (label: string, data: unknown): string => crypto.createHmac('sha256', subKey(label)).update(String(data)).digest('hex');
function safeEqual(a: unknown, b: unknown): boolean {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

let argon: typeof import('@node-rs/argon2') | null = null;
try { argon = require('@node-rs/argon2'); } catch { /* abaikan: best-effort */ }
const ARGON = { algorithm: 2, memoryCost: 19456, timeCost: 2, parallelism: 1 };
const hasArgon = () => Boolean(argon);
const prep = (pw: string) => String(pw).normalize('NFKC');

const N = 16384, R = 8, P = 1, KEYLEN = 64;
const scrypt = (pw: string, salt: Buffer, n: number, r: number, p: number) => new Promise<Buffer>((res, rej) =>
  crypto.scrypt(prep(pw), salt, KEYLEN, { N: n, r, p, maxmem: 128 * n * r * 2 + (1 << 20) }, (e, k) => (e ? rej(e) : res(k))));
async function hashPassword(pw: string): Promise<string> {
  if (argon) return argon.hash(prep(pw), ARGON);
  const salt = crypto.randomBytes(16);
  const k = await scrypt(pw, salt, N, R, P);
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64url')}$${k.toString('base64url')}`;
}
async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  try {
    const st = String(stored);
    if (st.startsWith('$argon2')) return argon ? await argon.verify(st, prep(pw)) : false;
    const [alg, n, r, p, s, h] = st.split('$');
    if (alg !== 'scrypt') return false;
    const k = await scrypt(pw, Buffer.from(s, 'base64url'), +n, +r, +p);
    const exp = Buffer.from(h, 'base64url');
    return exp.length === k.length && crypto.timingSafeEqual(exp, k);
  } catch { return false; }
}
const needsRehash = (stored: string) => Boolean(argon) && !String(stored).startsWith('$argon2');
let dummy: Promise<string> | undefined;
async function dummyVerify(pw: string): Promise<false> {
  dummy = dummy || hashPassword(randomToken(12));
  await verifyPassword(pw, await dummy);
  return false;
}

const KEY = Buffer.from(config.dataKey, 'hex');
function encrypt(value: unknown): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const ct = Buffer.concat([c.update(JSON.stringify(value), 'utf8'), c.final()]);
  return ['v1', iv, c.getAuthTag(), ct].map((x, i) => (i ? x.toString('base64url') : x)).join('.');
}
function decrypt(s: unknown): any {
  if (!s) return null;
  try {
    const [v, iv, tag, ct] = String(s).split('.');
    if (v !== 'v1') return null;
    const d = crypto.createDecipheriv('aes-256-gcm', KEY, Buffer.from(iv, 'base64url'));
    d.setAuthTag(Buffer.from(tag, 'base64url'));
    return JSON.parse(Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8'));
  } catch { return null; }
}

function csrfCreate(): string { const r = randomToken(24); return `${r}.${hmacHex('csrf', r)}`; }
function csrfValid(t: unknown): boolean {
  if (typeof t !== 'string' || t.length > 200) return false;
  const [r, sig] = t.split('.');
  return Boolean(r && sig && safeEqual(hmacHex('csrf', r), sig));
}

const CHALLENGE_TTL_MS = 5 * 60e3;
function challengeCreate(userId: number, now = Date.now()): string {
  const body = `${userId}.${now + CHALLENGE_TTL_MS}.${randomToken(9)}`;
  return `${body}.${hmacHex('login2fa', body)}`;
}
function challengeVerify(token: unknown, now = Date.now()): number | null {
  if (typeof token !== 'string' || token.length > 200) return null;
  const parts = token.split('.');
  if (parts.length !== 4) return null;
  const [uid, exp, nonce, sig] = parts;
  if (!/^\d{1,15}$/.test(uid) || !/^\d{1,15}$/.test(exp) || !nonce || !safeEqual(hmacHex('login2fa', `${uid}.${exp}.${nonce}`), sig)) return null;
  return Number(exp) > now ? Number(uid) : null;
}

function newNo(prefix: string): string {
  const d = new Date(Date.now() + 7 * 3600e3);
  const ymd = String(d.getUTCFullYear()).slice(2) + String(d.getUTCMonth() + 1).padStart(2, '0') + String(d.getUTCDate()).padStart(2, '0');
  return `${prefix}${ymd}${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}
function maskName(v: unknown): string {
  const s = String(v || '');
  return s.length <= 3 ? `${s.slice(0, 1)}***` : `${s.slice(0, 2)}***${s.slice(-1)}`;
}
const escapeLike = (s: unknown): string => String(s).replace(/[\\%_]/g, '\\$&');

export { challengeCreate, challengeVerify, randomToken, sha256, hmacHex, safeEqual, hashPassword, verifyPassword, needsRehash, hasArgon, dummyVerify, encrypt, decrypt, csrfCreate, csrfValid, newNo, maskName, escapeLike };
