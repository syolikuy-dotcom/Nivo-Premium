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
exports.MAX_TRIES = void 0;
exports.sendOrderConfirmation = sendOrderConfirmation;
exports.queue = queue;
exports.sweep = sweep;
const db = __importStar(require("../core/db"));
const mailer = __importStar(require("../auth/mailer"));
const settings = __importStar(require("../core/settings"));
const log = __importStar(require("../core/logger"));
const MAX_TRIES = 3;
exports.MAX_TRIES = MAX_TRIES;
async function sendOrderConfirmation(orderId) {
    if (!mailer.smtpEnabled())
        return 'skipped';
    const claimed = await db.query("UPDATE orders SET notified_at = ? WHERE id = ? AND status = 'success' AND notified_at IS NULL AND notify_tries < ?", [new Date(), orderId, MAX_TRIES]);
    if (claimed.affectedRows !== 1)
        return 'noop';
    let no = String(orderId);
    try {
        const o = await db.one('SELECT o.order_no, o.product_name, o.qty, o.total, o.pay_method, o.completed_at, u.email, u.name FROM orders o JOIN users u ON u.id = o.user_id WHERE o.id = ?', [orderId]);
        if (!o)
            return 'noop';
        no = o.order_no;
        const s = await settings.get();
        const sent = await mailer.sendOrderConfirmation({ to: o.email, name: o.name, siteName: s.site_name, orderNo: o.order_no, product: o.product_name, qty: o.qty, total: Number(o.total), method: o.pay_method, completedAt: o.completed_at });
        if (!sent)
            throw new Error('SMTP tidak aktif');
        return 'sent';
    }
    catch (e) {
        await db.query('UPDATE orders SET notified_at = NULL, notify_tries = notify_tries + 1 WHERE id = ?', [orderId]).catch(() => { });
        log.warn('email konfirmasi pesanan gagal', { order: no, msg: e.message });
        return 'failed';
    }
}
function queue(orderId) {
    if (!mailer.smtpEnabled())
        return;
    setImmediate(() => { sendOrderConfirmation(orderId).catch((e) => log.error('notify error', { msg: e.message })); });
}
async function sweep() {
    if (!mailer.smtpEnabled())
        return;
    const rows = await db.query("SELECT id FROM orders WHERE status = 'success' AND notified_at IS NULL AND notify_tries < ? AND completed_at > ? AND (notify_tries = 0 OR updated_at < ?) ORDER BY id LIMIT 20", [MAX_TRIES, new Date(Date.now() - 2 * 3600e3), new Date(Date.now() - 120e3)]);
    for (const r of rows)
        await sendOrderConfirmation(r.id);
}
