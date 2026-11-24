"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.looksLikeInsufficient = exports.looksLikeAuthError = exports.TtlCache = exports.Coalescer = exports.Gate = exports.GateFull = exports.HealthTracker = exports.DEGRADED_MS = exports.BREAKER_MS = exports.DOWN_AFTER = void 0;
exports.backoffMs = backoffMs;
exports.parseRetryAfter = parseRetryAfter;
exports.DOWN_AFTER = 3;
exports.BREAKER_MS = 20_000;
exports.DEGRADED_MS = 60_000;
class HealthTracker {
    now;
    okAt = null;
    failAt = null;
    lastErr = null;
    fails = 0;
    limitedUntil = 0;
    limitedAt = 0;
    authMsg = null;
    insufficientAt = null;
    nextProbe = 0;
    stateSince;
    lastState = 'ok';
    constructor(now = Date.now) {
        this.now = now;
        this.stateSince = this.now();
    }
    alive() {
        this.okAt = this.now();
        this.fails = 0;
        this.authMsg = null;
        this.limitedUntil = 0;
        this.limitedAt = 0;
    }
    transient(message) {
        const t = this.now();
        this.failAt = t;
        this.lastErr = message.slice(0, 200);
        this.fails += 1;
        if (this.fails >= exports.DOWN_AFTER)
            this.nextProbe = t + exports.BREAKER_MS;
    }
    limited(retryAfterMs = 0) {
        const t = this.now();
        this.limitedAt = t;
        this.failAt = t;
        this.lastErr = 'dibatasi supplier (429)';
        this.limitedUntil = Math.max(this.limitedUntil, t + Math.min(Math.max(retryAfterMs, 1000), 30_000));
    }
    auth(message) { this.authMsg = message.slice(0, 200); this.failAt = this.now(); this.lastErr = this.authMsg; }
    insufficient() { this.insufficientAt = this.now(); }
    allow() {
        if (this.fails < exports.DOWN_AFTER)
            return true;
        const t = this.now();
        if (t >= this.nextProbe) {
            this.nextProbe = t + exports.BREAKER_MS;
            return true;
        }
        return false;
    }
    waitMs() { return Math.max(0, this.limitedUntil - this.now()); }
    state() {
        const t = this.now();
        let s;
        if (this.authMsg)
            s = 'auth';
        else if (this.fails >= exports.DOWN_AFTER)
            s = 'down';
        else if (this.fails > 0 || this.limitedUntil > t || (this.limitedAt && t - this.limitedAt < exports.DEGRADED_MS))
            s = 'degraded';
        else
            s = 'ok';
        if (s !== this.lastState) {
            this.lastState = s;
            this.stateSince = t;
        }
        return s;
    }
    snapshot() {
        const state = this.state();
        return {
            state, since: this.stateSince, lastOkAt: this.okAt, lastFailAt: this.failAt, lastError: this.lastErr,
            consecutiveFailures: this.fails, breakerOpen: this.fails >= exports.DOWN_AFTER && this.now() < this.nextProbe,
            rateLimitedUntil: this.limitedUntil, lastInsufficientAt: this.insufficientAt,
        };
    }
}
exports.HealthTracker = HealthTracker;
class GateFull extends Error {
    constructor() { super('antrean supplier penuh'); this.name = 'GateFull'; }
}
exports.GateFull = GateFull;
class Gate {
    max;
    gapMs;
    maxQueue;
    active = 0;
    lastStart = 0;
    queue = [];
    timer = null;
    constructor(max, gapMs, maxQueue = 200) {
        this.max = max;
        this.gapMs = gapMs;
        this.maxQueue = maxQueue;
    }
    get pending() { return this.queue.length; }
    get running() { return this.active; }
    async run(fn) {
        if (this.queue.length >= this.maxQueue)
            throw new GateFull();
        await new Promise((resolve) => { this.queue.push(resolve); this.pump(); });
        try {
            return await fn();
        }
        finally {
            this.active -= 1;
            this.pump();
        }
    }
    pump() {
        if (this.timer)
            return;
        while (this.queue.length && this.active < this.max) {
            const wait = this.lastStart + this.gapMs - Date.now();
            if (wait > 0) {
                this.timer = setTimeout(() => { this.timer = null; this.pump(); }, wait);
                this.timer.unref();
                return;
            }
            this.active += 1;
            this.lastStart = Date.now();
            this.queue.shift()();
        }
    }
}
exports.Gate = Gate;
class Coalescer {
    m = new Map();
    run(key, fn) {
        const ex = this.m.get(key);
        if (ex)
            return ex;
        const p = fn().finally(() => { if (this.m.get(key) === p)
            this.m.delete(key); });
        this.m.set(key, p);
        return p;
    }
}
exports.Coalescer = Coalescer;
class TtlCache {
    ttlMs;
    max;
    m = new Map();
    constructor(ttlMs, max = 500) {
        this.ttlMs = ttlMs;
        this.max = max;
    }
    get(key, now = Date.now()) {
        const e = this.m.get(key);
        if (!e)
            return undefined;
        if (e.exp <= now) {
            this.m.delete(key);
            return undefined;
        }
        return e.v;
    }
    set(key, v, now = Date.now()) {
        if (this.m.size >= this.max) {
            for (const [k, e] of this.m)
                if (e.exp <= now)
                    this.m.delete(k);
            if (this.m.size >= this.max)
                this.m.clear();
        }
        this.m.set(key, { v, exp: now + this.ttlMs });
    }
    delete(key) { this.m.delete(key); }
}
exports.TtlCache = TtlCache;
function backoffMs(attempt, retryAfterMs = 0, rnd = Math.random) {
    const base = Math.min(4000, 500 * 2 ** Math.max(0, attempt - 1));
    const jitter = base * (0.75 + rnd() * 0.5);
    return Math.round(Math.max(jitter, Math.min(retryAfterMs, 6000)));
}
function parseRetryAfter(h, now = Date.now()) {
    if (!h)
        return 0;
    const s = String(h).trim();
    if (/^\d+$/.test(s))
        return Math.min(Number(s), 3600) * 1000;
    const t = Date.parse(s);
    return Number.isFinite(t) ? Math.max(0, Math.min(t - now, 3600e3)) : 0;
}
const looksLikeAuthError = (msg) => /api[\s_-]?key|whitelist|ip (anda|server)|tidak terdaftar|unauthori[sz]ed|forbidden/i.test(msg);
exports.looksLikeAuthError = looksLikeAuthError;
const looksLikeInsufficient = (msg) => /saldo.*(tidak\s+(cukup|mencukupi)|kurang|habis)|insufficient/i.test(msg);
exports.looksLikeInsufficient = looksLikeInsufficient;
