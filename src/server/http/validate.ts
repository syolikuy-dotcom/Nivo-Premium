import { z } from 'zod';

z.setErrorMap(() => ({ message: 'Input tidak valid.' }));

const PW_MSG = 'Password minimal 8 karakter dengan huruf besar, huruf kecil, dan angka.';
export const RESERVED = new Set(['admin', 'administrator', 'root', 'support', 'system', 'nivo', 'nivopremium', 'owner', 'staff', 'api']);
const noCtl = /^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f<>]*$/;

const email = z.string().trim().toLowerCase().max(190, 'Email terlalu panjang.').email('Format email tidak valid.');
const username = z.string().trim().regex(/^[A-Za-z0-9_]{3,20}$/, 'Username 3–20 karakter: huruf, angka, atau garis bawah.');
const COMMON = new Set(['password', 'passw0rd', 'passwd', 'qwerty', 'qwertyuiop', 'qwertyui', 'asdfghjkl', 'zxcvbnm', 'abcdefgh', 'abcdefghi', 'abc', 'welcome', 'letmein', 'admin', 'administrator', 'iloveyou', 'monkey', 'dragon', 'football', 'baseball', 'master', 'sunshine', 'princess', 'shadow', 'superman', 'login', 'changeme', 'default', 'secret', 'rahasia', 'sandi', 'katasandi', 'indonesia', 'bismillah', 'sayangku', 'nivo', 'nivopremium', 'premium', 'premku']);
const baseOf = (pw: string) => pw.toLowerCase().replace(/[\d\W_]+$/g, '');
const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's', '!': 'i' };
/** Hanya huruf, dengan leetspeak umum dinormalkan: "P@ssw0rd1A" → "passwordia". */
const coreOf = (pw: string) => pw.toLowerCase().replace(/[013457@$!]/g, (c) => LEET[c] || '').replace(/[^a-z]+/g, '');
function weak(pw: string): boolean {
  if (COMMON.has(baseOf(pw)) || COMMON.has(pw.toLowerCase())) return true;
  const core = coreOf(pw);
  for (const w of COMMON) {
    if (core === w) return true;
    // Kata umum yang cukup panjang + paling banyak 3 huruf tambahan di depan/belakang (mis. "passwordia", "welcomeoax") tetap lemah.
    if (w.length >= 6 && core.length - w.length <= 3 && core.length > w.length && (core.startsWith(w) || core.endsWith(w))) return true;
  }
  return false;
}
const password = z.string().min(8, PW_MSG).max(128, 'Password maksimal 128 karakter.').regex(/[a-z]/, PW_MSG).regex(/[A-Z]/, PW_MSG).regex(/\d/, PW_MSG)
  .refine((v) => !weak(v), 'Password terlalu mudah ditebak. Pilih kombinasi lain.');
const name = z.string().trim().min(2, 'Nama minimal 2 karakter.').max(80, 'Nama maksimal 80 karakter.').regex(/^[^<>\u0000-\u001f\u007f]+$/, 'Nama tidak boleh memuat < > atau karakter kontrol.');
const captcha = z.string().max(2100).optional();
const code2fa = z.string().trim().min(6).max(24);
const stepPassword = z.string().min(1, 'Isi password kamu untuk konfirmasi.').max(128);
const idemKey = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/, 'Kunci permintaan tidak valid. Muat ulang halaman.');
const orderNo = z.string().regex(/^PT\d{6}[0-9A-F]{6}$/, 'Nomor pesanan tidak valid.');
const depositNo = z.string().regex(/^DP\d{6}[0-9A-F]{6}$/, 'Nomor deposit tidak valid.');
const amNo = z.string().regex(/^AM\d{6}[0-9A-F]{6}$/, 'Nomor pesanan tidak valid.');
const id = z.coerce.number().int().positive();

const confirmed = (o: { password: string; confirm: string }) => o.password === o.confirm;
const CONFIRM_ERR = { message: 'Konfirmasi password tidak cocok.', path: ['confirm'] };

