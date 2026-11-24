import type { IncomingMessage, ServerResponse } from 'http';
import * as auth from '../auth/auth';
import type { Limit } from './ratelimit';
import type { SessionUser } from '../../shared/types';
import { lim } from './limits';
import * as log from '../core/logger';
import { AppError } from '../core/errors';
import { ensureIp } from './net';
import { sendError, readBody, readJson } from './http';

const JSON_MAX = 20 * 1024;

type Handler = (req: IncomingMessage, res: ServerResponse) => unknown;
export type AuthedReq = IncomingMessage & { user: SessionUser };
type AuthedHandler = (req: AuthedReq, res: ServerResponse) => unknown;
export interface RouteOptions {
  method?: string | string[]; session?: boolean; csrf?: boolean | null; auth?: 'user' | 'admin' | null;
  limits?: Limit[]; body?: 'json' | 'raw' | 'none'; maxBytes?: number; types?: string[] | null;
}
async function parseBody(req: IncomingMessage, o: Required<RouteOptions>): Promise<any> {
  if (req.method === 'GET' || req.method === 'HEAD') return {};
  if (req.readableEnded && req.body !== undefined) {
    if (o.body === 'json' && req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
    log.error('API route tanpa bodyParser:false', { path: String(req.url).split('?')[0] });
    throw new AppError(500, 'server_error', 'Terjadi kesalahan di server. Coba lagi sebentar lagi.');
  }
  if (o.body === 'none') return {};
  if (o.body === 'raw') {
    const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (o.types && !o.types.includes(type)) return {};
    return readBody(req, o.maxBytes);
  }
  return readJson(req, o.maxBytes || JSON_MAX);
}

function route(opts: RouteOptions, handler: Handler): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const o: Required<RouteOptions> = { method: 'POST', session: true, auth: null, csrf: null, limits: [], body: 'json', maxBytes: 0, types: null, ...opts };
  const methods = ([] as string[]).concat(o.method).map((m) => m.toUpperCase());
  const csrf = o.csrf === null ? o.session : o.csrf;
  return async function apiRoute(req: IncomingMessage, res: ServerResponse) {
    try {
      res.setHeader('Cache-Control', 'no-store');
      ensureIp(req);
      if (!methods.includes(req.method || '')) { res.setHeader('Allow', methods.join(', ')); throw new AppError(405, 'method_not_allowed', 'Metode tidak diizinkan.'); }
      if (o.session) {
        await auth.attach(req, res);
        if (csrf) auth.csrfGuard(req);
        await lim.api(req, res);
      }
      if (o.auth === 'user') auth.requireAuth(req);
      else if (o.auth === 'admin') auth.requireAdmin(req);
      for (const l of o.limits) await l(req, res);
      req.params = req.query || {};
      req.body = await parseBody(req, o);
      await handler(req, res);
    } catch (e) { sendError(res, e); }
  };
}

const adminRoute = (opts: RouteOptions, handler: AuthedHandler) => route({ ...opts, auth: 'admin', limits: [lim.admin, ...(opts.limits || [])] }, handler as Handler);
const userRoute = (opts: RouteOptions, handler: AuthedHandler) => route({ ...opts, auth: 'user' }, handler as Handler);

export { route, adminRoute, userRoute };
