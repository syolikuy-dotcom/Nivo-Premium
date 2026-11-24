import * as db from '../core/db';
import type { Row } from '../core/db';
import type { ProductPub, SiteSettings } from '../../shared/types';
import { config } from '../core/config';
import * as premku from './premku';
import * as settings from '../core/settings';
import * as sec from '../auth/security';
import * as log from '../core/logger';
import { isDup } from '../core/errors';
import { once } from '../core/singleton';

const slugify = (s: unknown): string => String(s).toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 100) || 'produk';

function imageSafe(url: unknown): string | null {
  if (!url || typeof url !== 'string' || url.length > 500) return null;
  if (/^\/media\/[a-f0-9]{24}$/.test(url)) return url;
  if (url === '/logo.svg' || url === '/icon.webp') return url;
  try { const u = new URL(url); if (u.protocol === 'https:' && config.imageHosts.includes(u.hostname.toLowerCase())) return u.href; } catch { /* abaikan: best-effort */ }
  return null;
}
const computePrice = (cost: number, s: Pick<SiteSettings, 'markup_pct' | 'markup_flat'>): number => Math.ceil((Math.ceil(cost * (1 + s.markup_pct / 100)) + s.markup_flat) / 50) * 50;
const pub = (r: Row): ProductPub => ({ id: r.id, slug: r.slug, name: r.name, category: r.category, description: r.description || '', image: imageSafe(r.image_url), price: Number(r.price), stock: r.stock, available: r.stock > 0 });

const st = once('products.sync', () => ({ inflight: null as Promise<{ count: number }> | null, lastSync: 0 }));
function sync(): Promise<{ count: number }> {
  if (st.inflight) return st.inflight;
  st.inflight = (async () => {
    const r = await premku.products();
    const list = Array.isArray(r.products) ? r.products : [];
    const s = await settings.get(true);
    const now = new Date(); const seen: number[] = [];
    // Satu kueri untuk semua produk yang ada (dulu 1 kueri per produk di setiap sinkron).
    const known = new Map<number, Row>();
    for (const r of await db.query('SELECT id, premku_id, cost, stock, price, price_locked FROM products WHERE premku_id IS NOT NULL')) known.set(Number(r.premku_id), r);
    const touched: number[] = [];
    for (const p of list) {
      const pid = Number(p.id); const cost = Math.max(0, Math.floor(Number(p.price) || 0));
      if (!Number.isInteger(pid) || pid <= 0 || !p.name) continue;
      seen.push(pid);
      const available = p.status === undefined || p.status === null ? true : String(p.status).toLowerCase() === 'available';
      const stock = available ? Math.max(0, Math.floor(Number(p.stock) || 0)) : 0;
      const price = computePrice(cost, s);
      const ex = known.get(pid);
      if (ex) {
        const nextPrice = Number(ex.price_locked) === 1 ? Number(ex.price) : price;
        if (Number(ex.cost) !== cost || Number(ex.stock) !== stock || Number(ex.price) !== nextPrice)
          await db.query('UPDATE products SET cost=?, stock=?, stock_synced_at=?, price=? WHERE id=?', [cost, stock, now, nextPrice, ex.id]);
        else touched.push(Number(ex.id));
      } else {
        const name = String(p.name).slice(0, 160); const base = slugify(name);
        const img = imageSafe(p.image);
        for (const slug of [base, `${base}-${pid}`]) {
          try {
            const ins = await db.query('INSERT INTO products (slug, premku_id, name, description, image_url, cost, price, stock, stock_synced_at) VALUES (?,?,?,?,?,?,?,?,?)',
              [slug, pid, name, p.description ? String(p.description).slice(0, 2000) : null, img, cost, price, stock, now]);
            known.set(pid, { id: Number(ins.insertId), premku_id: pid, cost, stock, price, price_locked: 0 });
            break;
          } catch (e) { if (!isDup(e, 'uq_products_slug')) throw e; }
        }
      }
    }
    if (touched.length) await db.query('UPDATE products SET stock_synced_at=? WHERE id IN (?)', [now, touched]);
    if (seen.length) await db.query('UPDATE products SET stock=0, stock_synced_at=? WHERE premku_id IS NOT NULL AND premku_id NOT IN (?) AND stock <> 0', [now, seen]);
    st.lastSync = Date.now();
    return { count: seen.length };
  })().finally(() => { st.inflight = null; });
  return st.inflight;
}
async function ensureFresh() {
  if (Date.now() - st.lastSync < 45000) return;
  const any = await db.one('SELECT id FROM products LIMIT 1');
  const p = sync().catch((e) => { log.warn('sinkron produk gagal', { msg: e.message }); st.lastSync = Date.now() - 30000; });
  if (!any) await p;
}
async function repriceAll() {
  const s = await settings.get(true);
  const rows = await db.query('SELECT id, cost FROM products WHERE price_locked = 0 AND premku_id IS NOT NULL');
  await db.tx(async (t) => { for (const r of rows) await t.query('UPDATE products SET price=? WHERE id=?', [computePrice(Number(r.cost), s), r.id]); });
  return rows.length;
}

async function list({ q = '', category = '', min = 0, max = 0, sort = 'new', page = 1, limit = 24 } = {}) {
  const where = ['active = 1']; const args = [];
  if (q) { where.push('name LIKE ?'); args.push(`%${sec.escapeLike(q.slice(0, 60))}%`); }
  if (category) { where.push('category = ?'); args.push(category.slice(0, 60)); }
  if (min > 0) { where.push('price >= ?'); args.push(min); }
  if (max > 0) { where.push('price <= ?'); args.push(max); }
  const ORDERS: Record<string, string> = { new: 'id DESC', price_asc: 'price ASC, id DESC', price_desc: 'price DESC, id DESC', name: 'name ASC' };
  const order = Object.prototype.hasOwnProperty.call(ORDERS, sort) ? ORDERS[sort] : 'id DESC';
  const lim = Math.min(60, Math.max(1, limit | 0)); const off = (Math.max(1, page | 0) - 1) * lim;
  const w = where.join(' AND ');
  const [rows, cnt] = await Promise.all([
    db.query(`SELECT * FROM products WHERE ${w} ORDER BY ${order} LIMIT ${lim} OFFSET ${off}`, args),
    db.one(`SELECT COUNT(*) AS n FROM products WHERE ${w}`, args),
  ]);
  return { items: rows.map(pub), total: Number(cnt!.n), page: Math.max(1, page | 0), pages: Math.max(1, Math.ceil(Number(cnt!.n) / lim)) };
}
const categories = async () => (await db.query('SELECT DISTINCT category FROM products WHERE active = 1 ORDER BY category')).map((r: Row) => r.category);
const bySlug = async (slug: string) => { const r = await db.one('SELECT * FROM products WHERE slug = ? AND active = 1', [String(slug).slice(0, 120)]); return r ? pub(r) : null; };
const rowById = (id: number) => db.one('SELECT * FROM products WHERE id = ? AND active = 1', [id]);
async function liveStock(row: Row) {
  const r = await premku.stock(row.premku_id);
  const n = Math.max(0, Math.floor(Number(r.stock) || 0));
  await db.query('UPDATE products SET stock=?, stock_synced_at=? WHERE id=?', [n, new Date(), row.id]);
  return n;
}

export { sync, ensureFresh, repriceAll, list, categories, bySlug, rowById, liveStock, imageSafe, computePrice, pub, slugify };
