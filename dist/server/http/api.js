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
exports.userRoute = exports.adminRoute = void 0;
exports.route = route;
const auth = __importStar(require("../auth/auth"));
const limits_1 = require("./limits");
const log = __importStar(require("../core/logger"));
const errors_1 = require("../core/errors");
const net_1 = require("./net");
const http_1 = require("./http");
const JSON_MAX = 20 * 1024;
async function parseBody(req, o) {
    if (req.method === 'GET' || req.method === 'HEAD')
        return {};
    if (req.readableEnded && req.body !== undefined) {
        if (o.body === 'json' && req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body))
            return req.body;
        log.error('API route tanpa bodyParser:false', { path: String(req.url).split('?')[0] });
        throw new errors_1.AppError(500, 'server_error', 'Terjadi kesalahan di server. Coba lagi sebentar lagi.');
    }
    if (o.body === 'none')
        return {};
    if (o.body === 'raw') {
        const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
        if (o.types && !o.types.includes(type))
            return {};
        return (0, http_1.readBody)(req, o.maxBytes);
    }
    return (0, http_1.readJson)(req, o.maxBytes || JSON_MAX);
}
function route(opts, handler) {
    const o = { method: 'POST', session: true, auth: null, csrf: null, limits: [], body: 'json', maxBytes: 0, types: null, ...opts };
    const methods = [].concat(o.method).map((m) => m.toUpperCase());
    const csrf = o.csrf === null ? o.session : o.csrf;
    return async function apiRoute(req, res) {
        try {
            res.setHeader('Cache-Control', 'no-store');
            (0, net_1.ensureIp)(req);
            if (!methods.includes(req.method || '')) {
                res.setHeader('Allow', methods.join(', '));
                throw new errors_1.AppError(405, 'method_not_allowed', 'Metode tidak diizinkan.');
            }
            if (o.session) {
                await auth.attach(req, res);
                if (csrf)
                    auth.csrfGuard(req);
                await limits_1.lim.api(req, res);
            }
            if (o.auth === 'user')
                auth.requireAuth(req);
            else if (o.auth === 'admin')
                auth.requireAdmin(req);
            for (const l of o.limits)
                await l(req, res);
            req.params = req.query || {};
            req.body = await parseBody(req, o);
            await handler(req, res);
        }
        catch (e) {
            (0, http_1.sendError)(res, e);
        }
    };
}
const adminRoute = (opts, handler) => route({ ...opts, auth: 'admin', limits: [limits_1.lim.admin, ...(opts.limits || [])] }, handler);
exports.adminRoute = adminRoute;
const userRoute = (opts, handler) => route({ ...opts, auth: 'user' }, handler);
exports.userRoute = userRoute;
