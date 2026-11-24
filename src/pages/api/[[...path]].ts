import type { IncomingMessage, ServerResponse } from 'http';
import { sendJson } from '@/server/http/http';

export const config = { api: { bodyParser: false } };

export default function notFound(_req: IncomingMessage, res: ServerResponse) {
  res.setHeader('Cache-Control', 'no-store');
  sendJson(res, 404, { ok: false, error: { code: 'not_found', message: 'Endpoint tidak ditemukan.' } });
}
