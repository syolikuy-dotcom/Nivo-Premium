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
exports.sealState = exports.safeNextPath = exports.redirectUri = exports.cookieName = exports.STATE_TTL_MS = void 0;
exports.newState = newState;
exports.openState = openState;
exports.authUrl = authUrl;
exports.checkClaims = checkClaims;
exports.cleanName = cleanName;
exports.pickUsername = pickUsername;
exports.exchangeCode = exchangeCode;
const crypto = __importStar(require("crypto"));
const config_1 = require("../core/config");
const sec = __importStar(require("./security"));
const errors_1 = require("../core/errors");
const validate_1 = require("../http/validate");
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
exports.STATE_TTL_MS = 10 * 60e3;
const cookieName = (secure) => `${secure ? '__Host-' : ''}nivo_gst`;
exports.cookieName = cookieName;
const redirectUri = () => `${config_1.config.appUrl}/api/auth/google/callback`;
exports.redirectUri = redirectUri;
const b64 = (b) => Buffer.from(b).toString('base64url');
const sign = (body) => sec.hmacHex('google-state', body);
const safeNextPath = (n) => (typeof n === 'string' && n.length <= 300 && /^\/(?![/\\])[\w\-./?=&%#]*$/.test(n) ? n : '');
exports.safeNextPath = safeNextPath;
function newState(mode, userId, next, now = Date.now()) {
    return { s: sec.randomToken(24), n: sec.randomToken(24), v: sec.randomToken(48), m: mode, u: mode === 'link' ? userId : 0, nx: (0, exports.safeNextPath)(next), exp: now + exports.STATE_TTL_MS };
}
const sealState = (p) => { const body = b64(JSON.stringify(p)); return `${body}.${sign(body)}`; };
exports.sealState = sealState;
function openState(token, now = Date.now()) {
    if (typeof token !== 'string' || token.length > 1200)
        return null;
    const i = token.indexOf('.');
    if (i < 1)
        return null;
    const body = token.slice(0, i);
    if (!sec.safeEqual(token.slice(i + 1), sign(body)))
        return null;
    try {
        const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
        if (!p || typeof p.s !== 'string' || typeof p.n !== 'string' || typeof p.v !== 'string' || (p.m !== 'login' && p.m !== 'link') || typeof p.exp !== 'number' || p.exp < now)
            return null;
        return { s: p.s, n: p.n, v: p.v, m: p.m, u: Number(p.u) || 0, nx: (0, exports.safeNextPath)(p.nx), exp: p.exp };
    }
    catch {
        return null;
    }
}
function authUrl(p) {
    const q = new URLSearchParams({
        client_id: config_1.config.google.clientId, redirect_uri: (0, exports.redirectUri)(), response_type: 'code', scope: 'openid email profile',
        state: p.s, nonce: p.n, code_challenge: crypto.createHash('sha256').update(p.v).digest('base64url'), code_challenge_method: 'S256',
        prompt: 'select_account', access_type: 'online',
    });
    return `${AUTH_URL}?${q.toString()}`;
}
function checkClaims(c, nonce, now = Date.now()) {
    const bad = (why) => new errors_1.AppError(400, 'google_invalid', `Token Google tidak valid (${why}).`);
    if (!c || typeof c !== 'object')
        throw bad('kosong');
    if (!ISSUERS.includes(c.iss))
        throw bad('iss');
    const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
    if (!aud.includes(config_1.config.google.clientId))
        throw bad('aud');
    if (typeof c.exp !== 'number' || c.exp * 1000 < now - 60e3)
        throw bad('kedaluwarsa');
    if (typeof c.nonce !== 'string' || !sec.safeEqual(c.nonce, nonce))
        throw bad('nonce');
    if (typeof c.sub !== 'string' || !/^\d{5,40}$/.test(c.sub))
        throw bad('sub');
    if (c.email_verified !== true && c.email_verified !== 'true')
        throw new errors_1.AppError(400, 'google_unverified', 'Email Google kamu belum terverifikasi.');
    const email = typeof c.email === 'string' ? c.email.trim().toLowerCase() : '';
    if (!email || email.length > 190 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        throw bad('email');
    const rawName = typeof c.name === 'string' ? c.name : '';
    return { sub: c.sub, email, name: cleanName(rawName, email) };
}
function cleanName(raw, email) {
    const n = String(raw || '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80);
    if (n.length >= 2)
        return n;
    const local = email.split('@')[0].replace(/[^A-Za-z0-9]+/g, ' ').trim().slice(0, 80);
    return local.length >= 2 ? local : 'Pengguna';
}
async function pickUsername(email, taken) {
    let base = email.split('@')[0].replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 14);
    if (base.length < 3)
        base = `user${base}`.slice(0, 14);
    for (let i = 0; i < 8; i++) {
        const suffix = i === 0 ? '' : String(crypto.randomInt(10, 10 ** Math.min(2 + i, 6)));
        const cand = `${base.slice(0, 20 - suffix.length)}${suffix}`;
        if (validate_1.RESERVED.has(cand.toLowerCase()))
            continue;
        if (!(await taken(cand)))
            return cand;
    }
    return `u${crypto.randomBytes(8).toString('hex')}`.slice(0, 20);
}
async function exchangeCode(code, verifier, fetchImpl = fetch) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 10000);
    try {
        const res = await fetchImpl(TOKEN_URL, {
            method: 'POST', signal: ac.signal, headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
            body: new URLSearchParams({ code, client_id: config_1.config.google.clientId, client_secret: config_1.config.google.secret, redirect_uri: (0, exports.redirectUri)(), grant_type: 'authorization_code', code_verifier: verifier }).toString(),
        });
        const j = await res.json().catch(() => null);
        if (!res.ok || !j || typeof j.id_token !== 'string')
            throw new errors_1.AppError(502, 'google_failed', 'Gagal menukar kode dengan Google. Coba lagi.');
        const parts = j.id_token.split('.');
        if (parts.length !== 3)
            throw new errors_1.AppError(502, 'google_failed', 'Respons Google tidak valid.');
        return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    }
    catch (e) {
        if (e instanceof errors_1.AppError)
            throw e;
        throw new errors_1.AppError(502, 'google_failed', 'Tidak bisa terhubung ke Google. Coba lagi sebentar lagi.');
    }
    finally {
        clearTimeout(t);
    }
}
