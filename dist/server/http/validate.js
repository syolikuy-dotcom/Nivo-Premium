"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.z = exports.fields = exports.schemas = exports.RESERVED = void 0;
const zod_1 = require("zod");
Object.defineProperty(exports, "z", { enumerable: true, get: function () { return zod_1.z; } });
zod_1.z.setErrorMap(() => ({ message: 'Input tidak valid.' }));
const PW_MSG = 'Password minimal 8 karakter dengan huruf besar, huruf kecil, dan angka.';
exports.RESERVED = new Set(['admin', 'administrator', 'root', 'support', 'system', 'nivo', 'nivopremium', 'owner', 'staff', 'api']);
const noCtl = /^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f<>]*$/;
const email = zod_1.z.string().trim().toLowerCase().max(190, 'Email terlalu panjang.').email('Format email tidak valid.');
const username = zod_1.z.string().trim().regex(/^[A-Za-z0-9_]{3,20}$/, 'Username 3–20 karakter: huruf, angka, atau garis bawah.');
const COMMON = new Set(['password', 'passw0rd', 'passwd', 'qwerty', 'qwertyuiop', 'qwertyui', 'asdfghjkl', 'zxcvbnm', 'abcdefgh', 'abcdefghi', 'abc', 'welcome', 'letmein', 'admin', 'administrator', 'iloveyou', 'monkey', 'dragon', 'football', 'baseball', 'master', 'sunshine', 'princess', 'shadow', 'superman', 'login', 'changeme', 'default', 'secret', 'rahasia', 'sandi', 'katasandi', 'indonesia', 'bismillah', 'sayangku', 'nivo', 'nivopremium', 'premium', 'premku']);
const baseOf = (pw) => pw.toLowerCase().replace(/[\d\W_]+$/g, '');
const LEET = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's', '!': 'i' };
const coreOf = (pw) => pw.toLowerCase().replace(/[013457@$!]/g, (c) => LEET[c] || '').replace(/[^a-z]+/g, '');
function weak(pw) {
    if (COMMON.has(baseOf(pw)) || COMMON.has(pw.toLowerCase()))
        return true;
    const core = coreOf(pw);
    for (const w of COMMON) {
        if (core === w)
            return true;
        if (w.length >= 6 && core.length - w.length <= 3 && core.length > w.length && (core.startsWith(w) || core.endsWith(w)))
            return true;
    }
    return false;
}
const password = zod_1.z.string().min(8, PW_MSG).max(128, 'Password maksimal 128 karakter.').regex(/[a-z]/, PW_MSG).regex(/[A-Z]/, PW_MSG).regex(/\d/, PW_MSG)
    .refine((v) => !weak(v), 'Password terlalu mudah ditebak. Pilih kombinasi lain.');
