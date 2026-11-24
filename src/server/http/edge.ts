import type { IncomingMessage, ServerResponse } from 'http';
import * as path from 'path';
import * as crypto from 'crypto';
import { config } from '../core/config';
import * as log from '../core/logger';
import { clientIp, isSecure, adminIpOk } from './net';

const dev = !config.isProd;
const STATIC_RE = /^\/(?:_next\/(?:static|image)\/|[^?]*\.(?:svg|png|jpe?g|webp|gif|ico|txt|xml|webmanifest|css|js|map|woff2?)$)/i;
const PRIVATE_PAGE_RE = /^\/(admin|dashboard|account|orders|deposit|am|checkout|login|register|forgot-password|reset-password)(\/|$)/;
const ADMIN_RE = /^\/(api\/)?admin(\/|$)/i;
const API_RE = /^\/api(\/|$)/;
const RESOURCE_RE = /^\/(media\/|sitemap\.xml$|robots\.txt$)/;

const BASE_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-DNS-Prefetch-Control': 'off',
  'X-Download-Options': 'noopen',
  'X-Frame-Options': 'DENY',
  'X-Permitted-Cross-Domain-Policies': 'none',
  'X-XSS-Protection': '0',
  'Origin-Agent-Cluster': '?1',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
};

function csp(nonce: string, secure: boolean): string {
  const cf = config.turnstile.enabled ? ['https://challenges.cloudflare.com'] : [];
  const d: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': ["'self'", `'nonce-${nonce}'`, ...cf, ...(dev ? ["'unsafe-eval'"] : [])],
    'style-src': ["'self'", 'https://fonts.googleapis.com', ...(dev ? ["'unsafe-inline'"] : [])],
    'style-src-attr': ["'unsafe-inline'"],
    'font-src': ["'self'", 'https://fonts.gstatic.com'],
    'img-src': ["'self'", 'data:', ...config.imageHosts.map((h) => `https://${h}`)],
    'connect-src': ["'self'", ...cf, ...(dev ? ['ws:', 'wss:'] : [])],
    'frame-src': cf.length ? cf : ["'none'"],
    'manifest-src': ["'self'"], 'worker-src': ["'self'"],
    'object-src': ["'none'"], 'base-uri': ["'self'"], 'form-action': ["'self'"], 'frame-ancestors': ["'none'"],
  };
  const out = Object.entries(d).map(([k, v]) => `${k} ${v.join(' ')}`);
  if (secure) out.push('upgrade-insecure-requests');
  return out.join('; ');
}

function canonPath(url: string | undefined): string | null {
  let p = String(url || '/'); const q = p.search(/[?#]/); if (q >= 0) p = p.slice(0, q);
  try { p = decodeURIComponent(p); } catch { return null; }
  p = path.posix.normalize(p.replace(/\\/g, '/').replace(/\/{2,}/g, '/'));
  return p.startsWith('/') ? p : `/${p}`;
}

const SENSITIVE_PATH_RE = /^\/(?:node_modules|dist|src|scripts|tests)(?:\/|$)|(?:^|\/)\.(?!well-known(?:\/|$))[^/]+/i;
const isSensitivePath = (p: string): boolean => SENSITIVE_PATH_RE.test(p);

function plain(res: ServerResponse, status: number, text: string, extra?: Record<string, string>): void {
  if (res.headersSent) { try { res.end(); } catch { /* abaikan: best-effort */ } return; }
  res.statusCode = status;
  if (extra) for (const [k, v] of Object.entries(extra)) res.setHeader(k, v);
  if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end(text);
}

export type NextHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void> | void;
function createListener(handle: NextHandler) {
  return function onRequest(req: IncomingMessage, res: ServerResponse): void | Promise<void> {
    Object.defineProperty(req, 'ip', { value: clientIp(req), configurable: true, enumerable: true });
    const t0 = process.hrtime.bigint();
    res.on('finish', () => {
      const p = String(req.url || '/').split('?')[0];
      if (!config.log.statics && res.statusCode < 400 && STATIC_RE.test(p)) return;
      log.access({ method: req.method, path: p, status: res.statusCode, ms: Math.round(Number(process.hrtime.bigint() - t0) / 1e6), ip: req.ip, user: req.user ? req.user.username : undefined });
    });

    const p = canonPath(req.url);
    if (p === null) return plain(res, 400, 'Bad Request');

    const nonce = crypto.randomBytes(16).toString('base64');
    const secure = isSecure(req);
    req.headers['x-nonce'] = nonce;
    for (const [k, v] of Object.entries(BASE_HEADERS)) res.setHeader(k, v);
    res.setHeader('Content-Security-Policy', csp(nonce, secure));
    if (secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');

    if (isSensitivePath(p)) return plain(res, 404, 'Not Found');

    if (/^\/_next\/image(\/|$)/i.test(p)) return plain(res, 404, 'Not Found');

    if (ADMIN_RE.test(p) && !adminIpOk(req)) {
      if (API_RE.test(p)) return plain(res, 404, JSON.stringify({ ok: false, error: { code: 'not_found', message: 'Endpoint tidak ditemukan.' } }), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      return plain(res, 404, 'Not Found');
    }

    const isApi = API_RE.test(p);
    if (!isApi && !['GET', 'HEAD'].includes(req.method || '')) return plain(res, 405, 'Method Not Allowed', { Allow: 'GET, HEAD' });

    if (!isApi && !RESOURCE_RE.test(p) && !STATIC_RE.test(p)) {
      res.setHeader('Cache-Control', 'private, no-store');
      if (PRIVATE_PAGE_RE.test(p)) res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    }

    return Promise.resolve().then(() => handle(req, res)).catch((e) => {
      log.error('request gagal', { msg: e && e.message, stack: e && e.stack });
      plain(res, 500, 'Terjadi kesalahan di server. Coba lagi sebentar lagi.');
    });
  };
}

export { createListener, canonPath, csp, STATIC_RE, isSensitivePath };
