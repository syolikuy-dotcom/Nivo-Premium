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
exports.webhook = webhook;
const crypto = __importStar(require("crypto"));
const sec = __importStar(require("../auth/security"));
const db = __importStar(require("../core/db"));
const config_1 = require("../core/config");
const premku = __importStar(require("./premku"));
const orders = __importStar(require("./orders"));
const log = __importStar(require("../core/logger"));
const audit_1 = require("../core/audit");
const errors_1 = require("../core/errors");
const http_1 = require("../http/http");
async function webhook(req, res) {
    try {
        if (!config_1.config.premku.apiSecret)
            return (0, http_1.sendJson)(res, 503, { ok: false });
        const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
        const given = String(req.headers['x-premku-signature'] || '');
        const want = crypto.createHmac('sha256', config_1.config.premku.apiSecret).update(raw).digest('hex');
        if (!given || !sec.safeEqual(given, want))
            return (0, http_1.sendJson)(res, 403, { ok: false });
        let body;
        try {
            body = JSON.parse(raw.toString('utf8'));
        }
        catch {
            return (0, http_1.sendJson)(res, 400, { ok: false });
        }
        const d = body && body.data;
        if (!body || body.event !== 'order.success' || !d || typeof d.ref_id !== 'string')
            return (0, http_1.sendJson)(res, 200, { received: true, ignored: true });
        const key = sec.sha256(`${body.event}|${d.invoice}|${d.ref_id}`);
        try {
            await db.query('INSERT INTO webhook_events (dedupe_key, event, ref_id) VALUES (?,?,?)', [key, body.event, d.ref_id.slice(0, 64)]);
        }
        catch (e) {
            if ((0, errors_1.isDup)(e))
                return (0, http_1.sendJson)(res, 200, { received: true, duplicate: true });
            throw e;
        }
        const work = (async () => {
            try {
                const result = await orders.applyWebhookSuccess({ refId: d.ref_id, invoice: d.invoice, qty: Number(d.qty), accounts: premku.extractAccounts(body) });
                if (result === 'conflict' || result === 'mismatch')
                    await (0, audit_1.audit)(null, `webhook_${result}`, req, { ref: d.ref_id, invoice: d.invoice });
                log.info('webhook diproses', { ref: d.ref_id, result });
            }
            catch (e) {
                await db.query('DELETE FROM webhook_events WHERE dedupe_key = ?', [key]).catch((x) => log.error('hapus penanda webhook gagal', { msg: x.message }));
                throw e;
            }
        })();
        let timer;
        const first = await Promise.race([
            work.then(() => 'done', (e) => { log.error('webhook error', { msg: e.message }); return 'error'; }),
            new Promise((r) => { timer = setTimeout(() => r('slow'), 3000); }),
        ]);
        if (timer)
            clearTimeout(timer);
        if (first === 'error')
            return (0, http_1.sendJson)(res, 500, { ok: false });
        if (first === 'slow') {
            work.catch(() => { });
            return (0, http_1.sendJson)(res, 200, { received: true, queued: true });
        }
        return (0, http_1.sendJson)(res, 200, { received: true });
    }
    catch (e) {
        log.error('webhook error', { msg: e.message });
        return (0, http_1.sendJson)(res, 500, { ok: false });
    }
}
