"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.statusMeta = exports.rupiah = void 0;
exports.dateTime = dateTime;
exports.dateLong = dateLong;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const MONL = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const p2 = (n) => String(n).padStart(2, '0');
const rupiah = (n) => 'Rp ' + new Intl.NumberFormat('id-ID').format(Math.round(Number(n) || 0));
exports.rupiah = rupiah;
function wib(v) { const d = new Date(v); return Number.isNaN(d.getTime()) ? null : new Date(d.getTime() + 7 * 3600e3); }
function dateTime(v) { const w = wib(v); return w ? `${w.getUTCDate()} ${MON[w.getUTCMonth()]} ${w.getUTCFullYear()}, ${p2(w.getUTCHours())}.${p2(w.getUTCMinutes())}` : '-'; }
function dateLong(v) { const w = wib(v); return w ? `${w.getUTCDate()} ${MONL[w.getUTCMonth()]} ${w.getUTCFullYear()}` : '-'; }
const STATUS = {
    pending: ['Menunggu bayar', 'b-warn'], paid: ['Dibayar', 'b-info'], processing: ['Diproses', 'b-info'], success: ['Selesai', 'b-ok'],
    failed: ['Gagal', 'b-bad'], canceled: ['Dibatalkan', 'b-mute'], expired: ['Kedaluwarsa', 'b-mute'],
    pending_verify: ['Menunggu verifikasi', 'b-warn'], review: ['Dicek admin', 'b-warn'],
};
const statusMeta = (s) => STATUS[s] || [String(s), 'b-mute'];
exports.statusMeta = statusMeta;
