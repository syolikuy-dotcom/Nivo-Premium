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
exports.publicUser = exports.endAllSessions = exports.endOtherSessions = void 0;
exports.attach = attach;
exports.startSession = startSession;
exports.endSession = endSession;
exports.requireAuth = requireAuth;
exports.requireAdmin = requireAdmin;
exports.csrfGuard = csrfGuard;
const cookie = __importStar(require("cookie"));
const config_1 = require("../core/config");
const net_1 = require("../http/net");
const db = __importStar(require("../core/db"));
const sec = __importStar(require("./security"));
const errors_1 = require("../core/errors");
const names = (req) => { const p = (0, net_1.isSecure)(req) ? '__Host-' : ''; return { SID: `${p}nivo_sid`, CSRF: `${p}nivo_csrf`, secure: Boolean(p) }; };
const SESSION_DAYS = 14;
const ADMIN_SESSION_MS = 8 * 3600e3;
const sessionMs = (role) => (role === 'admin' ? ADMIN_SESSION_MS : SESSION_DAYS * 864e5);
const SESSION_RE = /^[A-Za-z0-9_-]{43}$/;
function setCookie(req, res, name, value, maxAgeSec) {
    const line = cookie.serialize(name, value, { path: '/', httpOnly: true, sameSite: 'lax', secure: names(req).secure, maxAge: maxAgeSec });
    const prev = res.getHeader('Set-Cookie');
    res.setHeader('Set-Cookie', prev === undefined ? [line] : [].concat(prev, line));
}
const publicUser = (r) => ({ id: r.id, username: r.username, email: r.email, name: r.name, role: r.role, balance: Number(r.balance), twofa: Boolean(r.totp_enabled) });
exports.publicUser = publicUser;
async function attach(req, res) {
    if (req.nivoAttached)
        return;
    req.nivoAttached = true;
    const { SID, CSRF } = names(req);
    const c = cookie.parse(req.headers.cookie || '');
    req.cookieCsrfValid = sec.csrfValid(c[CSRF]);
    req.csrfToken = req.cookieCsrfValid ? String(c[CSRF]) : sec.csrfCreate();
    if (!req.cookieCsrfValid)
        setCookie(req, res, CSRF, req.csrfToken, 60 * 60 * 24 * 30);
    req.user = null;
    const sid = c[SID];
    if (!sid || !SESSION_RE.test(sid))
        return;
    const now = new Date();
    const row = await db.one(`SELECT s.id AS sid, s.last_seen_at, u.id, u.username, u.email, u.name, u.role, u.balance, u.status, u.totp_enabled
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?`, [sec.sha256(sid), now]);
    if (!row || row.status !== 'active')
        return;
    req.user = publicUser(row);
    req.sessionId = row.sid;
    if (now.getTime() - new Date(row.last_seen_at).getTime() > 5 * 60e3) {
        await db.query('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?', [now, new Date(now.getTime() + sessionMs(row.role)), row.sid]);
    }
}
async function startSession(req, res, userId, role = 'user') {
    const token = sec.randomToken(32);
    const now = new Date();
    await db.query('INSERT INTO sessions (user_id, token_hash, ip, ua, expires_at) VALUES (?,?,?,?,?)', [userId, sec.sha256(token), String(req.ip || '').slice(0, 45), String(req.headers['user-agent'] || '').slice(0, 255), new Date(now.getTime() + sessionMs(role))]);
    await db.query('DELETE FROM sessions WHERE user_id = ? AND id NOT IN (SELECT id FROM (SELECT id FROM sessions WHERE user_id = ? ORDER BY id DESC LIMIT 10) x)', [userId, userId]);
    setCookie(req, res, names(req).SID, token, Math.floor(sessionMs(role) / 1000));
    const t = sec.csrfCreate();
    req.csrfToken = t;
    setCookie(req, res, names(req).CSRF, t, 60 * 60 * 24 * 30);
}
async function endSession(req, res) {
    if (req.sessionId)
        await db.query('DELETE FROM sessions WHERE id = ?', [req.sessionId]);
    setCookie(req, res, names(req).SID, '', 0);
}
const endOtherSessions = (userId, keepId) => db.query('DELETE FROM sessions WHERE user_id = ? AND id <> ?', [userId, keepId || 0]);
exports.endOtherSessions = endOtherSessions;
const endAllSessions = (userId) => db.query('DELETE FROM sessions WHERE user_id = ?', [userId]);
exports.endAllSessions = endAllSessions;
function requireAuth(req) {
    if (!req.user)
        throw new errors_1.AppError(401, 'unauthorized', 'Masuk dulu untuk melanjutkan.');
}
function requireAdmin(req) {
    if (!(0, net_1.adminIpOk)(req))
        throw new errors_1.AppError(404, 'not_found', 'Endpoint tidak ditemukan.');
    if (!req.user)
        throw new errors_1.AppError(401, 'unauthorized', 'Masuk dulu untuk melanjutkan.');
    if (req.user.role !== 'admin')
        throw new errors_1.AppError(403, 'forbidden', 'Akses ditolak.');
    if (config_1.config.admin.require2fa && !req.user.twofa)
        throw new errors_1.AppError(403, 'twofa_required', 'Aktifkan autentikasi dua langkah (2FA) di menu Akun saya untuk membuka panel admin.');
}
function csrfGuard(req) {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method || ''))
        return;
    const deny = () => new errors_1.AppError(403, 'csrf', 'Sesi tidak valid. Muat ulang halaman lalu coba lagi.');
    const origin = req.headers.origin;
    if (origin) {
        let host = '';
        try {
            host = new URL(origin).host;
        }
        catch {
            throw deny();
        }
        if (!(0, net_1.hostAllowed)(host, req) && !(!config_1.config.isProd && /^localhost(:\d+)?$/.test(host)))
            throw deny();
    }
    else {
        const site = req.headers['sec-fetch-site'];
        if (site && !['same-origin', 'none'].includes(String(site)))
            throw deny();
    }
    const hdr = req.headers['x-csrf-token'];
    if (typeof hdr !== 'string' || !req.cookieCsrfValid || !sec.safeEqual(hdr, req.csrfToken))
        throw deny();
}
