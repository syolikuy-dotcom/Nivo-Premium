import { route } from '@/server/http/api';
import * as db from '@/server/core/db';
import type { Row } from '@/server/core/db';
import { ok } from '@/server/http/http';
import { once } from '@/server/core/singleton';

export const config = { api: { bodyParser: false } };

const recentCache = once('shop.recent', () => ({ at: 0, v: [] }));

const maskFirstName = (v: unknown): string => {
  const f = (String(v || '').trim().split(/\s+/)[0] || '?').slice(0, 20);
  const c = Array.from(f);
  return c.length <= 3 ? `${c[0]}***` : `${c.slice(0, 2).join('')}***${c[c.length - 1]}`;
};

export default route({ method: 'GET' }, async (_req, res) => {
  if (Date.now() - recentCache.at > 20000) {
    const rows = await db.query("SELECT o.product_name, o.completed_at, u.name, u.username FROM orders o JOIN users u ON u.id = o.user_id WHERE o.status = 'success' AND o.completed_at IS NOT NULL ORDER BY o.completed_at DESC LIMIT 8");
    const slot = 5 * 60e3;
    recentCache.v = rows.map((x: Row) => ({ who: maskFirstName(x.name || x.username), product: x.product_name, at: new Date(Math.floor(new Date(x.completed_at).getTime() / slot) * slot).toISOString() }));
    recentCache.at = Date.now();
  }
  res.setHeader('Cache-Control', 'public, max-age=20');
  ok(res, { items: recentCache.v });
});
