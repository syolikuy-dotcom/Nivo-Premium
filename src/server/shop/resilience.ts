export type HealthState = 'unconfigured' | 'ok' | 'degraded' | 'down' | 'auth';

export interface HealthSnapshot {
  state: HealthState;
  since: number;
  lastOkAt: number | null;
  lastFailAt: number | null;
  lastError: string | null;
  consecutiveFailures: number;
  breakerOpen: boolean;
  rateLimitedUntil: number;
  lastInsufficientAt: number | null;
}

export const DOWN_AFTER = 3;
export const BREAKER_MS = 20_000;
export const DEGRADED_MS = 60_000;

export class HealthTracker {
  private okAt: number | null = null;
  private failAt: number | null = null;
  private lastErr: string | null = null;
  private fails = 0;
  private limitedUntil = 0;
  private limitedAt = 0;
  private authMsg: string | null = null;
  private insufficientAt: number | null = null;
  private nextProbe = 0;
  private stateSince: number;
  private lastState: HealthState = 'ok';

  constructor(private now: () => number = Date.now) { this.stateSince = this.now(); }

  alive(): void {
    this.okAt = this.now(); this.fails = 0; this.authMsg = null; this.limitedUntil = 0; this.limitedAt = 0;
  }
  transient(message: string): void {
    const t = this.now();
    this.failAt = t; this.lastErr = message.slice(0, 200); this.fails += 1;
    if (this.fails >= DOWN_AFTER) this.nextProbe = t + BREAKER_MS;
  }
  limited(retryAfterMs = 0): void {
    const t = this.now();
    this.limitedAt = t; this.failAt = t; this.lastErr = 'dibatasi supplier (429)';
    this.limitedUntil = Math.max(this.limitedUntil, t + Math.min(Math.max(retryAfterMs, 1000), 30_000));
  }
  auth(message: string): void { this.authMsg = message.slice(0, 200); this.failAt = this.now(); this.lastErr = this.authMsg; }
  insufficient(): void { this.insufficientAt = this.now(); }

  allow(): boolean {
    if (this.fails < DOWN_AFTER) return true;
    const t = this.now();
    if (t >= this.nextProbe) { this.nextProbe = t + BREAKER_MS; return true; }
    return false;
  }
  waitMs(): number { return Math.max(0, this.limitedUntil - this.now()); }

  state(): HealthState {
    const t = this.now();
    let s: HealthState;
    if (this.authMsg) s = 'auth';
    else if (this.fails >= DOWN_AFTER) s = 'down';
    else if (this.fails > 0 || this.limitedUntil > t || (this.limitedAt && t - this.limitedAt < DEGRADED_MS)) s = 'degraded';
    else s = 'ok';
    if (s !== this.lastState) { this.lastState = s; this.stateSince = t; }
    return s;
  }
  snapshot(): HealthSnapshot {
    const state = this.state();
    return {
      state, since: this.stateSince, lastOkAt: this.okAt, lastFailAt: this.failAt, lastError: this.lastErr,
      consecutiveFailures: this.fails, breakerOpen: this.fails >= DOWN_AFTER && this.now() < this.nextProbe,
      rateLimitedUntil: this.limitedUntil, lastInsufficientAt: this.insufficientAt,
    };
  }
}

export class GateFull extends Error { constructor() { super('antrean supplier penuh'); this.name = 'GateFull'; } }

export class Gate {
  private active = 0; private lastStart = 0; private queue: Array<() => void> = []; private timer: NodeJS.Timeout | null = null;
  constructor(private max: number, private gapMs: number, private maxQueue = 200) {}
  get pending(): number { return this.queue.length; }
  get running(): number { return this.active; }
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.queue.length >= this.maxQueue) throw new GateFull();
    await new Promise<void>((resolve) => { this.queue.push(resolve); this.pump(); });
    try { return await fn(); } finally { this.active -= 1; this.pump(); }
  }
  private pump(): void {
    if (this.timer) return;
    while (this.queue.length && this.active < this.max) {
      const wait = this.lastStart + this.gapMs - Date.now();
      if (wait > 0) { this.timer = setTimeout(() => { this.timer = null; this.pump(); }, wait); this.timer.unref(); return; }
      this.active += 1; this.lastStart = Date.now();
      (this.queue.shift() as () => void)();
    }
  }
}

export class Coalescer {
  private m = new Map<string, Promise<unknown>>();
  run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const ex = this.m.get(key) as Promise<T> | undefined;
    if (ex) return ex;
    const p: Promise<T> = fn().finally(() => { if (this.m.get(key) === p) this.m.delete(key); });
    this.m.set(key, p);
    return p;
  }
}

export class TtlCache<V> {
  private m = new Map<string, { v: V; exp: number }>();
  constructor(private ttlMs: number, private max = 500) {}
  get(key: string, now = Date.now()): V | undefined {
    const e = this.m.get(key);
    if (!e) return undefined;
    if (e.exp <= now) { this.m.delete(key); return undefined; }
    return e.v;
  }
  set(key: string, v: V, now = Date.now()): void {
    if (this.m.size >= this.max) { for (const [k, e] of this.m) if (e.exp <= now) this.m.delete(k); if (this.m.size >= this.max) this.m.clear(); }
    this.m.set(key, { v, exp: now + this.ttlMs });
  }
  delete(key: string): void { this.m.delete(key); }
}

export function backoffMs(attempt: number, retryAfterMs = 0, rnd: () => number = Math.random): number {
  const base = Math.min(4000, 500 * 2 ** Math.max(0, attempt - 1));
  const jitter = base * (0.75 + rnd() * 0.5);
  return Math.round(Math.max(jitter, Math.min(retryAfterMs, 6000)));
}

export function parseRetryAfter(h: string | null | undefined, now = Date.now()): number {
  if (!h) return 0;
  const s = String(h).trim();
  if (/^\d+$/.test(s)) return Math.min(Number(s), 3600) * 1000;
  const t = Date.parse(s);
  return Number.isFinite(t) ? Math.max(0, Math.min(t - now, 3600e3)) : 0;
}

export const looksLikeAuthError = (msg: string): boolean => /api[\s_-]?key|whitelist|ip (anda|server)|tidak terdaftar|unauthori[sz]ed|forbidden/i.test(msg);
export const looksLikeInsufficient = (msg: string): boolean => /saldo.*(tidak\s+(cukup|mencukupi)|kurang|habis)|insufficient/i.test(msg);
