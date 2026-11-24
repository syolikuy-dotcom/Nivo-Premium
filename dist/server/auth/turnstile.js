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
exports.check = exports.enabled = void 0;
exports.verify = verify;
const config_1 = require("../core/config");
const log = __importStar(require("../core/logger"));
const errors_1 = require("../core/errors");
const URL_VERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const enabled = config_1.config.turnstile.enabled;
exports.enabled = enabled;
async function verify(token, ip) {
    if (typeof token !== 'string' || token.length < 10 || token.length > 2048)
        return false;
    const body = new URLSearchParams({ secret: config_1.config.turnstile.secret, response: token });
    if (ip)
        body.set('remoteip', String(ip));
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    try {
        const res = await fetch(URL_VERIFY, { method: 'POST', body, signal: ctrl.signal, redirect: 'error' });
        const j = (await res.json());
        if (j.success !== true)
            log.warn('turnstile ditolak', { codes: (j['error-codes'] || []).join(','), ip });
        return j.success === true;
    }
    catch (e) {
        log.error('turnstile tidak bisa dihubungi', { msg: e.name === 'AbortError' ? 'timeout' : e.message });
        return false;
    }
    finally {
        clearTimeout(timer);
    }
}
async function require_(token, ip) {
    if (!enabled)
        return;
    if (!(await verify(token, ip)))
        throw new errors_1.AppError(400, 'captcha', 'Verifikasi keamanan gagal atau kedaluwarsa. Selesaikan verifikasi lalu coba lagi.');
}
exports.check = require_;
