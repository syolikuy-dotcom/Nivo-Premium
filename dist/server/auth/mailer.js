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
exports.smtpEnabled = void 0;
exports.sendResetEmail = sendResetEmail;
exports.sendOrderConfirmation = sendOrderConfirmation;
exports.sendAlert = sendAlert;
const nodemailer = __importStar(require("nodemailer"));
const config_1 = require("../core/config");
const log = __importStar(require("../core/logger"));
const singleton_1 = require("../core/singleton");
const format_1 = require("../../shared/format");
const mail = (0, singleton_1.once)('mailer.transport', () => ({ tp: null }));
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);
function transport() {
    if (!config_1.config.smtp.enabled)
        return null;
    if (!mail.tp) {
        const options = {
            host: config_1.config.smtp.host, port: config_1.config.smtp.port, secure: config_1.config.smtp.secure,
            auth: config_1.config.smtp.user ? { user: config_1.config.smtp.user, pass: config_1.config.smtp.pass } : undefined,
            connectionTimeout: 10000, greetTimeout: 10000, socketTimeout: 15000,
        };
        mail.tp = nodemailer.createTransport(options);
    }
    return mail.tp;
}
async function sendResetEmail({ to, name, link, siteName }) {
    const t = transport();
    if (!t) {
        log.warn('SMTP belum dikonfigurasi: email reset password tidak dikirim');
        return false;
    }
    await t.sendMail({
        from: config_1.config.smtp.from, to,
        subject: `Reset password ${siteName}`,
        text: `Halo ${name},\n\nKlik tautan berikut untuk membuat password baru (berlaku 15 menit):\n${link}\n\nJika bukan kamu yang meminta, abaikan email ini.`,
        html: `<p>Halo ${esc(name)},</p><p>Klik tombol berikut untuk membuat password baru (berlaku 15 menit):</p><p><a href="${esc(link)}">Buat password baru</a></p><p>Jika bukan kamu yang meminta, abaikan email ini.</p>`,
    });
    return true;
}
const hdr = (v, n = 180) => String(v).replace(/[\r\n]+/g, ' ').slice(0, n);
const smtpEnabled = () => config_1.config.smtp.enabled;
exports.smtpEnabled = smtpEnabled;
async function send({ to, subject, text, html }) {
    const t = transport();
    if (!t)
        return false;
    await t.sendMail({ from: config_1.config.smtp.from, to, subject: hdr(subject), text, html });
    return true;
}
async function sendOrderConfirmation(m) {
    const link = `${config_1.config.appUrl}/orders/${m.orderNo}`;
    const via = m.method === 'qris' ? 'QRIS' : 'Saldo akun';
    const text = [
        `Halo ${hdr(m.name, 80)},`, '',
        `Pesananmu di ${hdr(m.siteName, 60)} sudah selesai.`, '',
        `No. pesanan : ${m.orderNo}`, `Produk      : ${hdr(m.product, 160)} x ${m.qty}`, `Total       : ${(0, format_1.rupiah)(m.total)} (${via})`, `Selesai     : ${(0, format_1.dateTime)(m.completedAt)} WIB`, '',
        'Buka halaman pesanan untuk melihat dan mengunduh akunmu (.txt):', link, '',
        'Demi keamanan, data akun tidak dikirim lewat email. Kamu perlu masuk ke akunmu untuk melihatnya.',
    ].join('\n');
    const row = (k, v) => `<tr><td style="padding:4px 12px 4px 0;color:#666">${esc(k)}</td><td style="padding:4px 0"><b>${esc(v)}</b></td></tr>`;
    const html = `<p>Halo ${esc(m.name)},</p><p>Pesananmu di ${esc(m.siteName)} sudah selesai.</p>`
        + `<table style="border-collapse:collapse;font-size:14px">${row('No. pesanan', m.orderNo)}${row('Produk', `${m.product} × ${m.qty}`)}${row('Total', `${(0, format_1.rupiah)(m.total)} (${via})`)}${row('Selesai', `${(0, format_1.dateTime)(m.completedAt)} WIB`)}</table>`
        + `<p><a href="${esc(link)}">Lihat &amp; unduh akun (.txt)</a></p>`
        + '<p style="color:#666;font-size:13px">Demi keamanan, data akun tidak dikirim lewat email. Kamu perlu masuk ke akunmu untuk melihatnya.</p>';
    return send({ to: m.to, subject: `Pesanan ${m.orderNo} selesai`, text, html });
}
async function sendAlert({ to, subject, text }) {
    if (!to.length)
        return false;
    const html = `<pre style="font:14px/1.5 ui-monospace,Menlo,Consolas,monospace;white-space:pre-wrap">${esc(text)}</pre>`;
    return send({ to, subject: `[${hdr(config_1.config.appHost, 60)}] ${hdr(subject, 120)}`, text, html });
}
