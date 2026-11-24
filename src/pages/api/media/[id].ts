import type { IncomingMessage, ServerResponse } from 'http';
import * as db from '@/server/core/db';
import { lim } from '@/server/http/limits';
import { ensureIp } from '@/server/http/net';
import { sendError } from '@/server/http/http';

export const config = { api: { bodyParser: false } };

export default async function media(req: IncomingMessage, res: ServerResponse) {
  try {
    ensureIp(req);
    if (!['GET', 'HEAD'].includes(req.method || '')) { res.setHeader('Allow', 'GET, HEAD'); res.statusCode = 405; return res.end(); }
    await lim.media(req, res);
    const id = String(req.query.id || '');
    if (!/^[a-f0-9]{24}$/.test(id)) { res.statusCode = 404; return res.end(); }
    const m = await db.one('SELECT mime, data FROM media WHERE id = ?', [id]);
    if (!m) { res.statusCode = 404; return res.end(); }
    res.statusCode = 200;
    res.setHeader('Content-Type', m.mime);
    res.setHeader('Content-Length', m.data.length);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    return res.end(req.method === 'HEAD' ? undefined : m.data);
  } catch (e) { return sendError(res, e); }
}
