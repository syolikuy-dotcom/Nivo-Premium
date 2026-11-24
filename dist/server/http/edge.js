"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.isSensitivePath = exports.STATIC_RE = void 0;
exports.createListener = createListener;
exports.canonPath = canonPath;
exports.csp = csp;
const path = __importStar(require("path"));
const crypto = __importStar(require("crypto"));
const config_1 = require("../core/config");
const log = __importStar(require("../core/logger"));
const net_1 = require("./net");
const dev = !config_1.config.isProd;
const STATIC_RE = /^\/(?:_next\/(?:static|image)\/|[^?]*\.(?:svg|png|jpe?g|webp|gif|ico|txt|xml|webmanifest|css|js|map|woff2?)$)/i;
exports.STATIC_RE = STATIC_RE;
const PRIVATE_PAGE_RE = /^\/(admin|dashboard|account|orders|deposit|am|checkout|login|register|forgot-password|reset-password)(\/|$)/;
const ADMIN_RE = /^\/(api\/)?admin(\/|$)/i;
const API_RE = /^\/api(\/|$)/;
const RESOURCE_RE = /^\/(media\/|sitemap\.xml$|robots\.txt$)/;
const BASE_HEADERS = {
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
function csp(nonce, secure) {
    const cf = config_1.config.turnstile.enabled ? ['https://challenges.cloudflare.com'] : [];
    const d = {
        'default-src': ["'self'"],
        'script-src': ["'self'", `'nonce-${nonce}'`, ...cf, ...(dev ? ["'unsafe-eval'"] : [])],
        'style-src': ["'self'", 'https://fonts.googleapis.com', ...(dev ? ["'unsafe-inline'"] : [])],
        'style-src-attr': ["'unsafe-inline'"],
        'font-src': ["'self'", 'https://fonts.gstatic.com'],
        'img-src': ["'self'", 'data:', ...config_1.config.imageHosts.map((h) => `https://${h}`)],
        'connect-src': ["'self'", ...cf, ...(dev ? ['ws:', 'wss:'] : [])],
        'frame-src': cf.length ? cf : ["'none'"],
        'manifest-src': ["'self'"], 'worker-src': ["'self'"],
        'object-src': ["'none'"], 'base-uri': ["'self'"], 'form-action': ["'self'"], 'frame-ancestors': ["'none'"],
    };
    const out = Object.entries(d).map(([k, v]) => `${k} ${v.join(' ')}`);
    if (secure)
        out.push('upgrade-insecure-requests');
    return out.join('; ');
}
function canonPath(url) {
    let p = String(url || '/');
    const q = p.search(/[?#]/);
    if (q >= 0)
        p = p.slice(0, q);
    try {
        p = decodeURIComponent(p);
    }
    catch {
        return null;
    }
    p = path.posix.normalize(p.replace(/\\/g, '/').replace(/\/{2,}/g, '/'));
    return p.startsWith('/') ? p : `/${p}`;
}
const SENSITIVE_PATH_RE = /^\/(?:node_modules|dist|src|scripts|tests)(?:\/|$)|(?:^|\/)\.(?!well-known(?:\/|$))[^/]+/i;
const isSensitivePath = (p) => SENSITIVE_PATH_RE.test(p);
exports.isSensitivePath = isSensitivePath;
function plain(res, status, text, extra) {
    if (res.headersSent) {
        try {
            res.end();
        }
        catch { }
        return;
    }
    res.statusCode = status;
    if (extra)
        for (const [k, v] of Object.entries(extra))
            res.setHeader(k, v);
    if (!res.getHeader('Content-Type'))
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end(text);
}
function createListener(handle) {
    return function onRequest(req, res) {
        Object.defineProperty(req, 'ip', { value: (0, net_1.clientIp)(req), configurable: true, enumerable: true });
        const t0 = process.hrtime.bigint();
        res.on('finish', () => {
            const p = String(req.url || '/').split('?')[0];
            if (!config_1.config.log.statics && res.statusCode < 400 && STATIC_RE.test(p))
                return;
            log.access({ method: req.method, path: p, status: res.statusCode, ms: Math.round(Number(process.hrtime.bigint() - t0) / 1e6), ip: req.ip, user: req.user ? req.user.username : undefined });
        });
        const p = canonPath(req.url);
        if (p === null)
            return plain(res, 400, 'Bad Request');
        const nonce = crypto.randomBytes(16).toString('base64');
        const secure = (0, net_1.isSecure)(req);
        req.headers['x-nonce'] = nonce;
        for (const [k, v] of Object.entries(BASE_HEADERS))
            res.setHeader(k, v);
        res.setHeader('Content-Security-Policy', csp(nonce, secure));
        if (secure)
            res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
        if (isSensitivePath(p))
            return plain(res, 404, 'Not Found');
        if (/^\/_next\/image(\/|$)/i.test(p))
            return plain(res, 404, 'Not Found');
        if (ADMIN_RE.test(p) && !(0, net_1.adminIpOk)(req)) {
            if (API_RE.test(p))
                return plain(res, 404, JSON.stringify({ ok: false, error: { code: 'not_found', message: 'Endpoint tidak ditemukan.' } }), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
            return plain(res, 404, 'Not Found');
        }
        const isApi = API_RE.test(p);
        if (!isApi && !['GET', 'HEAD'].includes(req.method || ''))
            return plain(res, 405, 'Method Not Allowed', { Allow: 'GET, HEAD' });
        if (!isApi && !RESOURCE_RE.test(p) && !STATIC_RE.test(p)) {
            res.setHeader('Cache-Control', 'private, no-store');
            if (PRIVATE_PAGE_RE.test(p))
                res.setHeader('X-Robots-Tag', 'noindex, nofollow');
        }
        return Promise.resolve().then(() => handle(req, res)).catch((e) => {
            log.error('request gagal', { msg: e && e.message, stack: e && e.stack });
            plain(res, 500, 'Terjadi kesalahan di server. Coba lagi sebentar lagi.');
        });
    };
}
