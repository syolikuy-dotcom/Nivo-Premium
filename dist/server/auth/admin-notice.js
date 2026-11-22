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
exports.recipients = recipients;
exports.deliver = deliver;
exports.notifyAdmins = notifyAdmins;
const db = __importStar(require("../core/db"));
const settings = __importStar(require("../core/settings"));
const log = __importStar(require("../core/logger"));
const mailer = __importStar(require("./mailer"));
const singleton_1 = require("../core/singleton");
const S = (0, singleton_1.once)('adminNotice.cooldown', () => ({}));
async function recipients() {
    const s = await settings.get();
    if (s.alert_email)
        return [s.alert_email];
    const rows = await db.query("SELECT email FROM users WHERE role = 'admin' AND status = 'active' ORDER BY id LIMIT 10");
    return rows.map((r) => r.email);
}
async function deliver(subject, body, level = 'warn') {
    log[level](`ALERT: ${subject}`, { detail: body.split('\n').filter(Boolean)[0] });
    if (!mailer.smtpEnabled())
        return 'logged';
    try {
        const to = await recipients();
        if (!to.length)
            return 'logged';
        return (await mailer.sendAlert({ to, subject, text: body })) ? 'sent' : 'logged';
    }
    catch (e) {
        log.error('kirim email alert gagal', { subject, msg: e.message });
        return 'failed';
    }
}
async function notifyAdmins(key, subject, body, cooldownMs = 10 * 60e3) {
    const now = Date.now();
    if (now - (S[key] || 0) < cooldownMs)
        return;
    S[key] = now;
    await deliver(subject, body).catch(() => { });
}
