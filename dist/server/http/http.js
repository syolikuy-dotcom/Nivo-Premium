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
exports.ip = exports.ok = void 0;
exports.sendJson = sendJson;
exports.toHttpError = toHttpError;
exports.sendError = sendError;
exports.readBody = readBody;
exports.readJson = readJson;
const zod_1 = require("zod");
const errors_1 = require("../core/errors");
const log = __importStar(require("../core/logger"));
const JSON_TYPE = /^application\/json\s*(;|$)/i;
function sendJson(res, status, body) {
    if (res.headersSent) {
        try {
            res.end();
        }
        catch { }
        return;
    }
    const data = JSON.stringify(body);
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Length', Buffer.byteLength(data));
    res.end(data);
}
const ok = (res, data = {}, status = 200) => sendJson(res, status, { ok: true, data });
exports.ok = ok;
function toHttpError(err) {
    if (err instanceof errors_1.AppError)
        return err;
    if (err instanceof zod_1.ZodError)
        return new errors_1.AppError(400, 'invalid_input', err.issues[0]?.message || 'Input tidak valid.');
    log.error('unhandled', { msg: err && err.message, stack: err && err.stack });
    return new errors_1.AppError(500, 'server_error', 'Terjadi kesalahan di server. Coba lagi sebentar lagi.');
}
function sendError(res, err) {
    const e = toHttpError(err);
    sendJson(res, e.status, { ok: false, error: { code: e.code, message: e.message } });
}
const ip = (req) => String(req.ip || '').slice(0, 45);
exports.ip = ip;
function readBody(req, limit) {
    return new Promise((resolve, reject) => {
        const declared = Number(req.headers['content-length']);
        if (Number.isFinite(declared) && declared > limit)
            return reject(new errors_1.AppError(413, 'too_large', 'Data terlalu besar.'));
        const chunks = [];
        let size = 0;
        let done = false;
        const finish = (fn, v) => { if (done)
            return; done = true; req.off('data', onData); req.off('end', onEnd); req.off('error', onErr); req.off('close', onClose); fn(v); };
        const onData = (c) => { size += c.length; if (size > limit)
            return finish(reject, new errors_1.AppError(413, 'too_large', 'Data terlalu besar.')); chunks.push(c); return undefined; };
        const onEnd = () => finish(resolve, Buffer.concat(chunks, size));
        const onErr = (e) => finish(reject, e);
        const onClose = () => { if (!req.complete)
            finish(reject, new errors_1.AppError(400, 'aborted', 'Permintaan terputus.')); };
        req.on('data', onData);
        req.on('end', onEnd);
        req.on('error', onErr);
        req.on('close', onClose);
        return undefined;
    });
}
async function readJson(req, limit) {
    if (!JSON_TYPE.test(String(req.headers['content-type'] || '')))
        return {};
    const buf = await readBody(req, limit);
    if (!buf.length)
        return {};
    let v;
    try {
        v = JSON.parse(buf.toString('utf8'));
    }
    catch {
        throw new errors_1.AppError(400, 'bad_json', 'Format permintaan tidak valid.');
    }
    if (v === null || typeof v !== 'object')
        throw new errors_1.AppError(400, 'bad_json', 'Format permintaan tidak valid.');
    return v;
}
