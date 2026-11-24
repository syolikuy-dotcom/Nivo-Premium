"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.accountsFilename = void 0;
exports.buildAccountsTxt = buildAccountsTxt;
const format_1 = require("../../shared/format");
const flat = (v, n = 400) => String(v ?? '').replace(/[\r\n]+/g, ' ').slice(0, n);
const RULE = '-'.repeat(44);
function buildAccountsTxt(i) {
    const L = [
        flat(i.siteName, 80), RULE,
        `No. pesanan : ${flat(i.orderNo, 24)}`, `Produk      : ${flat(i.product, 160)}`, `Jumlah      : ${i.qty}`, `Selesai     : ${(0, format_1.dateTime)(i.completedAt)} WIB`, RULE, '',
    ];
    i.accounts.forEach((a, n) => { L.push(`Akun ${n + 1}`, `  Username : ${flat(a.username)}`, `  Password : ${flat(a.password)}`, ''); });
    L.push(RULE, 'Simpan berkas ini baik-baik dan jangan bagikan ke siapa pun.', 'Kamu juga bisa membuka data ini lagi dari halaman pesanan setelah masuk.');
    return `${L.join('\r\n')}\r\n`;
}
const accountsFilename = (orderNo) => `${orderNo}.txt`;
exports.accountsFilename = accountsFilename;
