import { adminRoute } from '@/server/http/api';
import { audit } from '@/server/core/audit';
import { ok } from '@/server/http/http';
import { AppError } from '@/server/core/errors';
import * as products from '@/server/shop/products';
import * as settings from '@/server/core/settings';
import { schemas } from '@/server/http/validate';

export const config = { api: { bodyParser: false } };

export default adminRoute({ method: 'POST' }, async (req, res) => {
  const d = schemas.adminSettings.parse(req.body);
  if (d.logo_url && !products.imageSafe(d.logo_url)) throw new AppError(400, 'bad_image', 'URL logo harus https dari host yang diizinkan atau hasil upload (/media/...).');
  await settings.set(d);
  await audit(req.user.id, 'settings_update', req);
  ok(res, { saved: true });
});
