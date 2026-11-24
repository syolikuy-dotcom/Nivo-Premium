import { adminRoute } from '@/server/http/api';
import * as db from '@/server/core/db';
import { audit } from '@/server/core/audit';
import { ok } from '@/server/http/http';
import { AppError } from '@/server/core/errors';
import * as products from '@/server/shop/products';
import { schemas, fields } from '@/server/http/validate';

export const config = { api: { bodyParser: false } };

export default adminRoute({ method: 'POST' }, async (req, res) => {
  const id = fields.id.parse(req.params.id); const d = schemas.adminProduct.parse(req.body);
  const img = d.image_url ? products.imageSafe(d.image_url) : null;
  if (d.image_url && !img) throw new AppError(400, 'bad_image', 'URL gambar harus https dari host yang diizinkan atau hasil upload (/media/...).');
  const x = await db.query('UPDATE products SET name=?, category=?, description=?, price=?, active=?, price_locked=?, image_url=? WHERE id=?',
    [d.name, d.category, d.description || null, d.price, d.active ? 1 : 0, d.price_locked ? 1 : 0, img, id]);
  if (!x.affectedRows) throw new AppError(404, 'not_found', 'Produk tidak ditemukan.');
  await audit(req.user.id, 'product_update', req, { id, price: d.price, active: d.active });
  ok(res, { saved: true });
});
