import { config } from './config';
import { redact } from './redact';

export type Meta = Record<string, unknown>;
type Sink = (line: string) => void;

const C = config.log.color ? { r: '\x1b[0m', d: '\x1b[2m', red: '\x1b[31m', grn: '\x1b[32m', yel: '\x1b[33m', blu: '\x1b[34m', mag: '\x1b[35m', cyn: '\x1b[36m', b: '\x1b[1m' }
  : { r: '', d: '', red: '', grn: '', yel: '', blu: '', mag: '', cyn: '', b: '' };
const clean = (v: unknown, n = 300): string => String(v).replace(/\s*\r?\n\s*/g, ' | ').replace(/[^\x20-\x7e\u00a0-\uffff]/g, '?').slice(0, n);
const stamp = () => new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Jakarta' });
const kv = (m?: Meta): string => Object.entries((redact(m || {}) as Meta)).filter(([, v]) => v !== undefined && v !== null && v !== '')
  .map(([k, v]) => `${C.d}${k}=${C.r}${clean(typeof v === 'object' ? JSON.stringify(v) : v)}`).join(' ');

function out(lvl: string, color: string, fn: Sink, msg: string, meta?: Meta) {
  if (config.log.json) return fn(JSON.stringify({ t: new Date().toISOString(), lvl, msg, ...(redact(meta || {}) as Meta) }));
  return fn(`${C.d}${stamp()}${C.r}  ${color}${lvl.toUpperCase().padEnd(5)}${C.r}  ${clean(msg, 400)}${meta ? `  ${kv(meta)}` : ''}`);
}

const METHOD_COLOR: Record<string, 'grn' | 'cyn' | 'yel' | 'red'> = { GET: 'grn', POST: 'cyn', PUT: 'yel', PATCH: 'yel', DELETE: 'red' };
const statusColor = (s: number) => (s >= 500 ? C.red : s >= 400 ? C.yel : s >= 300 ? C.cyn : C.grn);

function access({ method, path, status, ms, ip, user }: { method?: string; path: string; status: number; ms: number; ip: string; user?: string }) {
  if (config.log.json) return console.log(JSON.stringify({ t: new Date().toISOString(), lvl: 'access', method, path, status, ms, ip, user }));
  const m = `${C[METHOD_COLOR[method || ''] || 'blu']}${clean(method || '', 7).padEnd(7)}${C.r}`;
  const st = `${statusColor(status)}${C.b}${status}${C.r}`;
  return console.log(`${C.d}${stamp()}${C.r}  ${m}${st}  ${clean(path, 140)}  ${C.d}${ms}ms${C.r}  ${C.blu}${clean(ip, 45)}${C.r}${user ? `  ${C.mag}@${clean(user, 20)}${C.r}` : ''}`);
}

export const info = (m: string, x?: Meta) => out('info', C.grn, console.log, m, x);
export const warn = (m: string, x?: Meta) => out('warn', C.yel, console.warn, m, x);
export const error = (m: string, x?: Meta) => out('error', C.red, console.error, m, x);
export { access };
