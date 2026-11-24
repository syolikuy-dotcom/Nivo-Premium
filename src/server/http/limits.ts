import { limiter } from './ratelimit';

const MSG = 'Terlalu banyak permintaan. Tunggu sebentar lalu coba lagi.';
export const lim = {
  api: limiter('api', 60e3, 240, MSG),
  login: limiter('login', 15 * 60e3, 15, 'Terlalu banyak percobaan masuk. Coba lagi dalam 15 menit.', { skipOk: true }),
  register: limiter('register', 3600e3, 8, 'Terlalu banyak pendaftaran dari jaringan ini. Coba lagi nanti.'),
  oauth: limiter('oauth', 10 * 60e3, 60, 'Terlalu banyak percobaan masuk dengan Google. Coba lagi beberapa menit lagi.'),
  forgot: limiter('forgot', 3600e3, 6, 'Terlalu banyak permintaan reset password. Coba lagi nanti.'),
  write: limiter('write', 10 * 60e3, 40, MSG, { byUser: true }),
  money: limiter('money', 10 * 60e3, 25, 'Terlalu banyak transaksi dalam waktu singkat. Tunggu beberapa menit.', { byUser: true }),
  poll: limiter('poll', 60e3, 120, MSG, { byUser: true }),
  order: limiter('order', 60e3, 6, 'Terlalu cepat membuat pesanan. Tunggu semenit lalu coba lagi.', { byUser: true }),
  download: limiter('download', 10 * 60e3, 30, 'Terlalu banyak unduhan. Tunggu beberapa menit lalu coba lagi.', { byUser: true }),
  twofa: limiter('twofa', 10 * 60e3, 10, 'Terlalu banyak percobaan kode. Tunggu 10 menit lalu coba lagi.', { byUser: true }),
  login2fa: limiter('login2fa', 15 * 60e3, 15, 'Terlalu banyak percobaan kode. Coba lagi dalam 15 menit.', { skipOk: true }),
  stepup: limiter('stepup', 10 * 60e3, 8, 'Terlalu banyak verifikasi yang gagal. Tunggu 10 menit lalu coba lagi.', { byUser: true, skipOk: true }),
  health: limiter('health', 60e3, 60, MSG),
  admin: limiter('admin', 60e3, 120, MSG, { byUser: true }),
  webhook: limiter('webhook', 60e3, 120, MSG),
  media: limiter('media', 60e3, 600, MSG),
};
