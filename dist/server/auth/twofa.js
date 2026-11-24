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
exports.view = view;
exports.beginSetup = beginSetup;
exports.enable = enable;
exports.checkCode = checkCode;
exports.stepUp = stepUp;
exports.disable = disable;
exports.regenerateRecovery = regenerateRecovery;
const QRCode = __importStar(require("qrcode"));
const db = __importStar(require("../core/db"));
const sec = __importStar(require("./security"));
const totp = __importStar(require("./totp"));
const config_1 = require("../core/config");
const errors_1 = require("../core/errors");
const hashRecovery = (code) => sec.hmacHex('recovery', totp.normalizeRecovery(code));
const adminOnly = (u) => { if (u.role !== 'admin')
    throw new errors_1.AppError(403, 'forbidden', 'Akses ditolak.'); };
const BAD_CODE = 'Kode salah atau kedaluwarsa. Pastikan jam ponsel akurat, atau pakai kode pemulihan.';
async function view(user) {
    if (user.role !== 'admin')
        return { available: false, enabled: false, recoveryLeft: 0, required: false };
    let left = 0;
    if (user.twofa)
        left = Number((await db.one('SELECT COUNT(*) AS n FROM recovery_codes WHERE user_id = ? AND used_at IS NULL', [user.id])).n);
    return { available: true, enabled: user.twofa, recoveryLeft: left, required: config_1.config.admin.require2fa };
}
async function beginSetup(user, siteName) {
    adminOnly(user);
    if (user.twofa)
        throw new errors_1.AppError(409, 'already_enabled', '2FA sudah aktif. Nonaktifkan dulu bila ingin memindahkan ke perangkat lain.');
    const secret = totp.generateSecret();
    await db.query('UPDATE users SET totp_secret_enc = ?, totp_enabled = 0, totp_last_step = NULL WHERE id = ? AND totp_enabled = 0', [sec.encrypt(secret), user.id]);
    const uri = totp.otpauthUri({ secret, account: user.email, issuer: siteName });
    return { secret, uri, qr: await QRCode.toDataURL(uri, { errorCorrectionLevel: 'M', margin: 1, width: 240 }) };
}
async function issueRecovery(t, userId) {
    const codes = totp.generateRecoveryCodes();
    await t.query('DELETE FROM recovery_codes WHERE user_id = ?', [userId]);
    for (const c of codes)
        await t.query('INSERT INTO recovery_codes (user_id, code_hash) VALUES (?, ?)', [userId, hashRecovery(c)]);
    return codes;
}
async function enable(user, code) {
    adminOnly(user);
    const row = await db.one('SELECT totp_secret_enc, totp_enabled FROM users WHERE id = ?', [user.id]);
    if (!row || row.totp_enabled)
        throw new errors_1.AppError(409, 'already_enabled', '2FA sudah aktif.');
    const secret = sec.decrypt(row.totp_secret_enc);
    if (!secret)
        throw new errors_1.AppError(409, 'no_setup', 'Mulai dari awal: klik “Aktifkan 2FA” lagi.');
    const step = totp.verify(secret, code);
    if (step === null)
        throw new errors_1.AppError(400, 'bad_code', BAD_CODE);
    return db.tx(async (t) => {
        const r = await t.query('UPDATE users SET totp_enabled = 1, totp_last_step = ? WHERE id = ? AND totp_enabled = 0', [step, user.id]);
        if (r.affectedRows !== 1)
            throw new errors_1.AppError(409, 'already_enabled', '2FA sudah aktif.');
        return issueRecovery(t, user.id);
    });
}
async function checkCode(userId, input) {
    const row = await db.one('SELECT totp_secret_enc, totp_enabled, totp_last_step FROM users WHERE id = ?', [userId]);
    if (!row || !row.totp_enabled)
        return false;
    if (totp.looksLikeTotp(input)) {
        const secret = sec.decrypt(row.totp_secret_enc);
        if (!secret)
            return false;
        const step = totp.verify(secret, input, { lastStep: row.totp_last_step == null ? null : Number(row.totp_last_step) });
        if (step === null)
            return false;
        const r = await db.query('UPDATE users SET totp_last_step = ? WHERE id = ? AND (totp_last_step IS NULL OR totp_last_step < ?)', [step, userId, step]);
        return r.affectedRows === 1;
    }
    if (totp.looksLikeRecovery(input)) {
        const r = await db.query('UPDATE recovery_codes SET used_at = ? WHERE user_id = ? AND code_hash = ? AND used_at IS NULL', [new Date(), userId, hashRecovery(input)]);
        return r.affectedRows === 1;
    }
    return false;
}
async function confirmSensitive(user, password, code) {
    adminOnly(user);
    const u = await db.one('SELECT password_hash FROM users WHERE id = ?', [user.id]);
    if (!u || !(await sec.verifyPassword(password, u.password_hash)))
        throw new errors_1.AppError(400, 'bad_password', 'Password salah.');
    if (!(await checkCode(user.id, code)))
        throw new errors_1.AppError(400, 'bad_code', BAD_CODE);
}
async function stepUp(user, password, code) {
    const u = await db.one('SELECT password_hash FROM users WHERE id = ?', [user.id]);
    if (!u || !(await sec.verifyPassword(password, u.password_hash)))
        throw new errors_1.AppError(400, 'bad_password', 'Password salah.');
    if (user.twofa && !(code && (await checkCode(user.id, code))))
        throw new errors_1.AppError(400, 'bad_code', BAD_CODE);
}
async function disable(user, password, code) {
    if (!user.twofa)
        throw new errors_1.AppError(409, 'not_enabled', '2FA belum aktif.');
    await confirmSensitive(user, password, code);
    await db.tx(async (t) => {
        await t.query('UPDATE users SET totp_enabled = 0, totp_secret_enc = NULL, totp_last_step = NULL WHERE id = ?', [user.id]);
        await t.query('DELETE FROM recovery_codes WHERE user_id = ?', [user.id]);
    });
}
async function regenerateRecovery(user, password, code) {
    if (!user.twofa)
        throw new errors_1.AppError(409, 'not_enabled', '2FA belum aktif.');
    await confirmSensitive(user, password, code);
    return db.tx((t) => issueRecovery(t, user.id));
}
