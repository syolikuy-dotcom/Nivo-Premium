"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.lim = void 0;
const ratelimit_1 = require("./ratelimit");
const MSG = 'Terlalu banyak permintaan. Tunggu sebentar lalu coba lagi.';
exports.lim = {
    api: (0, ratelimit_1.limiter)('api', 60e3, 240, MSG),
    login: (0, ratelimit_1.limiter)('login', 15 * 60e3, 15, 'Terlalu banyak percobaan masuk. Coba lagi dalam 15 menit.', { skipOk: true }),
    register: (0, ratelimit_1.limiter)('register', 3600e3, 8, 'Terlalu banyak pendaftaran dari jaringan ini. Coba lagi nanti.'),
    oauth: (0, ratelimit_1.limiter)('oauth', 10 * 60e3, 60, 'Terlalu banyak percobaan masuk dengan Google. Coba lagi beberapa menit lagi.'),
    forgot: (0, ratelimit_1.limiter)('forgot', 3600e3, 6, 'Terlalu banyak permintaan reset password. Coba lagi nanti.'),
    write: (0, ratelimit_1.limiter)('write', 10 * 60e3, 40, MSG, { byUser: true }),
    money: (0, ratelimit_1.limiter)('money', 10 * 60e3, 25, 'Terlalu banyak transaksi dalam waktu singkat. Tunggu beberapa menit.', { byUser: true }),
    poll: (0, ratelimit_1.limiter)('poll', 60e3, 120, MSG, { byUser: true }),
    order: (0, ratelimit_1.limiter)('order', 60e3, 6, 'Terlalu cepat membuat pesanan. Tunggu semenit lalu coba lagi.', { byUser: true }),
    download: (0, ratelimit_1.limiter)('download', 10 * 60e3, 30, 'Terlalu banyak unduhan. Tunggu beberapa menit lalu coba lagi.', { byUser: true }),
    twofa: (0, ratelimit_1.limiter)('twofa', 10 * 60e3, 10, 'Terlalu banyak percobaan kode. Tunggu 10 menit lalu coba lagi.', { byUser: true }),
    login2fa: (0, ratelimit_1.limiter)('login2fa', 15 * 60e3, 15, 'Terlalu banyak percobaan kode. Coba lagi dalam 15 menit.', { skipOk: true }),
    stepup: (0, ratelimit_1.limiter)('stepup', 10 * 60e3, 8, 'Terlalu banyak verifikasi yang gagal. Tunggu 10 menit lalu coba lagi.', { byUser: true, skipOk: true }),
    health: (0, ratelimit_1.limiter)('health', 60e3, 60, MSG),
    admin: (0, ratelimit_1.limiter)('admin', 60e3, 120, MSG, { byUser: true }),
    webhook: (0, ratelimit_1.limiter)('webhook', 60e3, 120, MSG),
    media: (0, ratelimit_1.limiter)('media', 60e3, 600, MSG),
};
