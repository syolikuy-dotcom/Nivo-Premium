import type { GetServerSideProps, GetServerSidePropsContext, GetServerSidePropsResult } from 'next';
import * as db from './core/db';
import type { Row } from './core/db';
import * as settings from './core/settings';
import * as products from './shop/products';
import * as orders from './shop/orders';
import * as deposits from './shop/deposits';
import * as am from './shop/am';
import * as monitor from './shop/monitor';
import * as twofa from './auth/twofa';
import { config } from './core/config';
import * as sec from './auth/security';
import * as log from './core/logger';
import { AppError } from './core/errors';
import * as auth from './auth/auth';
import { ensureIp, adminIpOk } from './http/net';
import { once } from './core/singleton';
import type {
  SiteSettings, SiteStats, CatalogFilters, OrderFilters, HomeProps, CatalogProps, ProductProps, CheckoutProps, LoginProps, RegisterProps, ForgotProps, ResetProps,
  DashboardProps, AccountProps, OrdersProps, OrderProps, DepositProps, DepositViewProps, AmProps,
  AdminHomeProps, AdminProductsProps, AdminUsersProps, AdminOrdersProps, AdminSettingsProps,
} from '../shared/types';

type Ctx = GetServerSidePropsContext;
interface Redirect { redirect: string }
interface NotFound { notFound: true }
type Data<P> = Omit<P, 'user' | 'site' | 'csrf'>;

interface Registry {
  home: HomeProps; catalog: CatalogProps; product: ProductProps; checkout: CheckoutProps;
  login: LoginProps; register: RegisterProps; forgot: ForgotProps; reset: ResetProps;
  dashboard: DashboardProps; account: AccountProps; orders: OrdersProps; order: OrderProps;
  deposit: DepositProps; depositView: DepositViewProps; am: AmProps;
  adminHome: AdminHomeProps; adminProducts: AdminProductsProps; adminUsers: AdminUsersProps; adminOrders: AdminOrdersProps; adminSettings: AdminSettingsProps;
}
type Loaders = { [K in keyof Registry]: (ctx: Ctx, s: SiteSettings) => Promise<Data<Registry[K]> | Redirect | NotFound> };

const clean = (o: unknown) => JSON.parse(JSON.stringify(o));
const str = (v: unknown, n = 100): string => (typeof v === 'string' ? v.trim().slice(0, n) : '');
const num = (v: unknown): number => { const n = parseInt(String(v), 10); return Number.isFinite(n) && n > 0 ? Math.min(n, 1e9) : 0; };
const NF: NotFound = { notFound: true };
const toLogin = (ctx: Ctx): Redirect => ({ redirect: `/login?next=${encodeURIComponent(ctx.resolvedUrl || '/dashboard')}` });
const isAdmin = (ctx: Ctx): boolean => Boolean(ctx.req.user && ctx.req.user.role === 'admin' && adminIpOk(ctx.req));
const adminGuard = (ctx: Ctx): Redirect | NotFound | null => {
  if (!isAdmin(ctx)) return NF;
  if (config.admin.require2fa && !(ctx.req.user as { twofa: boolean }).twofa) return { redirect: '/account?2fa=required' };
  return null;
};
const guestOnly = (ctx: Ctx): Redirect | null => (ctx.req.user ? { redirect: '/dashboard' } : null);
const startOfDayWIB = () => { const d = new Date(Date.now() + 7 * 3600e3); d.setUTCHours(0, 0, 0, 0); return new Date(d.getTime() - 7 * 3600e3); };
const SORTS: CatalogFilters['sort'][] = ['new', 'price_asc', 'price_desc', 'name'];
const STATUSES = ['pending', 'paid', 'processing', 'success', 'failed', 'canceled', 'expired'];

