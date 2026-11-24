import type { IncomingMessage, ServerResponse } from 'http';
import * as db from '@/server/core/db';
import type { Row } from '@/server/core/db';
import { config as appConfig } from '@/server/core/config';
import { ensureIp } from '@/server/http/net';
import { sendError } from '@/server/http/http';

export const config = { api: { bodyParser: false } };

export default async function sitemap(req: IncomingMessage, res: ServerResponse) {
  try {
    ensureIp(req);
    if (!['GET', 'HEAD'].includes(req.method || '')) { res.setHeader('Allow', 'GET, HEAD'); res.statusCode = 405; return res.end(); }
    const rows = await db.query('SELECT slug, updated_at FROM products WHERE active = 1 ORDER BY id DESC LIMIT 2000');
    const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const latest = rows.reduce((m: number, p: Row) => Math.max(m, new Date(p.updated_at).getTime() || 0), 0) || Date.now();
    const u = (loc: string, last: unknown, freq: string, prio: string) => `<url><loc>${esc(appConfig.appUrl + loc)}</loc><lastmod>${new Date(last as string | Date).toISOString()}</lastmod><changefreq>${freq}</changefreq><priority>${prio}</priority></url>`;
    const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${u('/', latest, 'daily', '1.0')}${u('/products', latest, 'daily', '0.9')}${rows.map((p: Row) => u(`/products/${p.slug}`, p.updated_at, 'daily', '0.8')).join('')}</urlset>`;
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.end(req.method === 'HEAD' ? undefined : xml);
  } catch (e) { return sendError(res, e); }
}
