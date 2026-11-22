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
exports.signIn = signIn;
exports.link = link;
exports.begin = begin;
exports.finish = finish;
const cookie = __importStar(require("cookie"));
const config_1 = require("../core/config");
const net_1 = require("../http/net");
const log = __importStar(require("../core/logger"));
const errors_1 = require("../core/errors");
const db = __importStar(require("../core/db"));
const sec = __importStar(require("./security"));
const auth = __importStar(require("./auth"));
const google = __importStar(require("./google"));
const login_flow_1 = require("./login-flow");
const audit_1 = require("../core/audit");
const errors_2 = require("../core/errors");
const LOGIN = '/login';
async function signIn(req, res, p, st) {
    const existing = async () => db.one('SELECT id, username, role, status FROM users WHERE google_sub = ?', [p.sub]);
    const enter = async (u) => {
        if (u.status !== 'active')
            return `${LOGIN}?ge=disabled`;
        if (u.role === 'admin')
            return `${LOGIN}?ge=admin`;
        const out = await (0, login_flow_1.complete)(req, res, u);
        await (0, audit_1.audit)(u.id, 'login_google', req);
        return st.nx || out.redirect;
    };
    const linked = await existing();
    if (linked)
        return enter(linked);
    if (await db.one('SELECT id FROM users WHERE email = ?', [p.email]))
        return `${LOGIN}?ge=exists`;
    const hash = await sec.hashPassword(`${sec.randomToken(32)}Aa1`);
    for (let i = 0; i < 5; i++) {
        const username = await google.pickUsername(p.email, async (u) => Boolean(await db.one('SELECT id FROM users WHERE username = ?', [u])));
        try {
            const out = await db.query('INSERT INTO users (username, email, name, password_hash, google_sub, last_login_at) VALUES (?,?,?,?,?,?)', [username, p.email, p.name, hash, p.sub, new Date()]);
            const id = Number(out.insertId);
            await auth.startSession(req, res, id);
            await (0, audit_1.audit)(id, 'register_google', req);
            return st.nx || '/dashboard';
        }
        catch (e) {
            if ((0, errors_2.isDup)(e, 'uq_users_email'))
                return `${LOGIN}?ge=exists`;
            if ((0, errors_2.isDup)(e, 'uq_users_google_sub')) {
                const again = await existing();
                if (again)
                    return enter(again);
            }
            if ((0, errors_2.isDup)(e))
                continue;
            throw e;
        }
    }
    return `${LOGIN}?ge=failed`;
}
async function link(req, userId, p) {
    const owner = await db.one('SELECT id FROM users WHERE google_sub = ?', [p.sub]);
    if (owner)
        return Number(owner.id) === userId ? '/account?google=linked' : '/account?google=taken';
    try {
        const r = await db.query('UPDATE users SET google_sub = ? WHERE id = ? AND google_sub IS NULL', [p.sub, userId]);
        if (r.affectedRows !== 1)
            return '/account?google=already';
    }
    catch (e) {
        if ((0, errors_2.isDup)(e))
            return '/account?google=taken';
        throw e;
    }
    await (0, audit_1.audit)(userId, 'google_link', req);
    return '/account?google=linked';
}
const addCookie = (res, line) => {
    const prev = res.getHeader('Set-Cookie');
    res.setHeader('Set-Cookie', prev === undefined ? [line] : [].concat(prev, line));
};
const stateCookie = (req, value, maxAge) => {
    const secure = (0, net_1.isSecure)(req);
    return cookie.serialize(google.cookieName(secure), value, { path: '/', httpOnly: true, sameSite: 'lax', secure, maxAge });
};
const ERR = { google_unverified: 'unverified', google_invalid: 'failed', google_failed: 'failed' };
function begin(req, res, q) {
    if (!config_1.config.google.enabled)
        return '/login?ge=off';
    const link = q.get('mode') === 'link';
    if (link && !req.user)
        return '/login?next=%2Faccount';
    if (!link && req.user)
        return '/dashboard';
    const st = google.newState(link ? 'link' : 'login', req.user ? req.user.id : 0, q.get('next') || '');
    addCookie(res, stateCookie(req, google.sealState(st), Math.floor(google.STATE_TTL_MS / 1000)));
    return google.authUrl(st);
}
async function finish(req, res, q) {
    if (!config_1.config.google.enabled)
        return '/login?ge=off';
    const st = google.openState(cookie.parse(req.headers.cookie || '')[google.cookieName((0, net_1.isSecure)(req))]);
    if (!st)
        return '/login?ge=expired';
    addCookie(res, stateCookie(req, '', 0));
    const back = (code) => (st.m === 'link' ? `/account?google=${code}` : `/login?ge=${code}`);
    if (q.get('error'))
        return back('cancelled');
    const code = q.get('code') || '';
    const state = q.get('state') || '';
    if (!code || code.length > 2048 || !sec.safeEqual(state, st.s))
        return back('failed');
    try {
        const profile = google.checkClaims(await google.exchangeCode(code, st.v), st.n);
        if (st.m === 'link') {
            if (!req.user || req.user.id !== st.u)
                return '/login?next=%2Faccount';
            return await link(req, req.user.id, profile);
        }
        if (req.user)
            return '/dashboard';
        return await signIn(req, res, profile, st);
    }
    catch (e) {
        if (e instanceof errors_1.AppError) {
            log.warn('login google gagal', { code: e.code, msg: e.message });
            return back(ERR[e.code] || 'failed');
        }
        log.error('login google error', { msg: e && e.message });
        return back('failed');
    }
}
