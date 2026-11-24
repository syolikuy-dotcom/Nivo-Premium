import * as nodemailer from 'nodemailer';
import { config } from '../core/config';
import * as log from '../core/logger';
import { once } from '../core/singleton';
import { rupiah, dateTime } from '../../shared/format';

type Transport = ReturnType<typeof nodemailer.createTransport>;
const mail = once('mailer.transport', () => ({ tp: null as Transport | null }));
const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s: unknown): string => String(s).replace(/[&<>"']/g, (c) => ESC[c]);
function transport(): Transport | null {
  if (!config.smtp.enabled) return null;
  if (!mail.tp) {
    const options = {
      host: config.smtp.host, port: config.smtp.port, secure: config.smtp.secure,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
      connectionTimeout: 10000, greetTimeout: 10000, socketTimeout: 15000,
    };
    mail.tp = nodemailer.createTransport(options as Parameters<typeof nodemailer.createTransport>[0]);
  }
  return mail.tp;
}
async function sendResetEmail({ to, name, link, siteName }: { to: string; name: string; link: string; siteName: string }): Promise<boolean> {
  const t = transport();
  if (!t) { log.warn('SMTP belum dikonfigurasi: email reset password tidak dikirim'); return false; }
  await t.sendMail({
    from: config.smtp.from, to,
    subject: `Reset password ${siteName}`,
    text: `Halo ${name},\n\nKlik tautan berikut untuk membuat password baru (berlaku 15 menit):\n${link}\n\nJika bukan kamu yang meminta, abaikan email ini.`,
    html: `<p>Halo ${esc(name)},</p><p>Klik tombol berikut untuk membuat password baru (berlaku 15 menit):</p><p><a href="${esc(link)}">Buat password baru</a></p><p>Jika bukan kamu yang meminta, abaikan email ini.</p>`,
  });
  return true;
}

const hdr = (v: unknown, n = 180): string => String(v).replace(/[\r\n]+/g, ' ').slice(0, n);
const smtpEnabled = (): boolean => config.smtp.enabled;
async function send({ to, subject, text, html }: { to: string | string[]; subject: string; text: string; html: string }): Promise<boolean> {
  const t = transport();
  if (!t) return false;
  await t.sendMail({ from: config.smtp.from, to, subject: hdr(subject), text, html });
  return true;
}

export interface OrderMail { to: string; name: string; siteName: string; orderNo: string; product: string; qty: number; total: number; method: 'qris' | 'balance'; completedAt: unknown }
async function sendOrderConfirmation(m: OrderMail): Promise<boolean> {
  const link = `${config.appUrl}/orders/${m.orderNo}`;
  const via = m.method === 'qris' ? 'QRIS' : 'Saldo akun';
  const text = [
    `Halo ${hdr(m.name, 80)},`, '',
    `Pesananmu di ${hdr(m.siteName, 60)} sudah selesai.`, '',
    `No. pesanan : ${m.orderNo}`, `Produk      : ${hdr(m.product, 160)} x ${m.qty}`, `Total       : ${rupiah(m.total)} (${via})`, `Selesai     : ${dateTime(m.completedAt)} WIB`, '',
    'Buka halaman pesanan untuk melihat dan mengunduh akunmu (.txt):', link, '',
    'Demi keamanan, data akun tidak dikirim lewat email. Kamu perlu masuk ke akunmu untuk melihatnya.',
  ].join('\n');
  const row = (k: string, v: string) => `<tr><td style="padding:4px 12px 4px 0;color:#666">${esc(k)}</td><td style="padding:4px 0"><b>${esc(v)}</b></td></tr>`;
  const html = `<p>Halo ${esc(m.name)},</p><p>Pesananmu di ${esc(m.siteName)} sudah selesai.</p>`
    + `<table style="border-collapse:collapse;font-size:14px">${row('No. pesanan', m.orderNo)}${row('Produk', `${m.product} × ${m.qty}`)}${row('Total', `${rupiah(m.total)} (${via})`)}${row('Selesai', `${dateTime(m.completedAt)} WIB`)}</table>`
    + `<p><a href="${esc(link)}">Lihat &amp; unduh akun (.txt)</a></p>`
    + '<p style="color:#666;font-size:13px">Demi keamanan, data akun tidak dikirim lewat email. Kamu perlu masuk ke akunmu untuk melihatnya.</p>';
  return send({ to: m.to, subject: `Pesanan ${m.orderNo} selesai`, text, html });
}

async function sendAlert({ to, subject, text }: { to: string[]; subject: string; text: string }): Promise<boolean> {
  if (!to.length) return false;
  const html = `<pre style="font:14px/1.5 ui-monospace,Menlo,Consolas,monospace;white-space:pre-wrap">${esc(text)}</pre>`;
  return send({ to, subject: `[${hdr(config.appHost, 60)}] ${hdr(subject, 120)}`, text, html });
}

export { sendResetEmail, sendOrderConfirmation, sendAlert, smtpEnabled };
