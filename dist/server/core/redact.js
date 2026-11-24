"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MASK = void 0;
exports.redact = redact;
const SENSITIVE = /pass(word|wd)?|secret|token|api[_-]?key|apikey|authorization|cookie|session|otp|totp|recovery|private|credential|data[_-]?key|csrf/i;
exports.MASK = '[disamarkan]';
function redact(v, depth = 0, seen = new WeakSet()) {
    if (v === null || typeof v !== 'object')
        return v;
    if (seen.has(v) || depth > 4)
        return '[…]';
    seen.add(v);
    if (Array.isArray(v))
        return v.map((x) => redact(x, depth + 1, seen));
    const o = {};
    for (const [k, x] of Object.entries(v))
        o[k] = SENSITIVE.test(k) ? exports.MASK : redact(x, depth + 1, seen);
    return o;
}
