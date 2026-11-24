import type { IncomingMessage, ServerResponse } from 'http';
import { config as appConfig } from '@/server/core/config';
import fs from 'fs';
import path from 'path';

export const config = { api: { bodyParser: false } };

let template: string | null = null;
export default function robots(req: IncomingMessage, res: ServerResponse) {
  if (!['GET', 'HEAD'].includes(req.method || '')) { res.setHeader('Allow', 'GET, HEAD'); res.statusCode = 405; return res.end(); }
  if (template === null) template = fs.readFileSync(path.join(process.cwd(), 'public', 'robots.txt'), 'utf8');
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  return res.end(req.method === 'HEAD' ? undefined : template.split('__APP_URL__').join(appConfig.appUrl));
}
