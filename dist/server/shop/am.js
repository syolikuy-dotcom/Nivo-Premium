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
exports.toView = exports.listForUser = void 0;
exports.buySingle = buySingle;
exports.buyBulk = buyBulk;
exports.verify = verify;
exports.cancel = cancel;
exports.sweep = sweep;
exports.adminRefund = adminRefund;
const db = __importStar(require("../core/db"));
const premku = __importStar(require("./premku"));
const sec = __importStar(require("../auth/security"));
const bal = __importStar(require("./balance"));
const settings = __importStar(require("../core/settings"));
const log = __importStar(require("../core/logger"));
const premku_1 = require("./premku");
const errors_1 = require("../core/errors");
const locks_1 = require("../core/locks");
const byNo = (no) => db.one('SELECT * FROM am_orders WHERE order_no = ?', [no]);
const byId = async (id) => (await db.one('SELECT * FROM am_orders WHERE id = ?', [id]));
const INSERT = "INSERT INTO am_orders (order_no,user_id,kind,email,qty,unit_price,total,status,idem_key) VALUES (?,?,?,?,?,?,?,'processing',?)";
async function _refund(o, reason, toStatus = 'failed') {
    await db.tx(async (t) => {
        const r = await t.query("UPDATE am_orders SET status=?, fail_reason=?, refunded_at=? WHERE id=? AND status IN ('processing','pending_verify','review') AND refunded_at IS NULL", [toStatus, String(reason).slice(0, 250), new Date(), o.id]);
        if (r.affectedRows === 1)
            await bal.apply(t, { userId: o.user_id, amount: Number(o.total), type: 'refund', refType: 'am', refId: o.order_no, note: `Refund ${o.order_no}` });
    });
    return byId(o.id);
}
async function _create({ user, kind, email, qty, idemKey }) {
    const reuse = (p) => {
        if (p.kind !== kind || p.qty !== qty || (p.email || null) !== (email || null))
            throw new errors_1.AppError(409, 'idempotency_conflict', 'Permintaan ini sudah dipakai untuk pesanan lain. Muat ulang halaman.');
        return p;
    };
    const prior = await db.one('SELECT * FROM am_orders WHERE user_id = ? AND idem_key = ?', [user.id, idemKey]);
    if (prior)
        return { order: reuse(prior), fresh: false };
    const s = await settings.get();
    const unit = s.am_price;
    const total = unit * qty;
    if (kind === 'single') {
        const n = await db.one("SELECT COUNT(*) AS n FROM am_orders WHERE user_id = ? AND kind='single' AND status IN ('processing','pending_verify')", [user.id]);
        if (Number(n.n) >= 5)
            throw new errors_1.AppError(429, 'too_many_pending', 'Masih ada pesanan yang belum diverifikasi. Verifikasi atau batalkan dulu.');
    }
    for (let i = 0; i < 4; i++) {
        const no = sec.newNo('AM');
        try {
            await db.tx(async (t) => {
                await bal.apply(t, { userId: user.id, amount: -total, type: 'am', refType: 'am', refId: no, note: kind === 'single' ? 'Order AM eceran' : `Order AM bulk x${qty}` });
                await t.query(INSERT, [no, user.id, kind, email || null, qty, unit, total, idemKey]);
            });
            return { order: (await byNo(no)), fresh: true };
        }
        catch (e) {
            if ((0, errors_1.isDup)(e, 'uq_am_idem'))
                return { order: reuse((await db.one('SELECT * FROM am_orders WHERE user_id = ? AND idem_key = ?', [user.id, idemKey]))), fresh: false };
            if (e instanceof errors_1.AppError && e.code === 'insufficient_balance') {
                const winner = await db.one('SELECT * FROM am_orders WHERE user_id = ? AND idem_key = ?', [user.id, idemKey]);
                if (winner)
                    return { order: reuse(winner), fresh: false };
            }
            if ((0, errors_1.isDup)(e, 'uq_am_no'))
                continue;
            throw e;
        }
    }
    throw new errors_1.AppError(500, 'server_error', 'Gagal membuat nomor pesanan. Coba lagi.');
}
const runSingle = (id) => (0, locks_1.withLock)(`am:${id}`, async () => {
    const o = await byId(id);
    if (!o || o.status !== 'processing')
        return o;
    try {
        const r = await premku.am('buy_single', { email: o.email });
        if (!r.invoice)
            throw new premku_1.PremkuError('ambiguous', 'invoice kosong');
        await db.query("UPDATE am_orders SET status='pending_verify', premku_invoice=? WHERE id=? AND status='processing'", [String(r.invoice).slice(0, 64), o.id]);
    }
    catch (e) {
        if (e instanceof premku_1.PremkuError && e.kind === 'definitive')
            return _refund(o, e.message);
        log.warn('AM single tidak pasti', { order: o.order_no, msg: e.message });
        await db.query("UPDATE am_orders SET status='review', fail_reason=? WHERE id=? AND status='processing'", [`Perlu dicek admin: ${e.message}`.slice(0, 250), o.id]);
    }
    return byId(id);
});
async function buySingle({ user, email, idemKey }) {
    const { order, fresh } = await _create({ user, kind: 'single', email, qty: 1, idemKey });
    return fresh ? runSingle(order.id) : order;
}
async function _owned(user, no, status) {
    const o = await db.one('SELECT * FROM am_orders WHERE order_no = ? AND user_id = ?', [no, user.id]);
    if (!o)
        throw new errors_1.AppError(404, 'not_found', 'Pesanan tidak ditemukan.');
    if (o.kind !== 'single' || o.status !== status)
        throw new errors_1.AppError(409, 'bad_state', 'Pesanan ini tidak bisa diproses di tahap ini.');
    return o;
}
const upstream = (e) => {
    if (e instanceof premku_1.PremkuError && e.kind === 'definitive')
        return new errors_1.AppError(422, 'am_rejected', e.message || 'Permintaan ditolak.');
    return new errors_1.AppError(502, 'try_again', 'Server AM sedang sibuk. Coba lagi sebentar lagi.');
};
async function verify({ user, orderNo, link }) {
    const f = await _owned(user, orderNo, 'pending_verify');
    return (0, locks_1.withLock)(`am:${f.id}`, async () => {
        const o = await byId(f.id);
        if (o.status !== 'pending_verify')
            throw new errors_1.AppError(409, 'bad_state', 'Pesanan ini sudah diproses.');
        try {
            await premku.am('verify_single', { invoice: o.premku_invoice, email: o.email, link });
        }
        catch (e) {
            throw upstream(e);
        }
        await db.query("UPDATE am_orders SET status='success' WHERE id=? AND status='pending_verify'", [o.id]);
        return byId(o.id);
    });
}
async function cancel({ user, orderNo }) {
    const f = await _owned(user, orderNo, 'pending_verify');
    return (0, locks_1.withLock)(`am:${f.id}`, async () => {
        const o = await byId(f.id);
        if (o.status !== 'pending_verify')
            throw new errors_1.AppError(409, 'bad_state', 'Pesanan ini sudah diproses.');
        try {
            await premku.am('cancel_single', { invoice: o.premku_invoice });
        }
        catch (e) {
            throw upstream(e);
        }
        return _refund(o, 'Dibatalkan pengguna', 'canceled');
    });
}
const runBulk = (id) => (0, locks_1.withLock)(`am:${id}`, async () => {
    const o = await byId(id);
    if (!o || o.status !== 'processing' || o.kind !== 'bulk')
        return o;
    await db.query('UPDATE am_orders SET attempts = attempts + 1 WHERE id = ?', [o.id]);
    try {
        const r = await premku.am('buy_bulk', { qty: o.qty, ref_id: o.order_no });
        const rows = (Array.isArray(r.data) ? r.data : []).slice(0, 200)
            .map((x) => ({ email: String(x.email || '').slice(0, 190), link: String(x.link || '').slice(0, 600) })).filter((x) => x.email);
        if (!rows.length)
            throw new premku_1.PremkuError('ambiguous', 'hasil kosong');
        await db.query("UPDATE am_orders SET status='success', premku_invoice=?, result_enc=? WHERE id=? AND status='processing'", [r.invoice ? String(r.invoice).slice(0, 64) : null, sec.encrypt(rows), o.id]);
    }
    catch (e) {
        if (e instanceof premku_1.PremkuError && e.kind === 'definitive')
            return _refund(o, e.message);
        log.warn('AM bulk tertunda', { order: o.order_no, msg: e.message });
        if (o.attempts + 1 >= 8)
            await db.query("UPDATE am_orders SET status='review', fail_reason='Perlu dicek admin' WHERE id=? AND status='processing'", [o.id]);
    }
    return byId(id);
});
async function buyBulk({ user, qty, idemKey }) {
    const { order, fresh } = await _create({ user, kind: 'bulk', email: null, qty, idemKey });
    return fresh ? runBulk(order.id) : order;
}
const toView = (o) => ({
    orderNo: o.order_no, kind: o.kind, email: o.email, qty: o.qty, total: Number(o.total), status: o.status, createdAt: o.created_at,
    refunded: Boolean(o.refunded_at), results: o.kind === 'bulk' && o.status === 'success' ? sec.decrypt(o.result_enc) || [] : null,
});
exports.toView = toView;
const listForUser = async (userId, limit = 30) => (await db.query('SELECT * FROM am_orders WHERE user_id = ? ORDER BY id DESC LIMIT ?', [userId, limit])).map(toView);
exports.listForUser = listForUser;
async function sweep() {
    for (const r of await db.query("SELECT id FROM am_orders WHERE status='processing' AND kind='bulk' AND updated_at < ? ORDER BY id LIMIT 20", [new Date(Date.now() - 20e3)]))
        await runBulk(r.id).catch((e) => log.error('sweep AM gagal', { id: r.id, msg: e.message }));
}
async function adminRefund(orderNo) {
    const o = await byNo(orderNo);
    if (!o || !['review', 'processing'].includes(o.status))
        throw new errors_1.AppError(409, 'not_refundable', 'Pesanan tidak bisa di-refund.');
    return (0, locks_1.withLock)(`am:${o.id}`, async () => {
        const cur = await byId(o.id);
        if (!['review', 'processing'].includes(cur.status))
            throw new errors_1.AppError(409, 'not_refundable', 'Pesanan tidak bisa di-refund.');
        return _refund(cur, 'Refund manual oleh admin');
    });
}
