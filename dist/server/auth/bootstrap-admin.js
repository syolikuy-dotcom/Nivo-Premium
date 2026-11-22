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
exports.ensureAdmin = ensureAdmin;
const crypto = __importStar(require("crypto"));
const db = __importStar(require("../core/db"));
const config_1 = require("../core/config");
const sec = __importStar(require("./security"));
const log = __importStar(require("../core/logger"));
const validate_1 = require("../http/validate");
const errors_1 = require("../core/errors");
function defaultEmail() {
    const h = config_1.config.appHost.replace(/:\d+$/, '');
    return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(h) && !/^\d+(\.\d+){3}$/.test(h) ? `admin@${h}` : 'admin@nivo.local';
}
async function ensureAdmin() {
    let username;
    let email;
    try {
        username = validate_1.fields.username.parse(config_1.config.admin.username || 'admin');
        email = validate_1.fields.email.parse(config_1.config.admin.email || defaultEmail());
    }
    catch (e) {
        log.warn('ADMIN_USERNAME / ADMIN_EMAIL tidak valid, pembuatan admin otomatis dilewati', { alasan: e.issues && e.issues[0] && e.issues[0].message });
        return;
    }
    const ex = await db.one('SELECT id, role, status FROM users WHERE username = ? OR email = ? LIMIT 1', [username, email]);
    if (ex) {
        if (ex.role === 'admin')
            log.info('Admin siap', { username, email, status: ex.status });
        else
            log.warn('Username/email admin sudah dipakai akun biasa, tidak dipromosikan otomatis. Ganti ADMIN_USERNAME/ADMIN_EMAIL di .env atau jalankan scripts/create-admin.js', { username, email });
        return;
    }
    let password = config_1.config.admin.password;
    let generated = false;
    if (password && !validate_1.fields.password.safeParse(password).success) {
        log.warn('ADMIN_PASSWORD tidak memenuhi aturan (min 8 karakter, huruf besar, huruf kecil, angka, bukan password umum): dibuat password acak');
        password = '';
    }
    if (!password) {
        password = `${crypto.randomBytes(12).toString('base64url')}aA1`;
        generated = true;
    }
    try {
        await db.query("INSERT INTO users (username, email, name, password_hash, role) VALUES (?,?,?,?, 'admin')", [username, email, 'Administrator', await sec.hashPassword(password)]);
    }
    catch (e) {
        if ((0, errors_1.isDup)(e))
            return;
        throw e;
    }
    log.info('Admin dibuat otomatis dan tersimpan di database', { username, email });
    if (generated) {
        console.log(`\n  ┌─ AKUN ADMIN (ditampilkan SEKALI) ─────────────────────────\n  │ Username : ${username}\n  │ Email    : ${email}\n  │ Password : ${password}\n  │ Simpan sekarang lalu ganti di menu Akun saya.\n  └──────────────────────────────────────────────────────────\n`);
    }
    else {
        log.info('Password admin sesuai ADMIN_PASSWORD di .env (hanya dipakai saat akun dibuat; mengubahnya di .env tidak mengganti password yang sudah tersimpan)');
    }
}