const name = zod_1.z.string().trim().min(2, 'Nama minimal 2 karakter.').max(80, 'Nama maksimal 80 karakter.').regex(/^[^<>\u0000-\u001f\u007f]+$/, 'Nama tidak boleh memuat < > atau karakter kontrol.');
const captcha = zod_1.z.string().max(2100).optional();
const code2fa = zod_1.z.string().trim().min(6).max(24);
const stepPassword = zod_1.z.string().min(1, 'Isi password kamu untuk konfirmasi.').max(128);
const idemKey = zod_1.z.string().regex(/^[A-Za-z0-9_-]{16,64}$/, 'Kunci permintaan tidak valid. Muat ulang halaman.');
const orderNo = zod_1.z.string().regex(/^PT\d{6}[0-9A-F]{6}$/, 'Nomor pesanan tidak valid.');
const depositNo = zod_1.z.string().regex(/^DP\d{6}[0-9A-F]{6}$/, 'Nomor deposit tidak valid.');
const amNo = zod_1.z.string().regex(/^AM\d{6}[0-9A-F]{6}$/, 'Nomor pesanan tidak valid.');
const id = zod_1.z.coerce.number().int().positive();
const confirmed = (o) => o.password === o.confirm;
const CONFIRM_ERR = { message: 'Konfirmasi password tidak cocok.', path: ['confirm'] };
exports.schemas = {
    register: zod_1.z.object({ name, username, email, password, confirm: zod_1.z.string(), captcha }).strict().refine(confirmed, CONFIRM_ERR),
    login: zod_1.z.object({ identifier: zod_1.z.string().trim().min(3).max(190), password: zod_1.z.string().min(1).max(128), captcha }).strict(),
    forgot: zod_1.z.object({ email, captcha }).strict(),
    reset: zod_1.z.object({ token: zod_1.z.string().regex(/^[A-Za-z0-9_-]{43}$/), password, confirm: zod_1.z.string() }).strict().refine(confirmed, CONFIRM_ERR),
    login2fa: zod_1.z.object({ challenge: zod_1.z.string().min(20).max(200), code: code2fa }).strict(),
    twofaEnable: zod_1.z.object({ code: code2fa }).strict(),
    twofaConfirm: zod_1.z.object({ password: zod_1.z.string().min(1).max(128), code: code2fa }).strict(),
    profile: zod_1.z.object({ name }).strict(),
    changePassword: zod_1.z.object({ current: zod_1.z.string().min(1).max(128), password, confirm: zod_1.z.string() }).strict().refine(confirmed, CONFIRM_ERR),
    order: zod_1.z.object({ productId: id, qty: zod_1.z.number().int().min(1, 'Jumlah minimal 1.').max(50, 'Jumlah maksimal 50 per pesanan.'), method: zod_1.z.enum(['qris', 'balance']), idemKey }).strict(),
    deposit: zod_1.z.object({ amount: zod_1.z.number().int(), idemKey }).strict(),
    amSingle: zod_1.z.object({ email, idemKey }).strict(),
    amBulk: zod_1.z.object({ qty: zod_1.z.number().int().min(1, 'Jumlah minimal 1.').max(200, 'Jumlah maksimal 200.'), idemKey }).strict(),
    amVerify: zod_1.z.object({ link: zod_1.z.string().trim().max(600).regex(/^https:\/\/alight\.link\/[A-Za-z0-9._~\-/?=&%#:+]{3,560}$/, 'Tempel link lengkap dari email (https://alight.link/...).') }).strict(),
    adminProduct: zod_1.z.object({
        name: zod_1.z.string().trim().min(2).max(160).regex(noCtl, 'Nama memuat karakter tidak valid.'),
        category: zod_1.z.string().trim().min(1).max(60).regex(noCtl, 'Kategori memuat karakter tidak valid.'),
        description: zod_1.z.string().max(2000).regex(noCtl, 'Deskripsi memuat karakter tidak valid.'),
        price: zod_1.z.number().int().min(0).max(10_000_000),
        active: zod_1.z.boolean(), price_locked: zod_1.z.boolean(),
        image_url: zod_1.z.string().trim().max(500),
    }).strict(),
    adminBalance: zod_1.z.object({
        amount: zod_1.z.number().int().refine((n) => n !== 0 && Math.abs(n) <= 10_000_000, 'Nominal 1 – 10.000.000 (boleh negatif).'),
        note: zod_1.z.string().trim().max(120).regex(noCtl),
        password: stepPassword, code: code2fa.optional(),
    }).strict(),
    adminStatus: zod_1.z.object({ status: zod_1.z.enum(['active', 'disabled']) }).strict(),
    adminRole: zod_1.z.object({ role: zod_1.z.enum(['user', 'admin']), password: stepPassword, code: code2fa.optional() }).strict(),
    adminSettings: zod_1.z.object({
        site_name: zod_1.z.string().trim().min(2).max(40).regex(noCtl), tagline: zod_1.z.string().trim().max(120).regex(noCtl),
        logo_url: zod_1.z.string().trim().max(500), notice: zod_1.z.string().trim().max(200).regex(noCtl),
        wa_number: zod_1.z.string().trim().regex(/^(\d{8,16})?$/, 'Nomor WhatsApp hanya angka (contoh 62812xxxx).'),
        instagram: zod_1.z.string().trim().regex(/^[A-Za-z0-9._]{0,30}$/, 'Username Instagram hanya huruf, angka, titik, underscore (tanpa @).'),
        contact_email: zod_1.z.string().trim().max(190).refine((v) => v === '' || zod_1.z.string().email().safeParse(v).success, 'Email kontak tidak valid.'),
        markup_pct: zod_1.z.number().min(0).max(500), markup_flat: zod_1.z.number().int().min(0).max(1_000_000),
        am_price: zod_1.z.number().int().min(0).max(1_000_000),
        min_deposit: zod_1.z.number().int().min(1000).max(100_000_000), max_deposit: zod_1.z.number().int().min(1000).max(1_000_000_000),
        low_balance_threshold: zod_1.z.number().int().min(0).max(100_000_000),
        stuck_minutes: zod_1.z.number().int().min(5).max(1440),
        alert_email: zod_1.z.string().trim().max(190).refine((v) => v === '' || zod_1.z.string().email().safeParse(v).success, 'Email alert tidak valid.'),
    }).strict().refine((s) => s.max_deposit >= s.min_deposit, { message: 'Deposit maksimal harus ≥ minimal.' }),
};
exports.fields = { username, email, password, name, idemKey, orderNo, depositNo, amNo, id };