const sc = once('pages.siteStats', () => ({ at: 0, v: null as SiteStats | null }));
async function siteStats(): Promise<SiteStats> {
  if (sc.v && Date.now() - sc.at < 30000) return sc.v;
  const r = await db.one(
    `SELECT (SELECT COALESCE(SUM(qty),0) FROM orders WHERE status='success') AS sold,
            (SELECT COUNT(*) FROM orders WHERE status='success') AS trx,
            (SELECT COUNT(*) FROM users) AS users,
            (SELECT COUNT(*) FROM users WHERE created_at >= ?) AS today,
            (SELECT COUNT(DISTINCT user_id) FROM sessions WHERE last_seen_at >= ?) AS online`,
    [startOfDayWIB(), new Date(Date.now() - 10 * 60e3)]);
  const v: SiteStats = { sold: Number(r!.sold), trx: Number(r!.trx), users: Number(r!.users), today: Number(r!.today), online: Number(r!.online) };
  sc.at = Date.now(); sc.v = v;
  return v;
}

const loaders: Loaders = {
  async home() {
    await products.ensureFresh().catch(() => {});
    const [stats, popular] = await Promise.all([siteStats(), products.list({ limit: 8 })]);
    return { shell: 'store' as const, stats, popular: popular.items };
  },
  async catalog(ctx: GetServerSidePropsContext) {
    await products.ensureFresh().catch(() => {});
    const q = ctx.query;
    const sortIn = str(q.sort, 20) as CatalogFilters['sort'];
    const f: CatalogFilters = { q: str(q.q, 60), category: str(q.category, 60), min: num(q.min), max: num(q.max), sort: SORTS.includes(sortIn) ? sortIn : 'new', page: num(q.page) || 1, limit: 24 };
    const [res, cats] = await Promise.all([products.list(f), products.categories()]);
    return { shell: 'store' as const, filters: f, categories: cats, ...res };
  },
  async product(ctx: GetServerSidePropsContext) {
    await products.ensureFresh().catch(() => {});
    const p = await products.bySlug(str(ctx.params?.slug, 120));
    return p ? { shell: 'store' as const, product: p } : NF;
  },
  async checkout(ctx: GetServerSidePropsContext) {
    if (!ctx.req.user) return toLogin(ctx);
    const p = await products.bySlug(str(ctx.query.p, 120));
    if (!p) return { redirect: '/products' };
    if (!p.available) return { redirect: `/products/${p.slug}` };
    const qty = Math.max(1, Math.min(num(ctx.query.qty) || 1, 50, p.stock));
    return { shell: 'store' as const, product: p, qty };
  },
  async login(ctx: GetServerSidePropsContext) { return guestOnly(ctx) || { shell: 'store' as const, next: str(ctx.query.next, 300), gerr: str(ctx.query.ge, 20) }; },
  async register(ctx: GetServerSidePropsContext) { return guestOnly(ctx) || { shell: 'store' as const }; },
  async forgot(ctx: GetServerSidePropsContext) { return guestOnly(ctx) || { shell: 'store' as const }; },
  async reset(ctx: GetServerSidePropsContext) { return guestOnly(ctx) || { shell: 'store' as const, token: str(ctx.query.token, 80) }; },

  async dashboard(ctx: GetServerSidePropsContext) {
    const u = ctx.req.user; if (!u) return toLogin(ctx);
    const [row, agg, recent, stats] = await Promise.all([
      db.one('SELECT created_at, last_login_at FROM users WHERE id = ?', [u.id]),
      db.one("SELECT COALESCE(SUM(CASE WHEN status='success' THEN total END),0) AS spent, COALESCE(SUM(status='success'),0) AS ok, COALESCE(SUM(status='pending'),0) AS waiting FROM orders WHERE user_id = ?", [u.id]),
      orders.listForUser(u.id, 5), siteStats(),
    ]);
    return { shell: 'app' as const, title: 'Dashboard', since: row!.created_at, lastLogin: row!.last_login_at, spent: Number(agg!.spent), ok: Number(agg!.ok), waiting: Number(agg!.waiting), recent, stats };
  },
  async account(ctx: GetServerSidePropsContext) {
    const u = ctx.req.user; if (!u) return toLogin(ctx);
    const row = await db.one('SELECT created_at, google_sub IS NOT NULL AS linked FROM users WHERE id = ?', [u.id]);
    const google = { enabled: config.google.enabled, linked: Boolean(Number(row!.linked)), flash: str(ctx.query.google, 20) };
    return { shell: 'app' as const, title: 'Akun saya', joined: row!.created_at, twofa: await twofa.view(u), google };
  },
  async orders(ctx: GetServerSidePropsContext) {
    const u = ctx.req.user; if (!u) return toLogin(ctx);
    const sIn = str(ctx.query.status, 20);
    const filters: OrderFilters = { status: STATUSES.includes(sIn) ? sIn : '', q: str(ctx.query.q, 60), page: num(ctx.query.page) || 1 };
    const r = await orders.listPage(u.id, { ...filters, limit: 15 });
    return { shell: 'app' as const, title: 'Pesanan saya', list: r.items, filters: { ...filters, page: r.page }, total: r.total, pages: r.pages, counts: r.counts };
  },
  async order(ctx: GetServerSidePropsContext) {
    const u = ctx.req.user; if (!u) return toLogin(ctx);
    const no = str(ctx.params?.orderNo, 20);
    if (!/^PT\d{6}[0-9A-F]{6}$/.test(no)) return NF;
    const o = await orders.getForUser(u, no);
    return o ? { shell: 'app' as const, title: 'Status transaksi', order: o } : NF;
  },
  async deposit(ctx: GetServerSidePropsContext, s: SiteSettings) {
    const u = ctx.req.user; if (!u) return toLogin(ctx);
    return { shell: 'app' as const, title: 'Deposit', list: await deposits.listForUser(u.id, 20), limits: { min: s.min_deposit, max: s.max_deposit } };
  },
  async depositView(ctx: GetServerSidePropsContext) {
    const u = ctx.req.user; if (!u) return toLogin(ctx);
    const no = str(ctx.params?.no, 20);
    if (!/^DP\d{6}[0-9A-F]{6}$/.test(no)) return NF;
    const d = await deposits.getForUser(u, no);
    return d ? { shell: 'app' as const, title: 'Status deposit', deposit: d } : NF;
  },
  async am(ctx: GetServerSidePropsContext, s: SiteSettings) {
    const u = ctx.req.user; if (!u) return toLogin(ctx);
    const history = await am.listForUser(u.id, 30);
    const tabIn = str(ctx.query.tab, 10) as AmProps['tab'];
    const tab = ['single', 'bulk', 'history'].includes(tabIn) ? tabIn : 'single';
    return { shell: 'app' as const, title: 'Order Akun AM', tab, price: s.am_price, pending: history.filter((h) => h.status === 'pending_verify'), history };
  },

  async adminHome(ctx: GetServerSidePropsContext) {
    { const g = adminGuard(ctx); if (g) return g; }
    const [agg, attn, amReview, stats] = await Promise.all([
      db.one("SELECT COALESCE(SUM(CASE WHEN status='success' THEN total END),0) AS revenue, COALESCE(SUM(status='success'),0) AS ok, COALESCE(SUM(status IN ('paid','processing')),0) AS inflight FROM orders"),
      db.query("SELECT o.order_no, o.product_name, o.total, o.status, o.fail_reason, o.attempts, o.created_at, u.username FROM orders o JOIN users u ON u.id = o.user_id WHERE o.status IN ('paid','processing') OR (o.status='failed' AND o.refunded_at IS NULL) ORDER BY o.id DESC LIMIT 20"),
      db.query("SELECT a.order_no, a.kind, a.email, a.total, a.status, a.fail_reason, a.created_at, u.username FROM am_orders a JOIN users u ON u.id = a.user_id WHERE a.status = 'review' ORDER BY a.id DESC LIMIT 20"),
      siteStats(),
    ]);
    const health = await monitor.snapshot();
    return { shell: 'app' as const, title: 'Admin', admin: true as const, revenue: Number(agg!.revenue), ok: Number(agg!.ok), inflight: Number(agg!.inflight), attn, amReview, stats, health };
  },
  async adminProducts(ctx: GetServerSidePropsContext) {
    { const g = adminGuard(ctx); if (g) return g; }
    const q = str(ctx.query.q, 60);
    const rows = await db.query(`SELECT id, slug, premku_id, name, category, description, image_url, cost, price, price_locked, stock, active FROM products ${q ? 'WHERE name LIKE ?' : ''} ORDER BY id DESC LIMIT 100`, q ? [`%${sec.escapeLike(q)}%`] : []);
    return { shell: 'app' as const, title: 'Admin · Produk', admin: true as const, q, rows: rows.map((r: Row) => ({ ...r, cost: Number(r.cost), price: Number(r.price), price_locked: !!r.price_locked, active: !!r.active })) };
  },
  async adminUsers(ctx: GetServerSidePropsContext) {
    { const g = adminGuard(ctx); if (g) return g; }
    const q = str(ctx.query.q, 60); const like = `%${sec.escapeLike(q)}%`;
    const rows = await db.query(`SELECT id, username, email, name, role, status, balance, last_login_at, created_at FROM users ${q ? 'WHERE username LIKE ? OR email LIKE ?' : ''} ORDER BY id DESC LIMIT 100`, q ? [like, like] : []);
    return { shell: 'app' as const, title: 'Admin · Pengguna', admin: true as const, q, rows: rows.map((r: Row) => ({ ...r, balance: Number(r.balance) })) };
  },
  async adminOrders(ctx: GetServerSidePropsContext) {
    { const g = adminGuard(ctx); if (g) return g; }
    const sIn = str(ctx.query.status, 20);
    const status = STATUSES.includes(sIn) ? sIn : '';
    const rows = await db.query(`SELECT o.order_no, o.product_name, o.qty, o.total, o.pay_method, o.status, o.fail_reason, o.attempts, o.refunded_at, o.created_at, u.username FROM orders o JOIN users u ON u.id = o.user_id ${status ? 'WHERE o.status = ?' : ''} ORDER BY o.id DESC LIMIT 100`, status ? [status] : []);
    return { shell: 'app' as const, title: 'Admin · Pesanan', admin: true as const, status, rows: rows.map((r: Row) => ({ ...r, total: Number(r.total), refunded: !!r.refunded_at, refunded_at: undefined })) };
  },
  async adminSettings(ctx: GetServerSidePropsContext, s: SiteSettings) {
    { const g = adminGuard(ctx); if (g) return g; }
    return { shell: 'app' as const, title: 'Admin · Pengaturan', admin: true as const, s };
  },
};


async function run<K extends keyof Registry>(name: K, ctx: Ctx): Promise<GetServerSidePropsResult<Registry[K]>> {
  const fn = loaders[name];
  if (!fn) throw new AppError(500, 'no_loader', `Loader ${name} tidak ada`);
  const s = await settings.get();
  let out: Redirect | NotFound | Data<Registry[K]>;
  try { out = await fn(ctx, s); } catch (e) { log.error('loader gagal', { name, msg: e.message }); throw e; }
  if ('redirect' in out) return { redirect: { destination: out.redirect, permanent: false } };
  if ('notFound' in out) return { notFound: true };
  const u = ctx.req.user;
  const props = clean({ ...out, user: u ? { id: u.id, name: u.name, username: u.username, email: u.email, role: u.role, balance: u.balance, twofa: u.twofa } : null, site: settings.publicSite(s), csrf: ctx.req.csrfToken });
  return { props: props as Registry[K] };
}
const ssr = <K extends keyof Registry>(name: K): GetServerSideProps<Registry[K]> => async (ctx) => {
  ensureIp(ctx.req);
  await auth.attach(ctx.req, ctx.res);
  return run(name, ctx);
};
export { run, ssr, siteStats };
