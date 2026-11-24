const SENSITIVE = /pass(word|wd)?|secret|token|api[_-]?key|apikey|authorization|cookie|session|otp|totp|recovery|private|credential|data[_-]?key|csrf/i;
export const MASK = '[disamarkan]';

export function redact(v: unknown, depth = 0, seen: WeakSet<object> = new WeakSet()): unknown {
  if (v === null || typeof v !== 'object') return v;
  if (seen.has(v as object) || depth > 4) return '[…]';
  seen.add(v as object);
  if (Array.isArray(v)) return v.map((x) => redact(x, depth + 1, seen));
  const o: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) o[k] = SENSITIVE.test(k) ? MASK : redact(x, depth + 1, seen);
  return o;
}
