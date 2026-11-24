"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.googleAccountMessage = exports.googleLoginMessage = exports.googleUrl = exports.GOOGLE_START = void 0;
exports.GOOGLE_START = '/api/auth/google/start';
const googleUrl = (mode = 'login', next = '') => {
    const q = [];
    if (mode === 'link')
        q.push('mode=link');
    if (next)
        q.push(`next=${encodeURIComponent(next)}`);
    return q.length ? `${exports.GOOGLE_START}?${q.join('&')}` : exports.GOOGLE_START;
};
exports.googleUrl = googleUrl;
const LOGIN_MSG = {
    exists: 'Email ini sudah terdaftar dengan password. Masuk dengan username/email dan password, lalu hubungkan Google dari halaman Akun.',
    disabled: 'Akun ini dinonaktifkan. Hubungi admin bila ini keliru.',
    admin: 'Akun admin hanya bisa masuk dengan username dan password.',
    cancelled: 'Login dengan Google dibatalkan.',
    failed: 'Login dengan Google gagal. Coba lagi sebentar lagi.',
    expired: 'Sesi login Google sudah kedaluwarsa. Coba lagi.',
    unverified: 'Email Google kamu belum terverifikasi.',
    off: 'Login dengan Google belum diaktifkan.',
};
const googleLoginMessage = (code) => LOGIN_MSG[code] || '';
exports.googleLoginMessage = googleLoginMessage;
const ACCOUNT_MSG = {
    linked: { ok: true, t: 'Akun Google berhasil dihubungkan. Sekarang kamu bisa masuk dengan Google.' },
    already: { ok: false, t: 'Akunmu sudah terhubung dengan Google.' },
    taken: { ok: false, t: 'Akun Google itu sudah dipakai akun lain.' },
    cancelled: { ok: false, t: 'Penghubungan Google dibatalkan.' },
    failed: { ok: false, t: 'Gagal menghubungkan Google. Coba lagi sebentar lagi.' },
    unverified: { ok: false, t: 'Email Google kamu belum terverifikasi.' },
    expired: { ok: false, t: 'Sesi penghubungan kedaluwarsa. Coba lagi.' },
};
const googleAccountMessage = (code) => ACCOUNT_MSG[code] || null;
exports.googleAccountMessage = googleAccountMessage;