export const schemas = {
  register: z.object({ name, username, email, password, confirm: z.string(), captcha }).strict().refine(confirmed, CONFIRM_ERR),
  login: z.object({ identifier: z.string().trim().min(3).max(190), password: z.string().min(1).max(128), captcha }).strict(),
  forgot: z.object({ email, captcha }).strict(),
  reset: z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/), password, confirm: z.string() }).strict().refine(confirmed, CONFIRM_ERR),
  login2fa: z.object({ challenge: z.string().min(20).max(200), code: code2fa }).strict(),
  twofaEnable: z.object({ code: code2fa }).strict(),
  twofaConfirm: z.object({ password: z.string().min(1).max(128), code: code2fa }).strict(),
  profile: z.object({ name }).strict(),
  changePassword: z.object({ current: z.string().min(1).max(128), password, confirm: z.string() }).strict().refine(confirmed, CONFIRM_ERR),
  order: z.object({ productId: id, qty: z.number().int().min(1, 'Jumlah minimal 1.').max(50, 'Jumlah maksimal 50 per pesanan.'), method: z.enum(['qris', 'balance']), idemKey }).strict(),
  deposit: z.object({ amount: z.number().int(), idemKey }).strict(),
  amSingle: z.object({ email, idemKey }).strict(),
  amBulk: z.object({ qty: z.number().int().min(1, 'Jumlah minimal 1.').max(200, 'Jumlah maksimal 200.'), idemKey }).strict(),
  amVerify: z.object({ link: z.string().trim().max(600).regex(/^https:\/\/alight\.link\/[A-Za-z0-9._~\-/?=&%#:+]{3,560}$/, 'Tempel link lengkap dari email (https://alight.link/...).') }).strict(),

  adminProduct: z.object({
    name: z.string().trim().min(2).max(160).regex(noCtl, 'Nama memuat karakter tidak valid.'),
    category: z.string().trim().min(1).max(60).regex(noCtl, 'Kategori memuat karakter tidak valid.'),
    description: z.string().max(2000).regex(noCtl, 'Deskripsi memuat karakter tidak valid.'),
    price: z.number().int().min(0).max(10_000_000),
    active: z.boolean(), price_locked: z.boolean(),
    image_url: z.string().trim().max(500),
  }).strict(),
  adminBalance: z.object({
    amount: z.number().int().refine((n) => n !== 0 && Math.abs(n) <= 10_000_000, 'Nominal 1 – 10.000.000 (boleh negatif).'),
    note: z.string().trim().max(120).regex(noCtl),
    password: stepPassword, code: code2fa.optional(),
  }).strict(),
  adminStatus: z.object({ status: z.enum(['active', 'disabled']) }).strict(),
  adminRole: z.object({ role: z.enum(['user', 'admin']), password: stepPassword, code: code2fa.optional() }).strict(),
  adminSettings: z.object({
    site_name: z.string().trim().min(2).max(40).regex(noCtl), tagline: z.string().trim().max(120).regex(noCtl),
    logo_url: z.string().trim().max(500), notice: z.string().trim().max(200).regex(noCtl),
    wa_number: z.string().trim().regex(/^(\d{8,16})?$/, 'Nomor WhatsApp hanya angka (contoh 62812xxxx).'),
    instagram: z.string().trim().regex(/^[A-Za-z0-9._]{0,30}$/, 'Username Instagram hanya huruf, angka, titik, underscore (tanpa @).'),
    contact_email: z.string().trim().max(190).refine((v) => v === '' || z.string().email().safeParse(v).success, 'Email kontak tidak valid.'),
    markup_pct: z.number().min(0).max(500), markup_flat: z.number().int().min(0).max(1_000_000),
    am_price: z.number().int().min(0).max(1_000_000),
    min_deposit: z.number().int().min(1000).max(100_000_000), max_deposit: z.number().int().min(1000).max(1_000_000_000),
    low_balance_threshold: z.number().int().min(0).max(100_000_000),
    stuck_minutes: z.number().int().min(5).max(1440),
    alert_email: z.string().trim().max(190).refine((v) => v === '' || z.string().email().safeParse(v).success, 'Email alert tidak valid.'),
  }).strict().refine((s) => s.max_deposit >= s.min_deposit, { message: 'Deposit maksimal harus ≥ minimal.' }),
};

export const fields = { username, email, password, name, idemKey, orderNo, depositNo, amNo, id };
export { z };
