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
exports.looksLikeTotp = exports.looksLikeRecovery = exports.normalizeRecovery = exports.totp = exports.stepOf = exports.generateSecret = exports.DIGITS = exports.STEP_SEC = void 0;
exports.base32Encode = base32Encode;
exports.base32Decode = base32Decode;
exports.hotp = hotp;
exports.verify = verify;
exports.otpauthUri = otpauthUri;
exports.generateRecoveryCodes = generateRecoveryCodes;
const crypto = __importStar(require("crypto"));
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
exports.STEP_SEC = 30;
exports.DIGITS = 6;
function base32Encode(buf) {
    let bits = 0;
    let value = 0;
    let out = '';
    for (const b of buf) {
        value = (value << 8) | b;
        bits += 8;
        while (bits >= 5) {
            out += B32[(value >>> (bits - 5)) & 31];
            bits -= 5;
        }
    }
    if (bits > 0)
        out += B32[(value << (5 - bits)) & 31];
    return out;
}
function base32Decode(s) {
    const clean = String(s).toUpperCase().replace(/[\s=-]/g, '');
    let bits = 0;
    let value = 0;
    const out = [];
    for (const ch of clean) {
        const i = B32.indexOf(ch);
        if (i < 0)
            throw new Error('base32 tidak valid');
        value = (value << 5) | i;
        bits += 5;
        if (bits >= 8) {
            out.push((value >>> (bits - 8)) & 255);
            bits -= 8;
        }
    }
    return Buffer.from(out);
}
const generateSecret = () => base32Encode(crypto.randomBytes(20));
exports.generateSecret = generateSecret;
function hotp(secretB32, counter, digits = exports.DIGITS) {
    const buf = Buffer.alloc(8);
    buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
    buf.writeUInt32BE(counter >>> 0, 4);
    const h = crypto.createHmac('sha1', base32Decode(secretB32)).update(buf).digest();
    const o = h[h.length - 1] & 15;
    const bin = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
    return String(bin % 10 ** digits).padStart(digits, '0');
}
const stepOf = (nowMs) => Math.floor(nowMs / 1000 / exports.STEP_SEC);
exports.stepOf = stepOf;
const totp = (secretB32, nowMs = Date.now()) => hotp(secretB32, (0, exports.stepOf)(nowMs));
exports.totp = totp;
const eq = (a, b) => { const x = Buffer.from(a); const y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); };
function verify(secretB32, code, { nowMs = Date.now(), window = 1, lastStep = null } = {}) {
    const c = String(code).replace(/\s+/g, '');
    if (!/^\d{6}$/.test(c))
        return null;
    const cur = (0, exports.stepOf)(nowMs);
    let hit = null;
    for (let s = cur - window; s <= cur + window; s++) {
        if (eq(hotp(secretB32, s), c) && hit === null && (lastStep === null || s > lastStep))
            hit = s;
    }
    return hit;
}
function otpauthUri({ secret, account, issuer }) {
    const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
    return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${exports.DIGITS}&period=${exports.STEP_SEC}`;
}
const RC = 'abcdefghjkmnpqrstuvwxyz23456789';
function generateRecoveryCodes(n = 10) {
    return Array.from({ length: n }, () => {
        const b = crypto.randomBytes(10);
        const s = Array.from(b, (x) => RC[x % RC.length]).join('');
        return `${s.slice(0, 5)}-${s.slice(5)}`;
    });
}
const normalizeRecovery = (s) => String(s).toLowerCase().replace(/[\s-]/g, '');
exports.normalizeRecovery = normalizeRecovery;
const looksLikeRecovery = (s) => /^[a-z2-9]{10}$/.test((0, exports.normalizeRecovery)(s));
exports.looksLikeRecovery = looksLikeRecovery;
const looksLikeTotp = (s) => /^\d{6}$/.test(String(s).replace(/\s+/g, ''));
exports.looksLikeTotp = looksLikeTotp;
