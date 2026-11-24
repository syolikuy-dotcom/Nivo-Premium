import { adminRoute } from '@/server/http/api';
import * as db from '@/server/core/db';
import { audit } from '@/server/core/audit';
import { ok } from '@/server/http/http';
import { AppError } from '@/server/core/errors';
import crypto from 'crypto';

export const config = { api: { bodyParser: false } };

const TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const sniff = (b: Buffer): string | null => (b.length > 12 && b[0] === 0x89 && b.toString('latin1', 1, 4) === 'PNG' ? 'image/png'
  : b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff ? 'image/jpeg'
  : b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP' ? 'image/webp' : null);

export default adminRoute({ method: 'POST', body: 'raw', types: TYPES, maxBytes: 2 * 1024 * 1024 }, async (req, res) => {
  const b = req.body;
  if (!Buffer.isBuffer(b) || !b.length) throw new AppError(400, 'bad_file', 'Pilih gambar PNG, JPG, atau WebP (maks 2 MB).');
  const mime = sniff(b);
  if (!mime || mime !== String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase()) throw new AppError(400, 'bad_file', 'Isi file bukan gambar PNG, JPG, atau WebP yang valid.');
  const id = crypto.randomBytes(12).toString('hex');
  await db.query('INSERT INTO media (id, mime, size, data, created_by) VALUES (?,?,?,?,?)', [id, mime, b.length, b, req.user.id]);
  await audit(req.user.id, 'upload', req, { id, size: b.length });
  ok(res, { url: `/media/${id}` }, 201);
});
