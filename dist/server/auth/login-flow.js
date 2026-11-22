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
exports.LOCK_MIN = exports.MAX_FAILS = void 0;
exports.reserveAttempt = reserveAttempt;
exports.refundAttempt = refundAttempt;
exports.recordFailure = recordFailure;
exports.complete = complete;
const db = __importStar(require("../core/db"));
const auth = __importStar(require("./auth"));
const log = __importStar(require("../core/logger"));
const audit_1 = require("../core/audit");
const admin_notice_1 = require("./admin-notice");
const format_1 = require("../../shared/format");
exports.MAX_FAILS = 5;
exports.LOCK_MIN = 15;
async function knownIp(userId, ip) {
    if (!ip)
        return false;
    const r = await db.one("SELECT id FROM audit_log WHERE user_id = ? AND action = 'login' AND ip = ? AND created_at > ? LIMIT 1", [userId, ip.slice(0, 45), new Date(Date.now() - 60 * 864e5)]);
    return Boolean(r);
}
async function reserveAttempt(req, userId) {
    const r = await db.tx(async (t) => {
        const row = await t.one('SELECT failed_logins, locked_until FROM users WHERE id = ? FOR UPDATE', [userId]);
        if (!row)
            return null;
        const locked = (row.locked_until && new Date(row.locked_until) > new Date()) || Number(row.failed_logins) >= exports.MAX_FAILS;
        if (locked)
            return null;
        await t.query('UPDATE users SET failed_logins = failed_logins + 1 WHERE id = ?', [userId]);
        return Number(row.failed_logins) + 1;
    });
    if (r !== null)
        return r;
    return (await knownIp(userId, String(req.ip || ''))) ? 0 : null;
}
async function refundAttempt(userId, n) {
    if (!n)
        return;
    await db.query('UPDATE users SET failed_logins = GREATEST(failed_logins - 1, 0) WHERE id = ?', [userId]);
}
async function recordFailure(req, u, action, n) {
    const lock = n >= exports.MAX_FAILS;
    if (lock)
        await db.query('UPDATE users SET failed_logins = 0, locked_until = ? WHERE id = ?', [new Date(Date.now() + exports.LOCK_MIN * 60e3), u.id]);
    await (0, audit_1.audit)(u.id, lock ? 'login_locked' : action, req);
    log.warn(lock ? 'akun dikunci: terlalu banyak login gagal' : (action === 'twofa_failed' ? 'kode 2FA salah' : 'login gagal'), { user_id: u.id, ip: req.ip, percobaan: n });
    if (u.role === 'admin' && (lock || action === 'twofa_failed')) {
        (0, admin_notice_1.notifyAdmins)(`admin_fail:${u.id}`, lock ? 'Akun admin dikunci (percobaan login gagal)' : 'Kode 2FA admin salah', [`Akun admin @${u.username} ${lock ? `dikunci ${exports.LOCK_MIN} menit setelah ${exports.MAX_FAILS} percobaan gagal berturut-turut.` : 'memasukkan kode 2FA yang salah.'}`, '', `IP      : ${req.ip}`, `Waktu   : ${(0, format_1.dateTime)(Date.now())} WIB`, '', 'Jika ini bukan kamu, segera ganti password dan periksa log audit.'].join('\n'), 30 * 60e3).catch(() => { });
    }
    return lock;
}
async function complete(req, res, u, opts = {}) {
    const ip = String(req.ip || '').slice(0, 45);
    let newIp = false;
    if (u.role === 'admin') {
        const [any, seen] = await Promise.all([
            db.one("SELECT id FROM audit_log WHERE user_id = ? AND action = 'login' LIMIT 1", [u.id]),
            db.one("SELECT id FROM audit_log WHERE user_id = ? AND action = 'login' AND ip = ? AND created_at > ? LIMIT 1", [u.id, ip, new Date(Date.now() - 60 * 864e5)]),
        ]);
        newIp = Boolean(any) && !seen;
    }
    await db.query('UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = ? WHERE id = ?', [new Date(), u.id]);
    await auth.startSession(req, res, u.id, u.role);
    await (0, audit_1.audit)(u.id, 'login', req, opts.twofa ? { twofa: true } : undefined);
    if (newIp) {
        (0, admin_notice_1.notifyAdmins)(`admin_newip:${u.id}:${ip}`, 'Login admin dari IP baru', [`Akun admin @${u.username} masuk dari IP yang belum pernah dipakai dalam 60 hari terakhir.`, '', `IP      : ${ip}`, `Waktu   : ${(0, format_1.dateTime)(Date.now())} WIB`, `2FA     : ${opts.twofa ? 'ya' : 'tidak'}`, '', 'Jika ini bukan kamu, segera ganti password, aktifkan 2FA, dan isi ADMIN_ALLOWED_IPS.'].join('\n'), 6 * 3600e3).catch(() => { });
    }
    return { redirect: u.role === 'admin' ? '/admin' : '/dashboard' };
}
