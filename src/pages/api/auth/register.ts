import { route } from '@/server/http/api';
import * as db from '@/server/core/db';
import * as sec from '@/server/auth/security';
import * as auth from '@/server/auth/auth';
import { lim } from '@/server/http/limits';
import { audit } from '@/server/core/audit';
import { ok, ip } from '@/server/http/http';
import { AppError, isDup } from '@/server/core/errors';
import * as turnstile from '@/server/auth/turnstile';
import { schemas, RESERVED } from '@/server/http/validate';

export const config = { api: { bodyParser: false } };

export default route({ method: 'POST', limits: [lim.register] }, async (req, res) => {
  const d = schemas.register.parse(req.body);
  await turnstile.check(d.captcha, ip(req));
  if (RESERVED.has(d.username.toLowerCase())) throw new AppError(400, 'reserved', 'Username ini tidak tersedia.');
  if (d.username.length >= 4 && d.password.toLowerCase().includes(d.username.toLowerCase())) throw new AppError(400, 'weak_password', 'Password tidak boleh memuat username kamu.');
  const hash = await sec.hashPassword(d.password);
  let id;
  try {
    const out = await db.query('INSERT INTO users (username, email, name, password_hash, last_login_at) VALUES (?,?,?,?,?)', [d.username, d.email, d.name, hash, new Date()]);
    id = out.insertId;
  } catch (e) {
    if (isDup(e)) throw new AppError(409, 'taken', 'Username atau email sudah terdaftar.');
    throw e;
  }
  await auth.startSession(req, res, id);
  await audit(id, 'register', req);
  ok(res, { redirect: '/dashboard' }, 201);
});
