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
exports.recipients = exports.notifyAdmins = void 0;
exports.snapshot = snapshot;
exports.check = check;
exports.liveness = liveness;
const db = __importStar(require("../core/db"));
const premku = __importStar(require("./premku"));
const orders_1 = require("./orders");
const settings = __importStar(require("../core/settings"));
const mailer = __importStar(require("../auth/mailer"));
const admin_notice_1 = require("../auth/admin-notice");
Object.defineProperty(exports, "recipients", { enumerable: true, get: function () { return admin_notice_1.recipients; } });
Object.defineProperty(exports, "notifyAdmins", { enumerable: true, get: function () { return admin_notice_1.notifyAdmins; } });
const sec = __importStar(require("../auth/security"));
const log = __importStar(require("../core/logger"));
const heartbeat = __importStar(require("../core/heartbeat"));
const config_1 = require("../core/config");
const singleton_1 = require("../core/singleton");
const format_1 = require("../../shared/format");
const PROFILE_EVERY_MS = 5 * 60e3;
const PROFILE_MIN_MS = 15e3;
const DOWN_GRACE_MS = 3 * 60e3;
const M = (0, singleton_1.once)('monitor.state', () => ({
    lastProfileAt: 0, checking: false,
    cache: null,
    lastTry: {},
}));
async function stuckOrders(minutes) {
    const cutoff = new Date(Date.now() - minutes * 60e3);
    const [o, a, oc, ac] = await Promise.all([
        db.query(`SELECT o.order_no, o.product_name, o.status, o.fail_reason, COALESCE(o.paid_at, o.created_at) AS since, u.username
                FROM orders o JOIN users u ON u.id = o.user_id
               WHERE o.status IN ('paid','processing') AND (COALESCE(o.paid_at, o.created_at) < ? OR o.attempts >= ?) ORDER BY o.id LIMIT 30`, [cutoff, orders_1.MAX_ATTEMPTS]),
        db.query(`SELECT a.order_no, a.kind, a.email, a.status, a.fail_reason, a.created_at AS since, u.username
                FROM am_orders a JOIN users u ON u.id = a.user_id
               WHERE a.status = 'review' OR (a.status = 'processing' AND a.updated_at < ?) ORDER BY a.id LIMIT 30`, [cutoff]),
        db.one("SELECT COUNT(*) AS n FROM orders WHERE status IN ('paid','processing') AND (COALESCE(paid_at, created_at) < ? OR attempts >= ?)", [cutoff, orders_1.MAX_ATTEMPTS]),
        db.one("SELECT COUNT(*) AS n FROM am_orders WHERE status = 'review' OR (status = 'processing' AND updated_at < ?)", [cutoff]),
    ]);
    const mins = (d) => Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / 60e3));
    const rows = [
        ...o.map((r) => ({ kind: 'order', no: r.order_no, product: r.product_name, status: r.status, minutes: mins(r.since), reason: r.fail_reason, username: r.username })),
        ...a.map((r) => ({ kind: 'am', no: r.order_no, product: r.kind === 'bulk' ? 'Akun AM (bulk)' : `Akun AM ${r.email || ''}`.trim(), status: r.status, minutes: mins(r.since), reason: r.fail_reason, username: r.username })),
    ];
    return { total: Number(oc.n) + Number(ac.n), rows };
}
async function refreshSupplier(force = false) {
    if (!config_1.config.premku.apiKey)
        return;
    const age = Date.now() - M.lastProfileAt;
    if (age < (force ? PROFILE_MIN_MS : PROFILE_EVERY_MS))
        return;
    M.lastProfileAt = Date.now();
    await premku.profile().catch(() => { });
}
const iso = (ms) => (ms ? new Date(ms).toISOString() : null);
async function collect() {
    const s = await settings.get();
    const h = premku.health();
    const bal = premku.lastBalance();
    const [stuck, alerts, adm, to] = await Promise.all([
        stuckOrders(s.stuck_minutes),
        db.query('SELECT k, state, since, last_sent_at, detail FROM alert_state ORDER BY k'),
        db.one("SELECT COUNT(*) AS total, COALESCE(SUM(totp_enabled), 0) AS with2fa FROM users WHERE role = 'admin' AND status = 'active'"),
        (0, admin_notice_1.recipients)(),
    ]);
    const hb = heartbeat.get();
    return {
        at: new Date().toISOString(),
        supplier: { state: h.state, saldo: bal ? bal.value : null, saldoAt: bal ? iso(bal.at) : null, lastOkAt: iso(h.lastOkAt), lastError: h.lastError, failures: h.consecutiveFailures, breakerOpen: h.breakerOpen, queued: h.queued },
        threshold: s.low_balance_threshold,
        lowBalance: s.low_balance_threshold > 0 && bal !== null && bal.value < s.low_balance_threshold,
        stuck: { total: stuck.total, rows: stuck.rows, minutes: s.stuck_minutes },
        worker: { lastTickAt: iso(hb.lastTickAt), stale: hb.stale },
        smtp: mailer.smtpEnabled(), alertRecipients: mailer.smtpEnabled() ? to.length : 0,
        alerts: alerts.map((r) => ({ key: r.k, state: r.state, since: r.since ? new Date(r.since).toISOString() : null, lastSentAt: r.last_sent_at ? new Date(r.last_sent_at).toISOString() : null, detail: r.detail })),
        admins: { total: Number(adm.total), with2fa: Number(adm.with2fa) },
    };
}
async function snapshot({ refresh = false } = {}) {
    await refreshSupplier(refresh);
    if (!refresh && M.cache && Date.now() - M.cache.at < 20e3)
        return M.cache.v;
    const v = await collect();
    M.cache = { at: Date.now(), v };
    return v;
}
async function raise(a) {
    const row = await db.one('SELECT state, fingerprint, last_sent_at, since FROM alert_state WHERE k = ?', [a.key]);
    const was = Boolean(row && row.state === 'firing');
    if (a.firing) {
        const sentAgo = row && row.last_sent_at ? Date.now() - new Date(row.last_sent_at).getTime() : Infinity;
        const changed = was && row.fingerprint !== a.fingerprint;
        const due = !was || sentAgo >= a.reminderMs || (changed && sentAgo >= a.minGapMs);
        if (!due)
            return;
        if (was && Date.now() - (M.lastTry[a.key] || 0) < 5 * 60e3 && !changed)
            return;
        M.lastTry[a.key] = Date.now();
        const d = await (0, admin_notice_1.deliver)(a.subject, a.body);
        const sentAt = d === 'failed' ? null : new Date();
        await db.query("INSERT INTO alert_state (k, state, fingerprint, last_sent_at, detail, since) VALUES (?, 'firing', ?, ?, ?, ?) ON DUPLICATE KEY UPDATE state = 'firing', fingerprint = VALUES(fingerprint), last_sent_at = VALUES(last_sent_at), detail = VALUES(detail), since = IF(?, since, VALUES(since))", [a.key, a.fingerprint, sentAt, a.detail.slice(0, 250), new Date(), was ? 1 : 0]);
    }
    else if (was) {
        await (0, admin_notice_1.deliver)(a.recovered.subject, a.recovered.body, 'info');
        await db.query("UPDATE alert_state SET state = 'ok', fingerprint = NULL, detail = ?, since = NULL WHERE k = ?", [a.recovered.subject.slice(0, 250), a.key]);
    }
}
const hours = (n) => n * 3600e3;
async function evaluate(v) {
    const url = `${config_1.config.appUrl}/admin`;
    const sup = v.supplier;
    await raise({
        key: 'supplier_balance', firing: v.lowBalance, fingerprint: 'low', reminderMs: hours(6), minGapMs: 0,
        subject: 'Saldo Premku menipis',
        body: [
            'Saldo Premku di bawah batas alert.', '',
            `Saldo saat ini : ${sup.saldo === null ? '-' : (0, format_1.rupiah)(sup.saldo)}`, `Batas alert    : ${(0, format_1.rupiah)(v.threshold)}`, '',
            'Segera top up di dashboard Premku. Bila saldo habis, supplier menolak pesanan yang sudah dibayar pembeli dan sistem otomatis me-refund ke saldo pembeli.',
            `Ringkasan: ${url}`,
        ].join('\n'),
        recovered: { subject: 'Saldo Premku pulih', body: `Saldo Premku kembali di atas batas alert (${sup.saldo === null ? '-' : (0, format_1.rupiah)(sup.saldo)}).` },
        detail: `Saldo ${sup.saldo === null ? '-' : (0, format_1.rupiah)(sup.saldo)} < ${(0, format_1.rupiah)(v.threshold)}`,
    });
    const bad = (sup.state === 'down' || sup.state === 'auth');
    const sinceMs = premku.health().since;
    await raise({
        key: 'supplier_down', firing: bad && Date.now() - sinceMs >= DOWN_GRACE_MS, fingerprint: sup.state, reminderMs: hours(2), minGapMs: 0,
        subject: sup.state === 'auth' ? 'Premku menolak API key / IP server' : 'Premku tidak dapat dihubungi',
        body: [
            sup.state === 'auth' ? 'Premku menolak permintaan (API key salah atau IP server belum di-whitelist).' : 'Premku terdeteksi gangguan (down / tidak merespons).', '',
            `Sejak          : ${(0, format_1.dateTime)(sinceMs)} WIB`, `Terakhir sehat : ${sup.lastOkAt ? `${(0, format_1.dateTime)(sup.lastOkAt)} WIB` : '-'}`, `Galat terakhir : ${sup.lastError || '-'}`, `Gagal berturut : ${sup.failures}`, '',
            sup.state === 'auth'
                ? 'Periksa PREMKU_API_KEY di .env dan daftarkan IP server di IP Whitelist profil Premku.'
                : 'Pesanan yang sudah dibayar tetap aman: sistem mencoba ulang otomatis dengan ref_id yang sama (saldo tidak terpotong dua kali) begitu Premku pulih.',
            `Ringkasan: ${url}`,
        ].join('\n'),
        recovered: { subject: 'Premku pulih', body: 'Premku kembali merespons normal. Pesanan tertunda diproses otomatis.' },
        detail: `${sup.state}: ${sup.lastError || '-'}`,
    });
    const lines = v.stuck.rows.slice(0, 15).map((r) => `- ${r.no}  ${r.product}  [${r.status}]  @${r.username}  ${r.minutes} mnt${r.reason ? `  (${r.reason})` : ''}`);
    const fp = sec.sha256(v.stuck.rows.map((r) => r.no).sort().join(',')).slice(0, 16);
    await raise({
        key: 'orders_stuck', firing: v.stuck.total > 0, fingerprint: fp, reminderMs: hours(3), minGapMs: 15 * 60e3,
        subject: `${v.stuck.total} pesanan macet`,
        body: [
            `${v.stuck.total} pesanan sudah dibayar tetapi belum terkirim > ${v.stuck.minutes} menit, atau butuh dicek admin:`, '', ...lines,
            v.stuck.total > lines.length ? `… dan ${v.stuck.total - lines.length} lainnya` : '', '',
            'Buka Admin → Ringkasan untuk “Coba lagi” atau Refund. Pastikan dulu di dashboard Premku bahwa supplier belum mengirim akun sebelum refund.',
            `Ringkasan: ${url}`,
        ].filter((x, i, arr) => x !== '' || arr[i - 1] !== '').join('\n'),
        recovered: { subject: 'Tidak ada pesanan macet', body: 'Semua pesanan yang tertahan sudah terkirim atau ditangani.' },
        detail: `${v.stuck.total} pesanan macet`,
    });
}
async function check() {
    if (M.checking)
        return;
    M.checking = true;
    try {
        await refreshSupplier(false);
        const v = await collect();
        M.cache = { at: Date.now(), v };
        await evaluate(v);
    }
    catch (e) {
        log.error('monitor gagal', { msg: e.message });
    }
    finally {
        M.checking = false;
    }
}
async function liveness() {
    let dbOk = false;
    try {
        await db.one('SELECT 1 AS ok');
        dbOk = true;
    }
    catch { }
    const hb = heartbeat.get(300e3);
    return { ok: dbOk && !hb.stale, db: dbOk, worker: !hb.stale };
}
