export const GOOGLE_START = '/api/auth/google/start';
export const googleUrl = (mode: 'login' | 'link' = 'login', next = ''): string => {
  const q: string[] = [];
  if (mode === 'link') q.push('mode=link');
  if (next) q.push(`next=${encodeURIComponent(next)}`);
  return q.length ? `${GOOGLE_START}?${q.join('&')}` : GOOGLE_START;
};

const LOGIN_MSG: Record<string, string> = {
  exists: 'Email ini sudah terdaftar dengan password. Masuk dengan username/email dan password, lalu hubungkan Google dari halaman Akun.',
  disabled: 'Akun ini dinonaktifkan. Hubungi admin bila ini keliru.',
  admin: 'Akun admin hanya bisa masuk dengan username dan password.',
  cancelled: 'Login dengan Google dibatalkan.',
  failed: 'Login dengan Google gagal. Coba lagi sebentar lagi.',
  expired: 'Sesi login Google sudah kedaluwarsa. Coba lagi.',
  unverified: 'Email Google kamu belum terverifikasi.',
  off: 'Login dengan Google belum diaktifkan.',
};
export const googleLoginMessage = (code: string): string => LOGIN_MSG[code] || '';

const ACCOUNT_MSG: Record<string, { ok: boolean; t: string }> = {
  linked: { ok: true, t: 'Akun Google berhasil dihubungkan. Sekarang kamu bisa masuk dengan Google.' },
  already: { ok: false, t: 'Akunmu sudah terhubung dengan Google.' },
  taken: { ok: false, t: 'Akun Google itu sudah dipakai akun lain.' },
  cancelled: { ok: false, t: 'Penghubungan Google dibatalkan.' },
  failed: { ok: false, t: 'Gagal menghubungkan Google. Coba lagi sebentar lagi.' },
  unverified: { ok: false, t: 'Email Google kamu belum terverifikasi.' },
  expired: { ok: false, t: 'Sesi penghubungan kedaluwarsa. Coba lagi.' },
};
export const googleAccountMessage = (code: string): { ok: boolean; t: string } | null => ACCOUNT_MSG[code] || null;
