import { userRoute } from '@/server/http/api';
import { lim } from '@/server/http/limits';
import { audit } from '@/server/core/audit';
import * as orders from '@/server/shop/orders';
import { fields } from '@/server/http/validate';

export const config = { api: { bodyParser: false } };

export default userRoute({ method: 'GET', limits: [lim.download] }, async (req, res) => {
  const f = await orders.exportTxt(req.user, fields.orderNo.parse(req.params.no));
  await audit(req.user.id, 'order_download', req, { no: f.filename.replace('.txt', '') });
  const body = Buffer.from(f.text, 'utf8');
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${f.filename}"`);
  res.setHeader('Content-Length', body.length);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(body);
});
