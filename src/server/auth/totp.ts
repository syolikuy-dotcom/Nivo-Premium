import * as crypto from 'crypto';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const STEP_SEC = 30;
export const DIGITS = 6;

export function base32Encode(buf: Buffer): string {
  let bits = 0; let value = 0; let out = '';
  for (const b of buf) {
    value = (value << 8) | b; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
export function base32Decode(s: string): Buffer {
  const clean = String(s).toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0; let value = 0; const out: number[] = [];
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error('base32 tidak valid');
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export const generateSecret = (): string => base32Encode(crypto.randomBytes(20));

export function hotp(secretB32: string, counter: number, digits = DIGITS): string {
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0); buf.writeUInt32BE(counter >>> 0, 4);
  const h = crypto.createHmac('sha1', base32Decode(secretB32)).update(buf).digest();
  const o = h[h.length - 1] & 15;
  const bin = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(bin % 10 ** digits).padStart(digits, '0');
}
export const stepOf = (nowMs: number): number => Math.floor(nowMs / 1000 / STEP_SEC);
export const totp = (secretB32: string, nowMs = Date.now()): string => hotp(secretB32, stepOf(nowMs));

const eq = (a: string, b: string): boolean => { const x = Buffer.from(a); const y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); };

export function verify(secretB32: string, code: string, { nowMs = Date.now(), window = 1, lastStep = null as number | null } = {}): number | null {
  const c = String(code).replace(/\s+/g, '');
  if (!/^\d{6}$/.test(c)) return null;
  const cur = stepOf(nowMs); let hit: number | null = null;
  for (let s = cur - window; s <= cur + window; s++) {
    if (eq(hotp(secretB32, s), c) && hit === null && (lastStep === null || s > lastStep)) hit = s;
  }
  return hit;
}

export function otpauthUri({ secret, account, issuer }: { secret: string; account: string; issuer: string }): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SEC}`;
}

const RC = 'abcdefghjkmnpqrstuvwxyz23456789';
export function generateRecoveryCodes(n = 10): string[] {
  return Array.from({ length: n }, () => {
    const b = crypto.randomBytes(10);
    const s = Array.from(b, (x) => RC[x % RC.length]).join('');
    return `${s.slice(0, 5)}-${s.slice(5)}`;
  });
}
export const normalizeRecovery = (s: string): string => String(s).toLowerCase().replace(/[\s-]/g, '');
export const looksLikeRecovery = (s: string): boolean => /^[a-z2-9]{10}$/.test(normalizeRecovery(s));
export const looksLikeTotp = (s: string): boolean => /^\d{6}$/.test(String(s).replace(/\s+/g, ''));
