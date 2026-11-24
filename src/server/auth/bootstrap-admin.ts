import * as crypto from 'crypto';
import * as db from '../core/db';
import { config } from '../core/config';
import * as sec from './security';
import * as log from '../core/logger';
import { fields } from '../http/validate';
import { isDup } from '../core/errors';

function defaultEmail() {
  const h = config.appHost.replace(/:\d+$/, '');
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(h) && !/^\d+(\.\d+){3}$/.test(h) ? `admin@${h}` : 'admin@nivo.local';
}

async function ensureAdmin() {
  let username; let email;
  try { username = fields.username.parse(config.admin.username || 'admin'); email = fields.email.parse(config.admin.email || defaultEmail()); }
  catch (e) { log.warn('ADMIN_USERNAME / ADMIN_EMAIL tidak valid, pembuatan admin otomatis dilewati', { alasan: e.issues && e.issues[0] && e.issues[0].message }); return; }

  const ex = await db.one('SELECT id, role, status FROM users WHERE username = ? OR email = ? LIMIT 1', [username, email]);
  if (ex) {
    if (ex.role === 'admin') log.info('Admin siap', { username, email, status: ex.status });
    else log.warn('Username/email admin sudah dipakai akun biasa, tidak dipromosikan otomatis. Ganti ADMIN_USERNAME/ADMIN_EMAIL di .env atau jalankan scripts/create-admin.js', { username, email });
    return;
  }

  let password = config.admin.password; let generated = false;
  if (password && !fields.password.safeParse(password).success) { log.warn('ADMIN_PASSWORD tidak memenuhi aturan (min 8 karakter, huruf besar, huruf kecil, angka, bukan password umum): dibuat password acak'); password = ''; }
  if (!password) { password = `${crypto.randomBytes(12).toString('base64url')}aA1`; generated = true; }

  try {
    await db.query("INSERT INTO users (username, email, name, password_hash, role) VALUES (?,?,?,?, 'admin')", [username, email, 'Administrator', await sec.hashPassword(password)]);
  } catch (e) { if (isDup(e)) return; throw e; }
  log.info('Admin dibuat otomatis dan tersimpan di database', { username, email });
  if (generated) {
    console.log(`\n  ┌─ AKUN ADMIN (ditampilkan SEKALI) ─────────────────────────\n  │ Username : ${username}\n  │ Email    : ${email}\n  │ Password : ${password}\n  │ Simpan sekarang lalu ganti di menu Akun saya.\n  └──────────────────────────────────────────────────────────\n`);
  } else {
    log.info('Password admin sesuai ADMIN_PASSWORD di .env (hanya dipakai saat akun dibuat; mengubahnya di .env tidak mengganti password yang sudah tersimpan)');
  }
}
export { ensureAdmin };
