import type { IncomingMessage, ServerResponse } from 'http';
import { once } from '../core/singleton';
import { AppError } from '../core/errors';

interface Hit { n: number; reset: number }
type Hits = Map<string, Hit>;
const reg = once('ratelimit.registry', () => ({ maps: new Set<Hits>(), timer: null as NodeJS.Timeout | null }));
const MAX_KEYS = 50000;

function sweep(map: Hits, now = Date.now()) { for (const [k, h] of map) if (h.reset <= now) map.delete(k); }
function startSweeper() {
  if (reg.timer) return;
  reg.timer = setInterval(() => { const now = Date.now(); for (const m of reg.maps) sweep(m, now); }, 60e3);
  reg.timer.unref();
}

export type Limit = (req: IncomingMessage, res: ServerResponse) => Promise<void>;
function limiter(name: string, windowMs: number, max: number, message: string, { byUser = false, skipOk = false } = {}): Limit {
  const hits = once(`ratelimit.${name}`, () => new Map<string, Hit>());
  reg.maps.add(hits); startSweeper();
  return async function limit(req: IncomingMessage, res: ServerResponse) {
    const now = Date.now();
    if (hits.size > MAX_KEYS) sweep(hits, now);
    const key = byUser && req.user ? `u${req.user.id}` : String(req.ip || 'unknown');
    let h = hits.get(key);
    if (!h || h.reset <= now) { h = { n: 0, reset: now + windowMs }; hits.set(key, h); }
    h.n += 1;
    const resetSec = Math.max(1, Math.ceil((h.reset - now) / 1000));
    res.setHeader('RateLimit-Policy', `${max};w=${Math.round(windowMs / 1000)}`);
    res.setHeader('RateLimit', `limit=${max}, remaining=${Math.max(0, max - h.n)}, reset=${resetSec}`);
    if (skipOk) res.once('finish', () => { if (res.statusCode < 400 && h.n > 0) h.n -= 1; });
    if (h.n > max) { res.setHeader('Retry-After', String(resetSec)); throw new AppError(429, 'rate_limited', message); }
  };
}
export { limiter };
