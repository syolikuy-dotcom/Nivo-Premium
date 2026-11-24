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
exports.ssr = void 0;
exports.run = run;
exports.siteStats = siteStats;
const db = __importStar(require("./core/db"));
const settings = __importStar(require("./core/settings"));
const products = __importStar(require("./shop/products"));
const orders = __importStar(require("./shop/orders"));
const deposits = __importStar(require("./shop/deposits"));
const am = __importStar(require("./shop/am"));
const monitor = __importStar(require("./shop/monitor"));
const twofa = __importStar(require("./auth/twofa"));
const config_1 = require("./core/config");
const sec = __importStar(require("./auth/security"));
const log = __importStar(require("./core/logger"));
const errors_1 = require("./core/errors");
const auth = __importStar(require("./auth/auth"));
const net_1 = require("./http/net");
const singleton_1 = require("./core/singleton");
const clean = (o) => JSON.parse(JSON.stringify(o));
const str = (v, n = 100) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
const num = (v) => { const n = parseInt(String(v), 10); return Number.isFinite(n) && n > 0 ? Math.min(n, 1e9) : 0; };
const NF = { notFound: true };
const toLogin = (ctx) => ({ redirect: `/login?next=${encodeURIComponent(ctx.resolvedUrl || '/dashboard')}` });
const isAdmin = (ctx) => Boolean(ctx.req.user && ctx.req.user.role === 'admin' && (0, net_1.adminIpOk)(ctx.req));
const adminGuard = (ctx) => {
    if (!isAdmin(ctx))
        return NF;
    if (config_1.config.admin.require2fa && !ctx.req.user.twofa)
        return { redirect: '/account?2fa=required' };
    return null;
};
const guestOnly = (ctx) => (ctx.req.user ? { redirect: '/dashboard' } : null);
const startOfDayWIB = () => { const d = new Date(Date.now() + 7 * 3600e3); d.setUTCHours(0, 0, 0, 0); return new Date(d.getTime() - 7 * 3600e3); };
const SORTS = ['new', 'price_asc', 'price_desc', 'name'];
const STATUSES = ['pending', 'paid', 'processing', 'success', 'failed', 'canceled', 'expired'];
const sc = (0, singleton_1.once)('pages.siteStats', () => ({ at: 0, v: null }));
async function siteStats() {
    if (sc.v && Date.now() - sc.at < 30000)
        return sc.v;
    const r = await db.one(`SELECT (SELECT COALESCE(SUM(qty),0) FROM orders WHERE status='success') AS sold,
            (SELECT COUNT(*) FROM orders WHERE status='success') AS trx,
            (SELECT COUNT(*) FROM users) AS users,
            (SELECT COUNT(*) FROM users WHERE created_at >= ?) AS today,
            (SELECT COUNT(DISTINCT user_id) FROM sessions WHERE last_seen_at >= ?) AS online`, [startOfDayWIB(), new Date(Date.now() - 10 * 60e3)]);
    const v = { sold: Number(r.sold), trx: Number(r.trx), users: Number(r.users), today: Number(r.today), online: Number(r.online) };
    sc.at = Date.now();
    sc.v = v;
    return v;
}
const loaders = {
    async home() {
        await products.ensureFresh().catch(() => { });
        const [stats, popular] = await Promise.all([siteStats(), products.list({ limit: 8 })]);
        return { shell: 'store', stats, popular: popular.items };
    },
    async catalog(ctx) {
        await products.ensureFresh().catch(() => { });
        const q = ctx.query;
        const sortIn = str(q.sort, 20);
        const f = { q: str(q.q, 60), category: str(q.category, 60), min: num(q.min), max: num(q.max), sort: SORTS.includes(sortIn) ? sortIn : 'new', page: num(q.page) || 1, limit: 24 };
        const [res, cats] = await Promise.all([products.list(f), products.categories()]);
        return { shell: 'store', filters: f, categories: cats, ...res };
    },
    async product(ctx) {
        await products.ensureFresh().catch(() => { });
        const p = await products.bySlug(str(ctx.params?.slug, 120));
        return p ? { shell: 'store', product: p } : NF;
    },
    async checkout(ctx) {
        if (!ctx.req.user)
            return toLogin(ctx);
        const p = await products.bySlug(str(ctx.query.p, 120));
        if (!p)
            return { redirect: '/products' };
        if (!p.available)
            return { redirect: `/products/${p.slug}` };
        const qty = Math.max(1, Math.min(num(ctx.query.qty) || 1, 50, p.stock));
        return { shell: 'store', product: p, qty };
    },
    async login(ctx) { return guestOnly(ctx) || { shell: 'store', next: str(ctx.query.next, 300), gerr: str(ctx.query.ge, 20) }; },
    async register(ctx) { return guestOnly(ctx) || { shell: 'store' }; },
    async forgot(ctx) { return guestOnly(ctx) || { shell: 'store' }; },
    async reset(ctx) { return guestOnly(ctx) || { shell: 'store', token: str(ctx.query.token, 80) }; },
    async dashboard(ctx) {
        const u = ctx.req.user;
        if (!u)
            return toLogin(ctx);
        const [row, agg, recent, stats] = await Promise.all([
            db.one('SELECT created_at, last_login_at FROM users WHERE id = ?', [u.id]),
            db.one("SELECT COALESCE(SUM(CASE WHEN status='success' THEN total END),0) AS spent, COALESCE(SUM(status='success'),0) AS ok, COALESCE(SUM(status='pending'),0) AS waiting FROM orders WHERE user_id = ?", [u.id]),
            orders.listForUser(u.id, 5), siteStats(),
        ]);
        return { shell: 'app', title: 'Dashboard', since: row.created_at, lastLogin: row.last_login_at, spent: Number(agg.spent), ok: Number(agg.ok), waiting: Number(agg.waiting), recent, stats };
    },
    async account(ctx) {
        const u = ctx.req.user;
        if (!u)
            return toLogin(ctx);
        const row = await db.one('SELECT created_at, google_sub IS NOT NULL AS linked FROM users WHERE id = ?', [u.id]);
        const google = { enabled: config_1.config.google.enabled, linked: Boolean(Number(row.linked)), flash: str(ctx.query.google, 20) };
        return { shell: 'app', title: 'Akun saya', joined: row.created_at, twofa: await twofa.view(u), google };
    },
    async orders(ctx) {
        const u = ctx.req.user;
        if (!u)
            return toLogin(ctx);
        const sIn = str(ctx.query.status, 20);
        const filters = { status: STATUSES.includes(sIn) ? sIn : '', q: str(ctx.query.q, 60), page: num(ctx.query.page) || 1 };
        const r = await orders.listPage(u.id, { ...filters, limit: 15 });
        return { shell: 'app', title: 'Pesanan saya', list: r.items, filters: { ...filters, page: r.page }, total: r.total, pages: r.pages, counts: r.counts };
    },
    async order(ctx) {
        const u = ctx.req.user;
        if (!u)
            return toLogin(ctx);
        const no = str(ctx.params?.orderNo, 20);
        if (!/^PT\d{6}[0-9A-F]{6}$/.test(no))
            return NF;
        const o = await orders.getForUser(u, no);
        return o ? { shell: 'app', title: 'Status transaksi', order: o } : NF;
    },
    async deposit(ctx, s) {
        const u = ctx.req.user;
        if (!u)
            return toLogin(ctx);
        return { shell: 'app', title: 'Deposit', list: await deposits.listForUser(u.id, 20), limits: { min: s.min_deposit, max: s.max_deposit } };
    },
    async depositView(ctx) {
        const u = ctx.req.user;
        if (!u)
            return toLogin(ctx);
        const no = str(ctx.params?.no, 20);
        if (!/^DP\d{6}[0-9A-F]{6}$/.test(no))
            return NF;
        const d = await deposits.getForUser(u, no);
        return d ? { shell: 'app', title: 'Status deposit', deposit: d } : NF;
    },
    async am(ctx, s) {
        const u = ctx.req.user;
        if (!u)
            return toLogin(ctx);
        const history = await am.listForUser(u.id, 30);
        const tabIn = str(ctx.query.tab, 10);
        const tab = ['single', 'bulk', 'history'].includes(tabIn) ? tabIn : 'single';
        return { shell: 'app', title: 'Order Akun AM', tab, price: s.am_price, pending: history.filter((h) => h.status === 'pending_verify'), history };
    },
    async adminHome(ctx) {
        {
            const g = adminGuard(ctx);
            if (g)
                return g;
        }
        const [agg, attn, amReview, stats] = await Promise.all([
            db.one("SELECT COALESCE(SUM(CASE WHEN status='success' THEN total END),0) AS revenue, COALESCE(SUM(status='success'),0) AS ok, COALESCE(SUM(status IN ('paid','processing')),0) AS inflight FROM orders"),
            db.query("SELECT o.order_no, o.product_name, o.total, o.status, o.fail_reason, o.attempts, o.created_at, u.username FROM orders o JOIN users u ON u.id = o.user_id WHERE o.status IN ('paid','processing') OR (o.status='failed' AND o.refunded_at IS NULL) ORDER BY o.id DESC LIMIT 20"),
            db.query("SELECT a.order_no, a.kind, a.email, a.total, a.status, a.fail_reason, a.created_at, u.username FROM am_orders a JOIN users u ON u.id = a.user_id WHERE a.status = 'review' ORDER BY a.id DESC LIMIT 20"),
            siteStats(),
        ]);
        const health = await monitor.snapshot();
        return { shell: 'app', title: 'Admin', admin: true, revenue: Number(agg.revenue), ok: Number(agg.ok), inflight: Number(agg.inflight), attn, amReview, stats, health };
    },
    async adminProducts(ctx) {
        {
            const g = adminGuard(ctx);
            if (g)
                return g;
        }
        const q = str(ctx.query.q, 60);
        const rows = await db.query(`SELECT id, slug, premku_id, name, category, description, image_url, cost, price, price_locked, stock, active FROM products ${q ? 'WHERE name LIKE ?' : ''} ORDER BY id DESC LIMIT 100`, q ? [`%${sec.escapeLike(q)}%`] : []);
        return { shell: 'app', title: 'Admin · Produk', admin: true, q, rows: rows.map((r) => ({ ...r, cost: Number(r.cost), price: Number(r.price), price_locked: !!r.price_locked, active: !!r.active })) };
    },
    async adminUsers(ctx) {
        {
            const g = adminGuard(ctx);
            if (g)
                return g;
        }
        const q = str(ctx.query.q, 60);
        const like = `%${sec.escapeLike(q)}%`;
        const rows = await db.query(`SELECT id, username, email, name, role, status, balance, last_login_at, created_at FROM users ${q ? 'WHERE username LIKE ? OR email LIKE ?' : ''} ORDER BY id DESC LIMIT 100`, q ? [like, like] : []);
        return { shell: 'app', title: 'Admin · Pengguna', admin: true, q, rows: rows.map((r) => ({ ...r, balance: Number(r.balance) })) };
    },
    async adminOrders(ctx) {
        {
            const g = adminGuard(ctx);
            if (g)
                return g;
        }
        const sIn = str(ctx.query.status, 20);
        const status = STATUSES.includes(sIn) ? sIn : '';
        const rows = await db.query(`SELECT o.order_no, o.product_name, o.qty, o.total, o.pay_method, o.status, o.fail_reason, o.attempts, o.refunded_at, o.created_at, u.username FROM orders o JOIN users u ON u.id = o.user_id ${status ? 'WHERE o.status = ?' : ''} ORDER BY o.id DESC LIMIT 100`, status ? [status] : []);
        return { shell: 'app', title: 'Admin · Pesanan', admin: true, status, rows: rows.map((r) => ({ ...r, total: Number(r.total), refunded: !!r.refunded_at, refunded_at: undefined })) };
    },
    async adminSettings(ctx, s) {
        {
            const g = adminGuard(ctx);
            if (g)
                return g;
        }
        return { shell: 'app', title: 'Admin · Pengaturan', admin: true, s };
    },
};
async function run(name, ctx) {
    const fn = loaders[name];
    if (!fn)
        throw new errors_1.AppError(500, 'no_loader', `Loader ${name} tidak ada`);
    const s = await settings.get();
    let out;
    try {
        out = await fn(ctx, s);
    }
    catch (e) {
        log.error('loader gagal', { name, msg: e.message });
        throw e;
    }
    if ('redirect' in out)
        return { redirect: { destination: out.redirect, permanent: false } };
    if ('notFound' in out)
        return { notFound: true };
    const u = ctx.req.user;
    const props = clean({ ...out, user: u ? { id: u.id, name: u.name, username: u.username, email: u.email, role: u.role, balance: u.balance, twofa: u.twofa } : null, site: settings.publicSite(s), csrf: ctx.req.csrfToken });
    return { props: props };
}
const ssr = (name) => async (ctx) => {
    (0, net_1.ensureIp)(ctx.req);
    await auth.attach(ctx.req, ctx.res);
    return run(name, ctx);
};
exports.ssr = ssr;
