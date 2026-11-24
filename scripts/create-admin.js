'use strict';
const crypto = require('crypto');
const { requireDist } = require('./_dist');
const db = requireDist('core/db');
const { run } = requireDist('core/migrate');
const { hashPassword } = requireDist('auth/security');
const { username: U, email: E, password: P } = requireDist('http/validate').fields;

(async () => {
  const [, , un, em, pw] = process.argv;
  if (!un || !em) { console.error('Pakai: node scripts/create-admin.js <username> <email> [password]'); process.exit(1); }
  const username = U.parse(un); const email = E.parse(em);
  const generated = !pw; const password = pw || (crypto.randomBytes(9).toString('base64url') + 'aA1');
  P.parse(password);
  await run();
  const hash = await hashPassword(password);
  const ex = await db.one('SELECT id FROM users WHERE username=? OR email=?', [username, email]);
  if (ex) { await db.query("UPDATE users SET role='admin', status='active', password_hash=?, failed_logins=0, locked_until=NULL WHERE id=?", [hash, ex.id]); }
  else { await db.query("INSERT INTO users (username,email,name,password_hash,role) VALUES (?,?,?,?, 'admin')", [username, email, username, hash]); }
  console.log(`Admin siap: ${username}`);
  if (generated) console.log(`Password sementara: ${password}   (segera ganti di menu Akun saya)`);
  process.exit(0);
})().catch((e) => { console.error('Gagal:', e.message); process.exit(1); });
