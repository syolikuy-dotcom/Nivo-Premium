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
exports.escapeLike = exports.hasArgon = exports.needsRehash = exports.hmacHex = exports.sha256 = exports.randomToken = void 0;
exports.challengeCreate = challengeCreate;
exports.challengeVerify = challengeVerify;
exports.safeEqual = safeEqual;
exports.hashPassword = hashPassword;
exports.verifyPassword = verifyPassword;
exports.dummyVerify = dummyVerify;
exports.encrypt = encrypt;
exports.decrypt = decrypt;
exports.csrfCreate = csrfCreate;
exports.csrfValid = csrfValid;
exports.newNo = newNo;
exports.maskName = maskName;
const crypto = __importStar(require("crypto"));
const config_1 = require("../core/config");
const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
exports.randomToken = randomToken;
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
exports.sha256 = sha256;
const subKey = (label) => crypto.createHash('sha256').update(`${config_1.config.sessionSecret}:${label}`).digest();
const hmacHex = (label, data) => crypto.createHmac('sha256', subKey(label)).update(String(data)).digest('hex');
exports.hmacHex = hmacHex;
function safeEqual(a, b) {
    const x = Buffer.from(String(a));
    const y = Buffer.from(String(b));
    return x.length === y.length && crypto.timingSafeEqual(x, y);
}
let argon = null;
try {
    argon = require('@node-rs/argon2');
}
catch { }
const ARGON = { algorithm: 2, memoryCost: 19456, timeCost: 2, parallelism: 1 };
const hasArgon = () => Boolean(argon);
exports.hasArgon = hasArgon;
const prep = (pw) => String(pw).normalize('NFKC');
const N = 16384, R = 8, P = 1, KEYLEN = 64;
const scrypt = (pw, salt, n, r, p) => new Promise((res, rej) => crypto.scrypt(prep(pw), salt, KEYLEN, { N: n, r, p, maxmem: 128 * n * r * 2 + (1 << 20) }, (e, k) => (e ? rej(e) : res(k))));
async function hashPassword(pw) {
    if (argon)
        return argon.hash(prep(pw), ARGON);
    const salt = crypto.randomBytes(16);
    const k = await scrypt(pw, salt, N, R, P);
    return `scrypt$${N}$${R}$${P}$${salt.toString('base64url')}$${k.toString('base64url')}`;
}
async function verifyPassword(pw, stored) {
    try {
        const st = String(stored);
        if (st.startsWith('$argon2'))
            return argon ? await argon.verify(st, prep(pw)) : false;
        const [alg, n, r, p, s, h] = st.split('$');
        if (alg !== 'scrypt')
            return false;
        const k = await scrypt(pw, Buffer.from(s, 'base64url'), +n, +r, +p);
        const exp = Buffer.from(h, 'base64url');
        return exp.length === k.length && crypto.timingSafeEqual(exp, k);
    }
    catch {
        return false;
    }
}
const needsRehash = (stored) => Boolean(argon) && !String(stored).startsWith('$argon2');
exports.needsRehash = needsRehash;
let dummy;
async function dummyVerify(pw) {
    dummy = dummy || hashPassword(randomToken(12));
    await verifyPassword(pw, await dummy);
    return false;
}
const KEY = Buffer.from(config_1.config.dataKey, 'hex');
function encrypt(value) {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
    const ct = Buffer.concat([c.update(JSON.stringify(value), 'utf8'), c.final()]);
    return ['v1', iv, c.getAuthTag(), ct].map((x, i) => (i ? x.toString('base64url') : x)).join('.');
}
function decrypt(s) {
    if (!s)
        return null;
    try {
        const [v, iv, tag, ct] = String(s).split('.');
        if (v !== 'v1')
            return null;
        const d = crypto.createDecipheriv('aes-256-gcm', KEY, Buffer.from(iv, 'base64url'));
        d.setAuthTag(Buffer.from(tag, 'base64url'));
        return JSON.parse(Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8'));
    }
    catch {
        return null;
    }
}
function csrfCreate() { const r = randomToken(24); return `${r}.${hmacHex('csrf', r)}`; }
function csrfValid(t) {
    if (typeof t !== 'string' || t.length > 200)
        return false;
    const [r, sig] = t.split('.');
    return Boolean(r && sig && safeEqual(hmacHex('csrf', r), sig));
}
const CHALLENGE_TTL_MS = 5 * 60e3;
function challengeCreate(userId, now = Date.now()) {
    const body = `${userId}.${now + CHALLENGE_TTL_MS}.${randomToken(9)}`;
    return `${body}.${hmacHex('login2fa', body)}`;
}
function challengeVerify(token, now = Date.now()) {
    if (typeof token !== 'string' || token.length > 200)
        return null;
    const parts = token.split('.');
    if (parts.length !== 4)
        return null;
    const [uid, exp, nonce, sig] = parts;
    if (!/^\d{1,15}$/.test(uid) || !/^\d{1,15}$/.test(exp) || !nonce || !safeEqual(hmacHex('login2fa', `${uid}.${exp}.${nonce}`), sig))
        return null;
    return Number(exp) > now ? Number(uid) : null;
}
function newNo(prefix) {
    const d = new Date(Date.now() + 7 * 3600e3);
    const ymd = String(d.getUTCFullYear()).slice(2) + String(d.getUTCMonth() + 1).padStart(2, '0') + String(d.getUTCDate()).padStart(2, '0');
    return `${prefix}${ymd}${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}
function maskName(v) {
    const s = String(v || '');
    return s.length <= 3 ? `${s.slice(0, 1)}***` : `${s.slice(0, 2)}***${s.slice(-1)}`;
}
const escapeLike = (s) => String(s).replace(/[\\%_]/g, '\\$&');
exports.escapeLike = escapeLike;
